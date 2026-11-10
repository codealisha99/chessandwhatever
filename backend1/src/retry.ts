import { log } from "./logger.ts";

/**
 * Run `fn` until it succeeds, backing off exponentially (2s, 4s, 8s, then capped at 15s by default).
 * Only for operations that are safe to repeat. Throws the last error once attempts run out.
 */
export async function retry<T>(label: string, fn: () => Promise<T>, { attempts = 6, baseMs = 1000, maxMs = 15_000 } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts) throw err;
      const wait = Math.min(baseMs * 2 ** attempt, maxMs);
      log.warn(`${label} failed (${(err as Error).message}), retrying in ${wait}ms`, { attempt });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
