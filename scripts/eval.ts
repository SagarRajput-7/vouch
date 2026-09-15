import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FieldMeta } from "../src/lib/db/schema";
import { llmMode } from "../src/lib/env";
import { parseDecimal, parseMoney } from "../src/lib/normalize/money";
import { groundTruthSchema, type GroundTruth } from "../src/lib/pipeline/extract/ground-truth";
import { fieldNames } from "../src/lib/pipeline/extract/schema";
import { documentsRepo } from "../src/lib/repo/documents";
import { invoicesRepo } from "../src/lib/repo/invoices";
import { issuesRepo } from "../src/lib/repo/issues";
import { usageRepo } from "../src/lib/repo/usage";
import { processSamples, readManifest } from "./harness";

/** Issue codes whose presence the ground truth asserts. OCR-dependent codes are reported but not scored. */
const SCORED_CODES = new Set(["V002", "V003", "V004", "V005", "V006", "V007", "V008", "V009"]);
/** Compared as money: locale, symbols and separators must not count as a wrong answer. */
const MONEY = new Set(["subtotal", "tax", "shipping", "discount", "total", "amount"]);
/** Compared to four decimals, because a metered line can price at 0.0125. */
const DECIMAL = new Set(["quantity", "unitPrice"]);

function same(field: string, actual: string | null, expected: string | null): boolean {
  if (actual === null || expected === null) return actual === expected;
  if (MONEY.has(field)) return parseMoney(actual) === parseMoney(expected);
  if (DECIMAL.has(field)) return parseDecimal(actual, 4) === parseDecimal(expected, 4);
  return actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

type Row = { name: string; docType: string; fields: string; lines: string; grounded: string; issues: string; cost: string; ok: boolean };

async function main() {
  const manifest = await readManifest();
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
    if (gt.docType === "other") {
      // Rejected is not enough: a parse failure also ends "rejected"-adjacent, and only a
      // rejection for the document's type means the classifier did its job.
      const rejectedForType = doc.status === "rejected" && doc.failureCode === "not_an_invoice";
      const verdict = rejectedForType ? "rejected (not_an_invoice)" : `expected rejection for its type, got ${doc.status} (${doc.failureCode ?? "no code"})`;
      rows.push({ name: p.entry.name, docType: verdict, fields: "-", lines: "-", grounded: "-", issues: "-", cost, ok: rejectedForType });
      continue;
    }
    const stored = await invoicesRepo.getByDocument(p.workspaceId, p.documentId);
    if (!stored) {
      rows.push({ name: p.entry.name, docType: `no invoice (${doc.status}: ${doc.failureMessage ?? ""})`, fields: `0/${fieldNames.length}`, lines: "-", grounded: "-", issues: "-", cost, ok: false });
      continue;
    }
    const docTypeOk = stored.invoice.docType === gt.docType;
    let fieldsOk = 0;
    for (const f of fieldNames) if (same(f, stored.invoice.fields[f]?.value ?? null, gt.fields[f]?.value ?? null)) fieldsOk += 1;
    let linesOk = 0;
    gt.lineItems.forEach((li, i) => {
      const got = stored.lineItems[i];
      if (
        got &&
        same("description", got.description, li.description) &&
        same("quantity", got.quantity, li.quantity) &&
        same("unitPrice", got.unitPrice, li.unitPrice) &&
        same("amount", got.amount, li.amount)
      ) {
        linesOk += 1;
      }
    });
    // An extra line the model invented is as wrong as a missing one, and scoring only the ground
    // truth's indices would never see it.
    const countOk = stored.lineItems.length === gt.lineItems.length;
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
    const ok = docTypeOk && countOk && fieldsOk === fieldNames.length && linesOk === gt.lineItems.length && missed.length === 0 && extra.length === 0;
    rows.push({
      name: p.entry.name,
      docType: docTypeOk ? stored.invoice.docType : `${stored.invoice.docType} (expected ${gt.docType})`,
      fields: `${fieldsOk}/${fieldNames.length}`,
      lines: `${linesOk}/${gt.lineItems.length} (got ${stored.lineItems.length})`,
      grounded: `${groundedCount}/${metas.length}`,
      issues,
      cost,
      ok,
    });
  }
  // The resolved mode, not the raw variable: `pnpm eval` sets no LLM_MODE and falls back to mock
  // when there is no API key, and the report is named for the mode that actually ran.
  const mode = llmMode;
  // A run that scored fewer samples than the manifest holds must never pass: `every` on a short
  // (or empty) list of rows is vacuously true.
  const complete = manifest.length > 0 && rows.length === manifest.length;
  const lines = [
    `# Evaluation (${mode} mode, ${new Date().toISOString().slice(0, 10)})`,
    "",
    "| Sample | Doc type | Header fields | Line items | Grounded values | Issues | Model cost | Pass |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.name} | ${r.docType} | ${r.fields} | ${r.lines} | ${r.grounded} | ${r.issues} | ${r.cost} | ${r.ok ? "yes" : "no"} |`),
    "",
    `Scored ${rows.length} of ${manifest.length} samples. Line items read matched/expected (returned). Only V002 to V009 are scored against the ground truth's expected issues; the OCR-dependent and classification codes (V001, V010, V011, V012) are shown for information and never fail a sample.`,
    "",
    `Total model cost for the set: $${(totalCost / 1e6).toFixed(4)}. Replayed samples cost nothing; live runs are priced at Sonnet 5 rates.`,
  ];
  const report = lines.join("\n") + "\n";
  process.stdout.write(report);
  if (!complete) process.stderr.write(`Scored ${rows.length} rows for a manifest of ${manifest.length} samples.\n`);
  await mkdir("docs/eval", { recursive: true });
  await writeFile(`docs/eval/${mode}.md`, report);
  process.exit(complete && rows.every((r) => r.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
