import * as path from 'path';
import * as fs from 'fs/promises';
import { GitHubContextModel, type GitHubContextDocument } from '../models/GitHubContext.js';
import { ProjectModel } from '../models/Project.js';
import { parseTypeScriptFile } from '../utils/parsers/tsParser.js';
import { parseSwaggerFile } from '../utils/parsers/swaggerParser.js';
import { codeAnalyzer, parseGitHubUrl, type AnalyzedFile } from './github.service.js';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';

/**
 * Extracts API routes and endpoints from a file's string content using regex patterns.
 * Scans for calls on client libraries (axios, fetch, fetchClient, api) and server definitions (app, router).
 *
 * @param content - File contents to parse
 * @returns Array of extracted paths and their methods
 */
export function extractRoutesFromFileContent(content: string): Array<{ path: string; methods: string[] }> {
  const routes: Array<{ path: string; methods: string[] }> = [];
  const foundMap = new Map<string, Set<string>>();

  // 1. Find explicit HTTP method calls on client libraries or router:
  // e.g. axios.get('/api/users') or router.post('/login')
  const apiCallRegex = /(?:axios|fetch|client|api|router|app)\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`\s\?]+)['"`]/gi;
  let match;

  while ((match = apiCallRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const rawPath = match[2];
    
    // Normalize path by replacing dynamic parameters (e.g. /users/123 or /users/:id) to standard path templates
    const normalizedPath = rawPath.replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/:\w+/g, '/{id}');
    
    if (!foundMap.has(normalizedPath)) {
      foundMap.set(normalizedPath, new Set());
    }
    foundMap.get(normalizedPath)!.add(method);
  }

  // 2. Also search for generic path strings (e.g., fetch("/api/v1/projects"))
  const pathRegex = /['"`](\/[a-zA-Z0-9_\-]+(?:\/[a-zA-Z0-9_\-:{}/]+)+)['"`]/g;
  while ((match = pathRegex.exec(content)) !== null) {
    const rawPath = match[1];
    
    // Ignore common non-paths like file extensions, image assets, or long text values
    if (rawPath.includes('.') || rawPath.length > 50) continue;
    
    const normalizedPath = rawPath.replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/:\w+/g, '/{id}');
    if (!foundMap.has(normalizedPath)) {
      // Default to GET if discovered out-of-context
      foundMap.set(normalizedPath, new Set(['GET']));
    }
  }

  // Convert map to DTO format
  for (const [p, methods] of foundMap.entries()) {
    routes.push({
      path: p,
      methods: Array.from(methods),
    });
  }

  return routes;
}

/**
 * Extract context from a cloned repository and store in database
 * Scans for TypeScript files and OpenAPI specifications
 *
 * @param projectId - MongoDB project ID
 * @param repoPath - Local path to cloned repository
 * @param repoUrl - Original repository URL
 * @returns Created GitHub context document
 * @throws AppError if project not found or extraction fails
 */
