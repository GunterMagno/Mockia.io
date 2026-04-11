 import fs from 'fs/promises';
import path from 'path';

/**
 * Removes a directory and all its contents recursively
 * 
 * @param dirPath - Absolute path to the directory to remove
 * @returns Promise that resolves when the directory is removed
 * @throws Error if the directory cannot be removed
 */
export async function removeDirectory(dirPath: string): Promise<void> {
  try {
    // Check if the path exists before attempting removal
    await fs.access(dirPath);
    
    // Remove directory recursively with force flag
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error removing directory ${dirPath}:`, error.message);
    }
    // Don't throw error, just log it to prevent cleanup failures from blocking the response
    // In production, this should be logged to a monitoring service
  }
}

/**
 * Removes multiple temporary files/directories
 * Useful for cleanup after analysis or import operations
 * 
 * @param paths - Array of paths to remove
 * @returns Promise that resolves when all paths are attempted to be removed
 */
export async function removeDirectories(paths: string[]): Promise<void> {
  const results = await Promise.allSettled(
    paths.map(dirPath => removeDirectory(dirPath))
  );
  
  // Log any failures (but don't throw)
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Failed to cleanup path ${paths[index]}:`, result.reason);
    }
  });
}
