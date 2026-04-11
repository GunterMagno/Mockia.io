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
      console.log(`Cloning repository ${owner}/${repo}...`);
      repoPath = await cloneRepository(owner, repo, targetBranch);
      console.log(`Repository cloned at: ${repoPath}`);

      // Analyze structure
      console.log(`Analyzing code structure...`);
      const files = await codeAnalyzer(repoPath);
      console.log(`Analysis completed: ${files.length} files found`);

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
        console.log(`Cleaning temporary repository...`);
        await cleanupRepository(repoPath);
        console.log(`Cleanup completed`);
      }
    }
  }
);
