import { documentsRepo, type DocumentStatus } from "../src/lib/repo/documents";
import { usageRepo } from "../src/lib/repo/usage";
import { processSamples } from "./harness";

/** A sample the pipeline carried to a conclusion. Anything else means the recording set is incomplete. */
const SETTLED: ReadonlySet<DocumentStatus> = new Set<DocumentStatus>(["needs_review", "verified", "rejected"]);

async function main() {
  if (process.env.LLM_MODE !== "record") throw new Error("Run through `pnpm samples:record`, which sets LLM_MODE=record.");
  const only = process.argv.slice(2);
  const processed = await processSamples(only.length ? (e) => only.includes(e.name) : undefined);
  const missing = only.filter((name) => !processed.some((p) => p.entry.name === name));
  let total = 0;
  const unsettled: string[] = [];
  for (const p of processed) {
    const doc = await documentsRepo.getByIdUnscoped(p.documentId);
    const usage = await usageRepo.totalsForDocument(p.documentId);
    total += usage.costMicros;
    if (!doc || !SETTLED.has(doc.status)) unsettled.push(`${p.entry.name} (${doc?.status ?? "no document"}${doc?.failureMessage ? `: ${doc.failureMessage}` : ""})`);
    console.log(`${p.entry.name.padEnd(22)} ${String(doc?.status).padEnd(13)} calls=${usage.calls} cost=$${(usage.costMicros / 1e6).toFixed(4)}`);
  }
  console.log(`total cost $${(total / 1e6).toFixed(4)}; recordings written to samples/recordings`);
  if (missing.length > 0) console.error(`No sample named: ${missing.join(", ")}`);
  if (unsettled.length > 0) console.error(`Did not finish: ${unsettled.join(", ")}`);
  if (processed.length === 0) console.error("No samples were processed.");
  // A half-recorded set is worse than none: it would replay for some samples and hit the API for
  // the rest, so the run fails loudly rather than reporting a total and leaving the gap to be found later.
  return missing.length === 0 && unsettled.length === 0 && processed.length > 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
