import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FieldMeta } from "../src/lib/db/schema";
import { llmMode } from "../src/lib/env";
import { parseMoney } from "../src/lib/normalize/money";
import { groundTruthSchema, type GroundTruth } from "../src/lib/pipeline/extract/ground-truth";
import { fieldNames } from "../src/lib/pipeline/extract/schema";
import { documentsRepo } from "../src/lib/repo/documents";
import { invoicesRepo } from "../src/lib/repo/invoices";
import { issuesRepo } from "../src/lib/repo/issues";
import { usageRepo } from "../src/lib/repo/usage";
import { processSamples } from "./harness";

/** Issue codes whose presence the ground truth asserts. OCR-dependent codes are reported but not scored. */
const SCORED_CODES = new Set(["V002", "V003", "V004", "V005", "V006", "V007", "V008", "V009"]);
const MONEY = new Set(["subtotal", "tax", "shipping", "discount", "total"]);

function same(field: string, actual: string | null, expected: string | null): boolean {
  if (actual === null || expected === null) return actual === expected;
  if (MONEY.has(field)) return parseMoney(actual) === parseMoney(expected);
  return actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

type Row = { name: string; docType: string; fields: string; lines: string; grounded: string; issues: string; cost: string; ok: boolean };

async function main() {
  const processed = await processSamples();
  const rows: Row[] = [];
  let totalCost = 0;
  for (const p of processed) {
    const gt: GroundTruth = groundTruthSchema.parse(JSON.parse(await readFile(path.resolve("samples/ground-truth", `${p.entry.name}.json`), "utf8")));
    const doc = await documentsRepo.getByIdUnscoped(p.documentId);
    if (!doc) throw new Error(`${p.entry.name}: the document row disappeared mid-run.`);
    const usage = await usageRepo.totalsForDocument(p.documentId);
    totalCost += usage.costMicros;
    const cost = `$${(usage.costMicros / 1e6).toFixed(4)}`;
    const docTypeOk = (gt.docType === "other") === (doc.status === "rejected");
    if (gt.docType === "other") {
      rows.push({ name: p.entry.name, docType: docTypeOk ? "rejected (ok)" : `expected rejection, got ${doc.status}`, fields: "-", lines: "-", grounded: "-", issues: "-", cost, ok: docTypeOk });
      continue;
    }
    const stored = await invoicesRepo.getByDocument(p.workspaceId, p.documentId);
    if (!stored) {
      rows.push({ name: p.entry.name, docType: `no invoice (${doc.status}: ${doc.failureMessage ?? ""})`, fields: "0/10", lines: "-", grounded: "-", issues: "-", cost, ok: false });
      continue;
    }
    let fieldsOk = 0;
    for (const f of fieldNames) if (same(f, stored.invoice.fields[f]?.value ?? null, gt.fields[f]?.value ?? null)) fieldsOk += 1;
    let linesOk = 0;
    gt.lineItems.forEach((li, i) => {
      const got = stored.lineItems[i];
      if (got && same("amount", got.amount, li.amount) && same("description", got.description, li.description)) linesOk += 1;
    });
    const metas = [...Object.values(stored.invoice.fields), ...stored.lineItems.flatMap((li) => Object.values(li.meta))].filter(
      (m): m is FieldMeta => m !== undefined && m.value !== null,
    );
    const groundedCount = metas.filter((m) => m.bbox !== null).length;
    const got = new Set((await issuesRepo.listByDocument(p.documentId)).map((i) => i.code));
    const expected = new Set(gt.expectedIssues);
    const scoredGot = [...got].filter((c) => SCORED_CODES.has(c));
    const missed = [...expected].filter((c) => !got.has(c));
    const extra = scoredGot.filter((c) => !expected.has(c));
    const issues = `${[...got].join(",") || "none"}${missed.length ? ` missed:${missed.join(",")}` : ""}${extra.length ? ` extra:${extra.join(",")}` : ""}`;
    const ok = docTypeOk && fieldsOk === fieldNames.length && linesOk === gt.lineItems.length && missed.length === 0 && extra.length === 0;
    rows.push({ name: p.entry.name, docType: stored.invoice.docType, fields: `${fieldsOk}/${fieldNames.length}`, lines: `${linesOk}/${gt.lineItems.length}`, grounded: `${groundedCount}/${metas.length}`, issues, cost, ok });
  }
  // The resolved mode, not the raw variable: `pnpm eval` sets no LLM_MODE and falls back to mock
  // when there is no API key, and the report is named for the mode that actually ran.
  const mode = llmMode;
  const lines = [
    `# Evaluation (${mode} mode, ${new Date().toISOString().slice(0, 10)})`,
    "",
    "| Sample | Doc type | Header fields | Line items | Grounded values | Issues | Model cost | Pass |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.name} | ${r.docType} | ${r.fields} | ${r.lines} | ${r.grounded} | ${r.issues} | ${r.cost} | ${r.ok ? "yes" : "no"} |`),
    "",
    `Total model cost for the set: $${(totalCost / 1e6).toFixed(4)}. Replayed samples cost nothing; live runs are priced at Sonnet 5 rates.`,
  ];
  const report = lines.join("\n") + "\n";
  process.stdout.write(report);
  await mkdir("docs/eval", { recursive: true });
  await writeFile(`docs/eval/${mode}.md`, report);
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
