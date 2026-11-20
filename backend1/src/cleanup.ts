import { config } from "./config.ts";
import { repo } from "./db.ts";
import { log } from "./logger.ts";

export interface CleanupOptions {
  days?: number;
  batchSize?: number;
  dryRun?: boolean;
}

export async function runGuestCleanup(opts: CleanupOptions = {}) {
  const days = opts.days ?? config.guestRetentionDays;
  const batchSize = opts.batchSize ?? 100;
  const dryRun = opts.dryRun ?? false;
  const olderThanMs = days * 24 * 3600_000;

  log.info(`Starting guest account cleanup (retention: ${days} days, batch: ${batchSize}, dryRun: ${dryRun})`);
  try {
    const stats = await repo.cleanupInactiveGuests(olderThanMs, batchSize, dryRun);
    log.info(`Guest cleanup finished`, stats);
    return stats;
  } catch (err) {
    log.error("Guest cleanup job failed", err);
    throw err;
  }
}

/** Registers a recurring scheduled guest cleanup job (runs once every 24 hours) */
export function startGuestCleanupScheduler(): NodeJS.Timeout {
  const INTERVAL_MS = 24 * 3600_000;
  // Delay first run by 5 minutes so startup isn't bogged down
  const initialDelay = 5 * 60_000;
  let timer: NodeJS.Timeout;

  const run = () => {
    runGuestCleanup().catch((err) => log.warn("Scheduled guest cleanup encountered an error", err));
  };

  const initialTimer = setTimeout(() => {
    run();
    timer = setInterval(run, INTERVAL_MS);
    timer.unref();
  }, initialDelay);
  initialTimer.unref();

  return initialTimer;
}

// Support standalone CLI execution: node src/cleanup.ts [--dry-run] [--days=7] [--batch=100]
if (process.argv[1] && process.argv[1].endsWith("cleanup.ts")) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const daysArg = args.find((a) => a.startsWith("--days="))?.split("=")[1];
  const batchArg = args.find((a) => a.startsWith("--batch="))?.split("=")[1];

  const days = daysArg ? Number(daysArg) : undefined;
  const batchSize = batchArg ? Number(batchArg) : undefined;

  void (async () => {
    try {
      const stats = await runGuestCleanup({ days, batchSize, dryRun });
      console.log("Cleanup result:", JSON.stringify(stats, null, 2));
      await repo.close();
      process.exit(0);
    } catch (err) {
      console.error("Cleanup error:", err);
      process.exit(1);
    }
  })();
}
