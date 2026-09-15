import { documentsRepo } from "../src/lib/repo/documents";
import { usageRepo } from "../src/lib/repo/usage";
import { processSamples } from "./harness";

async function main() {
  if (process.env.LLM_MODE !== "record") throw new Error("Run through `pnpm samples:record`, which sets LLM_MODE=record.");
  const only = process.argv.slice(2);
  const processed = await processSamples(only.length ? (e) => only.includes(e.name) : undefined);
  let total = 0;
  for (const p of processed) {
    const doc = await documentsRepo.getByIdUnscoped(p.documentId);
    const usage = await usageRepo.totalsForDocument(p.documentId);
    total += usage.costMicros;
    console.log(`${p.entry.name.padEnd(22)} ${String(doc?.status).padEnd(13)} calls=${usage.calls} cost=$${(usage.costMicros / 1e6).toFixed(4)}`);
  }
  console.log(`total cost $${(total / 1e6).toFixed(4)}; recordings written to samples/recordings`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