export async function extractContextForProject(
  projectId: string,
  repoPath: string,
  repoUrl: string
): Promise<GitHubContextDocument> {
  // Validate project exists
  const project = await ProjectModel.findById(projectId).exec();
  if (!project) {
    throw new AppError('Project not found', ErrorCode.NOT_FOUND, 404);
  }

  // Extract repository owner and name from URL
  let owner: string;
  let repo: string;
  let branch: string = 'main';
  try {
    const parsed = parseGitHubUrl(repoUrl);
    owner = parsed.owner;
    repo = parsed.repo;
    if (parsed.branch) {
      branch = parsed.branch;
    }
  } catch (err) {
    throw new AppError('Invalid GitHub URL format', ErrorCode.VALIDATION_ERROR, 400);
  }

  // Analyze repository structure
  const analyzedFiles = await codeAnalyzer(repoPath);

  const files = [];
  let totalInterfaces = 0;
  let totalFunctions = 0;
  let totalRoutes = 0;

  // 1. Process README.md file to capture core domain and business context
  const mdFiles = analyzedFiles.filter((f) => f.type === 'md');
  const readmeFile = mdFiles.find((f) => f.path.toLowerCase() === 'readme.md') || mdFiles[0];

  if (readmeFile) {
    try {
      const filePath = path.join(repoPath, readmeFile.path);
      const content = await fs.readFile(filePath, 'utf-8');
      
      files.push({
        path: readmeFile.path,
        type: 'other' as const,
        summary: content.substring(0, 12000), // Ingest up to 12K characters of README content
      });
      console.log(`[ContextExtractor] Extracted README context from ${readmeFile.path}`);
    } catch (error) {
      console.error(`[ContextExtractor] Failed to read markdown file ${readmeFile?.path}:`, error);
    }
  }

  // 2. Process TypeScript & JavaScript files (TS, TSX, JS, JSX)
  const codeFiles = analyzedFiles.filter((f) => f.type === 'ts' || f.type === 'js');
  for (const file of codeFiles) {
    try {
      const filePath = path.join(repoPath, file.path);
      
      // Read file content for route extraction
      let fileContent = '';
      try {
        fileContent = await fs.readFile(filePath, 'utf-8');
      } catch (err) {
        console.warn(`[ContextExtractor] Failed to read file content: ${file.path}`);
      }

      const fileRoutes = fileContent ? extractRoutesFromFileContent(fileContent) : [];
      totalRoutes += fileRoutes.length;

      // Extract declarations with TypeScript compiler API (if applicable)
      let parsed = { interfaces: [], enums: [], typeAliases: [], functions: [] } as any;
      try {
        parsed = await parseTypeScriptFile(filePath);
      } catch (err) {
        // Skip TS parsing warnings, we still preserve the file and its extracted routes!
        console.warn(`[ContextExtractor] AST parsing skipped for ${file.path}: ${err instanceof Error ? err.message : err}`);
      }

      const interfaces = parsed.interfaces.map((i: any) => ({
        name: i.name,
        properties: i.properties.map((p: any) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`),
      }));

      const enums = parsed.enums.map((e: any) => ({
        name: e.name,
        members: e.members,
      }));

      const typeAliases = parsed.typeAliases.map((t: any) => ({
        name: t.name,
        type: t.type,
      }));

      totalInterfaces += interfaces.length;
      totalFunctions += parsed.functions.length;

      files.push({
        path: file.path,
        type: 'typescript' as const,
        interfaces,
        enums,
        typeAliases,
        functions: parsed.functions.map((f: any) => ({
          name: f.name,
          params: f.parameters.map((p: any) => `${p.name}: ${p.type}`),
          returnType: f.returnType,
        })),
        routes: fileRoutes,
        summary: `${interfaces.length} interfaces, ${parsed.functions.length} functions, ${enums.length} enums, ${fileRoutes.length} code routes`,
      });
    } catch (error) {
      console.error(`[ContextExtractor] Failed to process code file ${file.path}:`, error);
    }
  }

  // 3. Process Swagger/OpenAPI files
  const swaggerFiles = analyzedFiles.filter(
    (f) => f.type === 'yaml' || f.type === 'yml' || f.type === 'json'
  );

  for (const file of swaggerFiles) {
    // Only parse files that look like API specs
    if (!file.path.toLowerCase().includes('swagger') && !file.path.toLowerCase().includes('openapi')) {
      continue;
    }

    try {
      const filePath = path.join(repoPath, file.path);
      const parsed = await parseSwaggerFile(filePath);

      const routes = parsed.paths.map((p) => ({
        path: p.path,
        methods: p.methods.map((m) => m.method.toUpperCase()),
      }));

      totalRoutes += routes.length;

      files.push({
        path: file.path,
        type: 'swagger' as const,
        routes,
        summary: `${parsed.paths.length} paths, ${parsed.components.length} schemas`,
      });
    } catch (error) {
      console.error(`[ContextExtractor] Failed to parse Swagger/OpenAPI spec ${file.path}:`, error);
    }
  }

  // Create context document
  const contextData = {
    projectId,
    repoUrl,
    repoOwner: owner,
    repoName: repo,
    branch,
    summary: `Repository with ${files.length} analyzed files (${totalInterfaces} interfaces, ${totalFunctions} functions, ${totalRoutes} API routes)`,
    files,
    stats: {
      totalFiles: files.length,
      totalInterfaces,
      totalFunctions,
      totalRoutes,
    },
  };

  // Delete any existing context for this project
  await GitHubContextModel.deleteOne({ projectId }).exec();

  // Create and save new context
  const githubContext = new GitHubContextModel(contextData);
  await githubContext.save();

  return githubContext;
}
