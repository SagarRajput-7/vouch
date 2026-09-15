import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { JOB_LIMITS, type Job } from "@/lib/repo/jobs";

export { JOB_LIMITS };

type ClaimOptions = { runnerId: string; limit: number; perWorkspace: number; global: number };

type RawJob = {
  id: string;
  workspace_id: string;
  document_id: string | null;
  kind: string;
  status: Job["status"];
  attempts: number;
  max_attempts: number;
  run_after: string | Date;
  locked_at: string | Date | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function toJob(r: RawJob): Job {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    documentId: r.document_id,
    kind: r.kind,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAfter: new Date(r.run_after),
    lockedAt: r.locked_at ? new Date(r.locked_at) : null,
    lockedBy: r.locked_by,
    lastError: r.last_error,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

/**
 * Claims up to `limit` queued jobs whose run_after has passed, oldest first, skipping rows
 * another claimer holds. The per-workspace and global caps are soft: two claimers racing
 * in separate statements can each see the same pre-claim counts and together overshoot by
 * a claim, which is acceptable for a demo-scale system.
 *
 * Within one call, the caps are exact: a plain `count(running) < limit` correlated subquery
 * only sees rows as of the statement's snapshot, so it can't see other rows this same UPDATE
 * is about to claim, and a batch of several queued rows from one workspace would all read the
 * same pre-claim count and all pass. The `ranked` CTE below adds each row's position (via
 * row_number, oldest first) on top of the pre-existing running count, so only as many rows as
 * remain under the cap are selected. FOR UPDATE cannot be combined with window functions in
 * the same SELECT, so ranking happens in its own CTE and `candidate` re-selects the winning
 * ids from `jobs` to take the row locks.
 */
export async function claimJobs(opts: ClaimOptions): Promise<Job[]> {
  const db = getDb();
  const result = await db.execute<RawJob>(sql`
    with ranked as (
      select
        j.id,
        (select count(*) from jobs r where r.status = 'running' and r.workspace_id = j.workspace_id)
          + row_number() over (partition by j.workspace_id order by j.created_at asc) as workspace_rank,
        (select count(*) from jobs r where r.status = 'running')
          + row_number() over (order by j.created_at asc) as global_rank
      from jobs j
      where j.status = 'queued'
        and j.run_after <= now()
    ),
    candidate as (
      select j.id
      from jobs j
      where j.id in (
        select id from ranked where workspace_rank <= ${opts.perWorkspace} and global_rank <= ${opts.global}
      )
      and j.status = 'queued'
      order by j.created_at asc
      limit ${opts.limit}
      for update skip locked
    )
    update jobs
    set status = 'running',
        locked_at = now(),
        locked_by = ${opts.runnerId},
        attempts = jobs.attempts + 1,
        updated_at = now()
    from candidate
    where jobs.id = candidate.id
      and jobs.status = 'queued'
    returning jobs.*
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: RawJob[] }).rows) as RawJob[];
  return rows.map(toJob);
}

/** Returns running jobs whose lock is older than the threshold to the queue with backoff. */
export async function sweepStale(thresholdMs: number): Promise<number> {
  const db = getDb();
  const result = await db.execute<{ id: string }>(sql`
    update jobs
    set status = (case when attempts >= max_attempts then 'dead' else 'queued' end)::job_status,
        run_after = now() + make_interval(secs => 30 * power(2, greatest(attempts - 1, 0))),
        last_error = coalesce(last_error, 'stale lock recovered'),
        locked_at = null,
        locked_by = null,
        updated_at = now()
    where status = 'running'
      and locked_at < now() - make_interval(secs => ${Math.floor(thresholdMs / 1000)})
    returning id
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as unknown[];
  return rows.length;
}
