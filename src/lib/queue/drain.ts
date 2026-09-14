import { after } from "next/server";
import { errorMessage, log } from "@/lib/logger";
import { runJob } from "@/lib/pipeline/runner";
import { JOB_LIMITS, claimJobs, sweepStale } from "@/lib/queue/claim";

const DEADLINE_MS = 240_000;

export async function drain(opts: { runnerId: string; reason: string }): Promise<{ claimed: number; swept: number }> {
  const started = Date.now();
  const swept = await sweepStale(JOB_LIMITS.staleMs);
  let claimed = 0;
  while (Date.now() - started < DEADLINE_MS) {
    const jobs = await claimJobs({ runnerId: opts.runnerId, limit: 1, perWorkspace: JOB_LIMITS.perWorkspace, global: JOB_LIMITS.global });
    if (jobs.length === 0) break;
    claimed += jobs.length;
    for (const job of jobs) await runJob(job);
  }
  log.info("drain.done", { reason: opts.reason, claimed, swept, ms: Date.now() - started });
  return { claimed, swept };
}

/**
 * Runs a drain after the current response. Inside a Next request this uses after();
 * outside one (tests, scripts) it runs in the background unless auto-drain is disabled.
 */
export function scheduleDrain(reason: string): void {
  if (process.env.VOUCH_DISABLE_AUTO_DRAIN === "true") return;
  const run = () => drain({ runnerId: `${reason}:${crypto.randomUUID().slice(0, 8)}`, reason }).catch((err) => log.error("drain.failed", { reason, error: errorMessage(err) }));
  try {
    after(run);
  } catch {
    void run();
  }
}
