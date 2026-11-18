/**
 * In-process scheduler for single-server deployments (`next start`, Docker): every 60s it resumes
 * WAIT steps and runs workflow scanners. On serverless / multi-instance deployments set
 * INTERNAL_SCHEDULER=off and call GET /api/cron/tick every minute instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
