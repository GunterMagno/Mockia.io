import { cleanupArchivedProjects } from '../modules/projects/service.js';

/**
 * Scheduler for cleaning up archived projects
 * Runs daily at a scheduled time to permanently delete projects
 * that have been archived for more than 30 days
 */

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const CLEANUP_HOUR = 3; // Run at 3 AM

/**
 * Calculates milliseconds until the next scheduled cleanup time
 * Cleanup runs daily at CLEANUP_HOUR (3 AM by default)
 */
function getTimeUntilNextCleanup(): number {
  const now = new Date();
  const next = new Date();

  // Set next cleanup time to 3 AM
  next.setHours(CLEANUP_HOUR, 0, 0, 0);

  // If that time has already passed today, schedule for tomorrow
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  const delay = next.getTime() - now.getTime();
  return delay;
}

/**
 * Starts the project cleanup scheduler
 * Runs daily and removes archived projects older than 30 days
 */
export function startProjectCleanupScheduler(): void {
  const isDevelopment = process.env.NODE_ENV === 'development';

  if (isDevelopment) {
    console.log('Project cleanup scheduler: RUNNING IN DEVELOPMENT MODE');
    console.log('Running cleanup every 30 minutes for testing');
  } else {
    console.log(
      `Project cleanup scheduler: Starting (runs daily at ${CLEANUP_HOUR}:00 AM)`
    );
  }

  // Initial delay calculation
  const initialDelay = isDevelopment
    ? 30 * 60 * 1000 // 30 minutes in development for easy testing
    : getTimeUntilNextCleanup();

  // Run initial cleanup after initial delay
  setTimeout(async () => {
    await runCleanup();

    // Then run periodically
    const interval = isDevelopment
      ? 30 * 60 * 1000 // 30 minutes in development
      : CLEANUP_INTERVAL_MS; // 24 hours in production

    setInterval(async () => {
      await runCleanup();
    }, interval);
  }, initialDelay);
}

/**
 * Executes the cleanup operation and handles errors
 */
async function runCleanup(): Promise<void> {
  try {
    const deletedCount = await cleanupArchivedProjects();
    if (deletedCount === 0) {
      console.log('Project cleanup: No projects to clean up');
    }
  } catch (error) {
    console.error('Project cleanup error:', error);
  }
}
