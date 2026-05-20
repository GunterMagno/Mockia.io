import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';
import { removeDirectory } from '../utils/cleanupUtil.js';
import axios from 'axios';

/**
 * Interface for the result of parseGitHubUrl
 */
export interface GitHubUrlParsed {
  owner: string;
  repo: string;
  branch?: string;
}

/**
 * Interface for the results of codeAnalyzer
 */
export interface AnalyzedFile {
  path: string;
  type: 'ts' | 'js' | 'json' | 'yaml' | 'yml' | 'md' | 'other';
  size: number;
  content?: string; // Contenido para archivos markdown principales
}

/**
 * Validates and extracts information from a GitHub URL
 * Supports formats like:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/tree/branch
 *
 * @param url - GitHub URL to parse
 * @returns Object with owner, repo and optionally branch
 * @throws AppError with statusCode 400 if the URL is invalid
 */
export function parseGitHubUrl(url: string): GitHubUrlParsed {
  try {
    // Validate input
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      throw new AppError(
        'GitHub URL is required and cannot be empty',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    // Remove trailing slash and .git
    const cleanUrl = url.replace(/\/$/, '').replace(/\.git$/, '');

    // Try to parse as URL
    const urlObj = new URL(cleanUrl);

    // Validate that it's GitHub
    if (!urlObj.hostname.includes('github.com')) {
      throw new AppError(
        'URL must be from github.com',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    // Extract path and split by /
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);

    // We need at least owner/repo
    if (pathParts.length < 2) {
      throw new AppError(
        'URL must contain owner/repo',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    const owner = pathParts[0];
    const repo = pathParts[1];
    let branch: string | undefined;

    // If there's a /tree/branch, extract the branch
    if (pathParts.length > 2 && pathParts[2] === 'tree' && pathParts[3]) {
      branch = pathParts.slice(3).join('/'); // Support complex branch names
    }

    if (!owner || !repo) {
      throw new AppError(
        'Could not extract owner/repo from the URL',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    return { owner, repo, branch };
  } catch (error) {
    // If it's already an AppError, re-throw it
    if (error instanceof AppError) {
      throw error;
    }
    
    // Handle URL parsing errors
    if (error instanceof TypeError) {
      throw new AppError(
        'Invalid GitHub URL format',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    // Fallback for unknown errors
    if (error instanceof Error) {
      throw new AppError(
        `Invalid GitHub URL: ${error.message}`,
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }
    
    throw new AppError(
      'Invalid GitHub URL',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }
}

/**
 * Checks if a GitHub repository is public and accessible
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @throws AppError if the repository is not found or is private
 */
export async function checkRepoAccessibility(owner: string, repo: string): Promise<void> {
  try {
    await axios.get(`https://github.com/${owner}/${repo}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    });
  } catch (error: any) {
    if (error.response) {
      const status = error.response.status;
      if (status === 404) {
        throw new AppError(
          `Repository not found: ${owner}/${repo}. Please ensure it is a public repository.`,
          ErrorCode.NOT_FOUND,
          404
        );
      }
    }
    throw new AppError(
      `Could not access repository ${owner}/${repo}. Please check the URL and ensure it's public.`,
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }
}

/**
 * Clones a GitHub repository to a temporary directory
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param branch - (Optional) Branch to clone
 * @returns Local path where the repository has been cloned
 * @throws AppError with appropriate status codes:
 *   - 400: Repository not found or invalid branch
 *   - 403: Authentication failed (private repository)
 *   - 500: Unexpected cloning errors
 */
export async function cloneRepository(
  owner: string,
  repo: string,
  branch?: string
): Promise<string> {
  try {
    // Create temporary directory for cloning
    const tempDir = path.join(process.cwd(), '.tmp-repos', `${owner}-${repo}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Build repository URL
    const repoUrl = `https://github.com/${owner}/${repo}.git`;

    // Create simple-git instance
    const git: SimpleGit = simpleGit();

    // Clone the repository
    const cloneOptions = branch ? ['clone', '--branch', branch, repoUrl, tempDir] : ['clone', repoUrl, tempDir];

    await git.raw(cloneOptions);

    return tempDir;
  } catch (error) {
    // If it's already an AppError, re-throw it
    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof Error) {
      const errorMsg = error.message.toLowerCase();

      // Repository not found (404)
      if (errorMsg.includes('not found') || errorMsg.includes('does not appear to be a git repository')) {
        throw new AppError(
          `Repository not found: ${owner}/${repo}`,
          ErrorCode.NOT_FOUND,
          404
        );
      }

      // Branch not found (400)
      if (errorMsg.includes('remote: not found') || errorMsg.includes('no such file or directory')) {
        throw new AppError(
          `Branch not found: ${branch || 'default'}`,
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }

      // Authentication failed - private repository (403)
      if (
        errorMsg.includes('permission denied') ||
        errorMsg.includes('authentication failed') ||
        errorMsg.includes('fatal: could not read username')
      ) {
        throw new AppError(
          'Access denied. The repository may be private or credentials are invalid',
          ErrorCode.FORBIDDEN,
          403
        );
      }

      // Network/connectivity issues (500)
      if (
        errorMsg.includes('network') ||
        errorMsg.includes('connection') ||
        errorMsg.includes('unable to access')
      ) {
        throw new AppError(
          'Network connectivity error while accessing repository',
          ErrorCode.INTERNAL_SERVER_ERROR,
          500
        );
      }

      // Default error handling (500)
      throw new AppError(
        `Error cloning repository: ${error.message}`,
        ErrorCode.INTERNAL_SERVER_ERROR,
        500
      );
    }

    throw new AppError(
      'Unknown error occurred while cloning repository',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Analyzes the file structure of a cloned repository
 *
 * @param repoPath - Local path of the repository
 * @returns Array of analyzed files
 * @throws Error if analysis fails
 */
export async function codeAnalyzer(repoPath: string): Promise<AnalyzedFile[]> {
  const results: AnalyzedFile[] = [];

  // Directories and files to ignore
  const ignoreDirs = new Set([
    'node_modules',
    '.git',
    '.github',
    'dist',
    'build',
    'coverage',
    '.next',
    'out',
    '.nuxt',
    '.venv',
    'venv',
    '__pycache__',
    '.pytest_cache',
    'target',
    'bin',
    'obj',
  ]);

  const ignoreFiles = new Set(['.DS_Store', '.gitignore', '.env', '.env.local']);

  // Relevant extensions
  const relevantExtensions = new Set(['.ts', '.js', '.json', '.yaml', '.yml', '.md', '.jsx', '.tsx']);

  // Maximum size to read markdown content (50KB)
  const MAX_MARKDOWN_CONTENT_SIZE = 50 * 1024;

  /**
   * Recursively walks the directory tree
   */
  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(repoPath, fullPath);

        // Ignore specific directories
        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name)) {
            await walkDir(fullPath);
          }
          continue;
        }

        // Ignore specific files
        if (ignoreFiles.has(entry.name)) {
          continue;
        }

        // Check extension
        const ext = path.extname(entry.name).toLowerCase();

        if (relevantExtensions.has(ext)) {
          const stats = await fs.stat(fullPath);
          const type = getFileType(ext);

          const fileInfo: AnalyzedFile = {
            path: relativePath.replace(/\\/g, '/'), // Normalize path for Windows
            type,
            size: stats.size,
          };

          // If it's a small markdown file, read its content
          if (type === 'md' && stats.size < MAX_MARKDOWN_CONTENT_SIZE) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              // Limit to 10000 characters to avoid saturating the response
              fileInfo.content = content.substring(0, 10000);
            } catch (error) {
              // If it cannot be read, just ignore
            }
          }

          results.push(fileInfo);
        }
      }
    } catch (error) {
      // Ignore permission errors in specific directories
      if (error instanceof Error && !error.message.includes('EACCES')) {
        throw error;
      }
    }
  }

  /**
   * Determines the file type based on the extension
   */
  function getFileType(ext: string): 'ts' | 'js' | 'json' | 'yaml' | 'yml' | 'md' | 'other' {
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'ts';
      case '.js':
      case '.jsx':
        return 'js';
      case '.json':
        return 'json';
      case '.yaml':
        return 'yaml';
      case '.yml':
        return 'yml';
      case '.md':
        return 'md';
      default:
        return 'other';
    }
  }

  try {
    // Validate that the directory exists
    const stats = await fs.stat(repoPath);
    if (!stats.isDirectory()) {
      throw new AppError(
        'The provided path is not a directory',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    // Start analysis
    await walkDir(repoPath);

    // Sort results by type and path
    results.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type);
      }
      return a.path.localeCompare(b.path);
    });

    return results;
  } catch (error) {
    // If it's already an AppError, re-throw it
    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new AppError(
        `Error analyzing repository: ${error.message}`,
        ErrorCode.INTERNAL_SERVER_ERROR,
        500
      );
    }
    
    throw new AppError(
      'Unknown error occurred while analyzing repository',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Cleans a temporary repository (removes the directory)
 * Uses the centralized removeDirectory utility from cleanupUtil
 *
 * @param repoPath - Path of the repository to clean
 */
export async function cleanupRepository(repoPath: string): Promise<void> {
  await removeDirectory(repoPath);
}

/**
 * Extract files of a given type from the analyzed results
 */
export function getFilesByType(
  files: AnalyzedFile[],
  type: 'ts' | 'js' | 'json' | 'yaml' | 'yml' | 'md'
): AnalyzedFile[] {
  return files.filter((f) => f.type === type);
}
