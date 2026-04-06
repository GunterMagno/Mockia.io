import { Request, Response, NextFunction } from 'express';
import {
  parseGitHubUrl,
  cloneRepository,
  codeAnalyzer,
  cleanupRepository,
  GitHubUrlParsed,
} from '../services/github.service';
import { asyncHandler } from '../middlewares/errorHandler';

/**
 * POST /api/github/parse
 * Parses a GitHub URL without cloning it
 *
 * Expected body:
 * {
 *   "url": "https://github.com/owner/repo"
 * }
 *
 * @returns 200 with parsed GitHub URL information
 * @throws 400 if validation fails or URL is invalid
 */
export const parseGithubUrl = asyncHandler(
  async (req: Request<{}, any, { url: string }>, res: Response, next: NextFunction) => {
    const { url } = req.body;

    const parsed = parseGitHubUrl(url);

    res.status(200).json({
      success: true,
      data: parsed,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/github/ingest
 * Clones a GitHub repository and analyzes its structure
 *
 * Expected body:
 * {
 *   "url": "https://github.com/owner/repo",
 *   "branch": "main" (optional)
 * }
 *
 * @returns 200 with analysis results (files, count, timing)
 * @throws 400 if validation fails
 * @throws 500 if repository cloning or analysis fails
 */
export const ingestGithubRepo = asyncHandler(
  async (
    req: Request<{}, any, { url: string; branch?: string }>,
    res: Response,
    next: NextFunction
  ) => {
    const startTime = Date.now();
    let repoPath: string | null = null;

    try {
      const { url, branch } = req.body;

      // Parse URL
      const parsedUrl: GitHubUrlParsed = parseGitHubUrl(url);
      const { owner, repo } = parsedUrl;
      const targetBranch = branch || parsedUrl.branch;

      // Clone repository
      console.log(`Clonando repositorio ${owner}/${repo}...`);
      repoPath = await cloneRepository(owner, repo, targetBranch);
      console.log(`Repositorio clonado en: ${repoPath}`);

      // Analyze structure
      console.log(`Analizando estructura del código...`);
      const files = await codeAnalyzer(repoPath);
      console.log(`Análisis completado: ${files.length} archivos encontrados`);

      // Calculate time
      const analysisTime = Date.now() - startTime;

      // Respond with success
      res.status(200).json({
        success: true,
        data: {
          owner,
          repo,
          branch: targetBranch,
          fileCount: files.length,
          files,
          analysisTime,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Error will be handled by asyncHandler
      throw error;
    } finally {
      // Clean temporary repository
      if (repoPath) {
        console.log(`Limpiando repositorio temporal...`);
        await cleanupRepository(repoPath);
        console.log(`Limpieza completada`);
      }
    }
  }
);

/**
 * POST /api/projects/:id/import/github
 * Import GitHub repository context and store analysis in database
 *
 * Body parameters:
 * - repoUrl (required): GitHub repository URL
 * - branch (optional): Git branch to analyze
 *
 * @returns 201 with context summary
 */
export const importFromGitHub = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id: projectId } = req.params;
  const { repoUrl, branch } = req.body;

  if (!repoUrl || typeof repoUrl !== 'string') {
    res.status(400).json({
      success: false,
      error: 'Repository URL is required',
    });
    return;
  }

  let repoPath: string | null = null;

  try {
    // Import context extraction functions
    const { extractContextForProject } = await import('../services/contextExtractor');
    const { ProjectModel } = await import('../models/Project');

    // Verify project exists
    const project = await ProjectModel.findById(projectId).exec();
    if (!project) {
      res.status(404).json({
        success: false,
        error: 'Project not found',
      });
      return;
    }

    // Parse repository URL
    const { owner, repo } = parseGitHubUrl(repoUrl);

    // Clone repository
    console.log(`Cloning repository ${owner}/${repo}...`);
    repoPath = await cloneRepository(owner, repo, branch);

    // Extract context
    console.log(`Extracting context from ${owner}/${repo}...`);
    const context = await extractContextForProject(projectId, repoPath, repoUrl);

    res.status(201).json({
      success: true,
      message: 'GitHub context imported successfully',
      data: {
        contextId: context._id,
        projectId: context.projectId,
        repoUrl: context.repoUrl,
        summary: context.summary,
        stats: context.stats,
        filesAnalyzed: context.files.length,
      },
    });
  } catch (error) {
    throw error;
  } finally {
    // Always clean up the cloned repository after processing
    if (repoPath) {
      await cleanupRepository(repoPath);
    }
  }
});

/**
 * GET /api/projects/:id/context
 * Retrieve stored GitHub context for a project
 *
 * @returns 200 with context data
 */
export const getProjectContextHandler = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id: projectId } = req.params;

  try {
    const { getProjectContext } = await import('../services/contextExtractor');
    const { ProjectModel } = await import('../models/Project');

    // Verify project exists
    const project = await ProjectModel.findById(projectId).exec();
    if (!project) {
      res.status(404).json({
        success: false,
        error: 'Project not found',
      });
      return;
    }

    // Get context
    const context = await getProjectContext(projectId);
    if (!context) {
      res.status(404).json({
        success: false,
        error: 'No context found for this project',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        contextId: context._id,
        projectId: context.projectId,
        repoUrl: context.repoUrl,
        repoOwner: context.repoOwner,
        repoName: context.repoName,
        summary: context.summary,
        stats: context.stats,
        files: context.files,
        createdAt: context.createdAt,
        updatedAt: context.updatedAt,
      },
    });
  } catch (error) {
    throw error;
  }
});

/**
 * DELETE /api/projects/:id/context
 * Delete stored GitHub context for a project
 *
 * @returns 200 success
 */
export const deleteProjectContextHandler = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id: projectId } = req.params;

  try {
    const { deleteProjectContext } = await import('../services/contextExtractor');
    const { ProjectModel } = await import('../models/Project');

    // Verify project exists
    const project = await ProjectModel.findById(projectId).exec();
    if (!project) {
      res.status(404).json({
        success: false,
        error: 'Project not found',
      });
      return;
    }

    // Delete context
    await deleteProjectContext(projectId);

    res.json({
      success: true,
      message: 'Context deleted successfully',
    });
  } catch (error) {
    throw error;
  }
});
