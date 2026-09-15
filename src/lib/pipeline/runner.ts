import { errorMessage, log } from "@/lib/logger";
import { BudgetExceededError, nextUtcMidnight } from "@/lib/pipeline/budget";
import { StageError, toFailure } from "@/lib/pipeline/errors";
import { extractStage } from "@/lib/pipeline/stages/extract";
import { finaliseStage } from "@/lib/pipeline/stages/finalise";
import { groundStage } from "@/lib/pipeline/stages/ground";
import { parseStage } from "@/lib/pipeline/stages/parse";
import { reconcileStage } from "@/lib/pipeline/stages/reconcile";
import { validateStage } from "@/lib/pipeline/stages/validate";
import type { Stage, StageContext } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo, type Job } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

export const STAGES: Stage[] = [parseStage, extractStage, groundStage, validateStage, reconcileStage, finaliseStage];

export async function runJob(job: Job, stages: Stage[] = STAGES): Promise<void> {
  if (!job.documentId) {
    await jobsRepo.complete(job.id);
    return;
  }
  const document = await documentsRepo.getByIdUnscoped(job.documentId);
  if (!document) {
    await jobsRepo.complete(job.id);
    return;
  }
  const ctx: StageContext = { documentId: document.id, workspaceId: document.workspaceId, jobId: job.id, document, state: {} };

  try {
    for (const stage of stages) {
      if (await pipelineRunsRepo.hasSucceeded(document.id, stage.name)) continue;
      await documentsRepo.setStatus(document.id, "processing");
      const run = await pipelineRunsRepo.start(document.id, stage.name, job.id);
      try {
        const out = await stage.run(ctx);
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
