import { errorMessage, log } from "@/lib/logger";
import { toFailure } from "@/lib/pipeline/errors";
import { extractStage } from "@/lib/pipeline/stages/extract";
import { finaliseStage } from "@/lib/pipeline/stages/finalise";
import type { Stage, StageContext } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo, type Job } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

export const STAGES: Stage[] = [extractStage, finaliseStage];

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
        await pipelineRunsRepo.finish(run.id, "failed", {}, errorMessage(err));
        throw err;
      }
    }
    await jobsRepo.complete(job.id);
    log.info("job.succeeded", { jobId: job.id, documentId: document.id });
  } catch (err) {
    const failed = await jobsRepo.fail(job.id, errorMessage(err));
    const failure = toFailure(err);
    if (failed?.status === "dead") {
      await documentsRepo.setStatus(document.id, "failed", failure);
      log.error("job.dead", { jobId: job.id, documentId: document.id, error: errorMessage(err) });
    } else {
      await documentsRepo.setStatus(document.id, "queued");
      log.warn("job.retry", { jobId: job.id, documentId: document.id, attempts: failed?.attempts, error: errorMessage(err) });
    }
  }
}
