import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';

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
 * @throws Error if the URL is invalid
 */
export function parseGitHubUrl(url: string): GitHubUrlParsed {
  try {
    // Remove trailing slash and .git
    const cleanUrl = url.replace(/\/$/, '').replace(/\.git$/, '');

    // Try to parse as URL
    const urlObj = new URL(cleanUrl);

    // Validate that it's GitHub
    if (!urlObj.hostname.includes('github.com')) {
      throw new Error('URL debe ser de github.com');
    }

    // Extract path and split by /
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);

    // We need at least owner/repo
    if (pathParts.length < 2) {
      throw new Error('URL debe contener owner/repo');
    }

    const owner = pathParts[0];
    const repo = pathParts[1];
    let branch: string | undefined;

    // If there's a /tree/branch, extract the branch
    if (pathParts.length > 2 && pathParts[2] === 'tree' && pathParts[3]) {
      branch = pathParts.slice(3).join('/'); // Support complex branch names
    }

    if (!owner || !repo) {
      throw new Error('No se pudo extraer owner/repo de la URL');
    }

    return { owner, repo, branch };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`URL de GitHub inválida: ${error.message}`);
    }
    throw new Error('URL de GitHub inválida');
  }
}

/**
 * Clones a GitHub repository to a temporary directory
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param branch - (Optional) Branch to clone
 * @returns Local path where the repository has been cloned
 * @throws Error if cloning fails
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
    if (error instanceof Error) {
      // Improve common error messages
      if (error.message.includes('not found') || error.message.includes('Repository not found')) {
        throw new Error(`Repositorio no encontrado: ${owner}/${repo}`);
      }
      if (error.message.includes('Authentication failed')) {
        throw new Error('Autenticación fallida. El repositorio puede ser privado');
      }
      throw new Error(`Error al clonar repositorio: ${error.message}`);
    }
    throw new Error('Error desconocido al clonar repositorio');
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
      throw new Error('La ruta proporcionada no es un directorio');
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
    if (error instanceof Error) {
      throw new Error(`Error al analizar repositorio: ${error.message}`);
    }
    throw new Error('Error desconocido al analizar repositorio');
  }
}

/**
 * Cleans a temporary repository (removes the directory)
 *
 * @param repoPath - Path of the repository to clean
 */
export async function cleanupRepository(repoPath: string): Promise<void> {
  try {
    await fs.rm(repoPath, { recursive: true, force: true });
  } catch (error) {
    console.error(`Error al limpiar repositorio ${repoPath}:`, error);
    // Don't throw error, just log
  }
}
