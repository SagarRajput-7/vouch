import { after } from "next/server";
import { errorMessage, log } from "@/lib/logger";
import { runJob, STAGES } from "@/lib/pipeline/runner";
import { JOB_LIMITS, claimJobs, sweepStale } from "@/lib/queue/claim";

/**
 * The routes that drain declare `maxDuration = 300`, so everything here has to fit inside five
 * minutes of wall clock. A job is handed a deadline a little short of that to leave room for the
 * response, and no new job is claimed past the two minute mark: claiming one at minute four only
 * to park it again is churn, and the next trigger picks it up with a full budget. A caller may
 * pass a shorter budget through `deadlineMs`, which is how the park is exercised in tests.
 */
const DEADLINE_MS = 285_000;
const CLAIM_WINDOW_MS = 120_000;

export async function drain(opts: { runnerId: string; reason: string; deadlineMs?: number }): Promise<{ claimed: number; swept: number }> {
  const started = Date.now();
  const deadline = started + (opts.deadlineMs ?? DEADLINE_MS);
  const swept = await sweepStale(JOB_LIMITS.staleMs);
  let claimed = 0;
  let parked = false;
  while (!parked && Date.now() - started < CLAIM_WINDOW_MS) {
    const jobs = await claimJobs({ runnerId: opts.runnerId, limit: 1, perWorkspace: JOB_LIMITS.perWorkspace, global: JOB_LIMITS.global });
    if (jobs.length === 0) break;
    claimed += jobs.length;
    for (const job of jobs) {
      // A parked job is queued to run again right now and it is the oldest, so the very next
      // claim would hand back the same job with even less time left, over and over until the
      // window closed. Stop instead: the next trigger picks it up with a whole fresh budget.
      if ((await runJob(job, STAGES, { deadline })) === "parked") parked = true;
    }
  }
  log.info("drain.done", { reason: opts.reason, claimed, swept, parked, ms: Date.now() - started });
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
