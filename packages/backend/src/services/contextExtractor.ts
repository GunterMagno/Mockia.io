import * as path from 'path';
import { GitHubContextModel, type GitHubContextDocument } from '../models/GitHubContext.js';
import { ProjectModel } from '../models/Project.js';
import { parseTypeScriptFile } from '../utils/parsers/tsParser.js';
import { parseSwaggerFile } from '../utils/parsers/swaggerParser.js';
import { codeAnalyzer, type AnalyzedFile } from './github.service.js';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';

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
  const match = repoUrl.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(?:\.git)?$/i);
  if (!match) {
    throw new AppError('Invalid GitHub URL format', ErrorCode.VALIDATION_ERROR, 400);
  }
  const owner = match[1];
  const repo = match[2];

  // Analyze repository structure
  const analyzedFiles = await codeAnalyzer(repoPath);

  const files = [];
  let totalInterfaces = 0;
  let totalFunctions = 0;
  let totalRoutes = 0;

  // Find and process TypeScript files
  const tsFiles = analyzedFiles.filter((f) => f.type === 'ts');
  for (const file of tsFiles) {
    try {
      const filePath = path.join(repoPath, file.path);
      const parsed = await parseTypeScriptFile(filePath);

      const interfaces = parsed.interfaces.map((i) => ({
        name: i.name,
        properties: i.properties.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`),
      }));

      const enums = parsed.enums.map((e) => ({
        name: e.name,
        members: e.members,
      }));

      const typeAliases = parsed.typeAliases.map((t) => ({
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
        functions: parsed.functions.map((f) => ({
          name: f.name,
          params: f.parameters.map(p => `${p.name}: ${p.type}`),
          returnType: f.returnType,
        })),
        summary: `${parsed.interfaces.length} interfaces, ${parsed.functions.length} functions, ${parsed.enums.length} enums`,
      });
    } catch (error) {
      // Skip files that fail to parse
      console.error(`Failed to parse ${file.path}:`, error);
    }
  }

  // Find and process Swagger/OpenAPI files
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
      // Skip files that fail to parse
      console.error(`Failed to parse ${file.path}:`, error);
    }
  }

  // Create context document
  const contextData = {
    projectId,
    repoUrl,
    repoOwner: owner,
    repoName: repo,
    branch: 'main',
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
  console.log('Context data files sample (first 3):', JSON.stringify(contextData.files.slice(0, 3), null, 2));
  const githubContext = new GitHubContextModel(contextData);
  await githubContext.save();

  return githubContext;
}
