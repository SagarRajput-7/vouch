import { errorMessage, log } from "@/lib/logger";
import { BudgetExceededError, nextUtcMidnight } from "@/lib/pipeline/budget";
import { StageError, toFailure } from "@/lib/pipeline/errors";
import { extractStage } from "@/lib/pipeline/stages/extract";
import { finaliseStage } from "@/lib/pipeline/stages/finalise";
import { groundStage } from "@/lib/pipeline/stages/ground";
import { parseStage } from "@/lib/pipeline/stages/parse";
import { reconcileStage } from "@/lib/pipeline/stages/reconcile";
import { validateStage } from "@/lib/pipeline/stages/validate";
import type { Stage, StageContext, StageName } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo, type Job } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

export const STAGES: Stage[] = [parseStage, extractStage, groundStage, validateStage, reconcileStage, finaliseStage];

/**
 * The time a stage is allowed to need before it is worth starting at all, used against the
 * caller's deadline. Parse is bounded by its own page and OCR caps; extract and reconcile are a
 * 90 second model timeout twice (the SDK retries once) plus margin; the rest are database work.
 */
const STAGE_BUDGET_MS: Record<StageName, number> = {
  parse: 140_000,
  extract: 200_000,
  ground: 5_000,
  validate: 5_000,
  reconcile: 200_000,
  finalise: 5_000,
};

export type RunJobOptions = {
  /**
   * Absolute epoch milliseconds by which the job must have finished whatever stage it starts.
   * A serverless invocation is killed at its own limit with no chance to record anything, so the
   * runner stops at the last stage boundary that still fits and hands the job back to the queue.
   */
  deadline?: number;
};

export async function runJob(job: Job, stages: Stage[] = STAGES, opts: RunJobOptions = {}): Promise<void> {
  if (!job.documentId) {
    await jobsRepo.complete(job.id);
    return;
  }
  const document = await documentsRepo.getByIdUnscoped(job.documentId);
  if (!document) {
    await jobsRepo.complete(job.id);
    return;
  }
  // One state object for the whole job: each stage gets its own run id spread over the same
  // context, so what parse put in `state` is still there when extract reads it.
  const shared: Omit<StageContext, "runId"> = { documentId: document.id, workspaceId: document.workspaceId, jobId: job.id, document, state: {} };

  try {
    for (const stage of stages) {
      if (await pipelineRunsRepo.hasSucceeded(document.id, stage.name)) continue;
      if (opts.deadline !== undefined && Date.now() + STAGE_BUDGET_MS[stage.name] > opts.deadline) {
        // Stop at the boundary instead of starting work that cannot finish. The attempt is given
        // back and the checkpoints already written mean the next claim resumes at this stage.
        await jobsRepo.defer(job.id, new Date(), "deadline: resumed on the next run");
        await documentsRepo.setStatus(document.id, "queued");
        log.info("job.paused_for_deadline", { jobId: job.id, documentId: document.id, stage: stage.name });
        return;
      }
      await documentsRepo.setStatus(document.id, "processing");
      const run = await pipelineRunsRepo.start(document.id, stage.name, job.id);
      try {
        const out = await stage.run({ ...shared, runId: run.id });
        await pipelineRunsRepo.finish(run.id, "succeeded", out.meta ?? {});
        if (out.halt) break;
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          await pipelineRunsRepo.finish(run.id, "skipped", { reason: "budget_paused" });
          throw err;
        }
        await pipelineRunsRepo.finish(run.id, "failed", {}, errorMessage(err));
        throw err;
      }
    }
    await jobsRepo.complete(job.id);
    log.info("job.succeeded", { jobId: job.id, documentId: document.id });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      const resumeAt = nextUtcMidnight();
      await jobsRepo.defer(job.id, resumeAt, err.message);
      await documentsRepo.setStatus(document.id, "queued", { code: err.code, message: err.userMessage });
      log.warn("job.deferred", { jobId: job.id, documentId: document.id, resumeAt: resumeAt.toISOString() });
      return;
    }
    const fatal = err instanceof StageError && !err.retryable;
    const failed = await jobsRepo.fail(job.id, errorMessage(err), { fatal });
    const failure = toFailure(err);
    if (failed?.status === "dead") {
      await documentsRepo.setStatus(document.id, "failed", failure);
      log.error("job.dead", { jobId: job.id, documentId: document.id, fatal, error: errorMessage(err) });
    } else {
      await documentsRepo.setStatus(document.id, "queued");
      log.warn("job.retry", { jobId: job.id, documentId: document.id, attempts: failed?.attempts, error: errorMessage(err) });
    }
  }
}
