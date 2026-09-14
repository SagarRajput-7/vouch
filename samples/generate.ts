import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { groundTruthSchema, type Manifest } from "../src/lib/pipeline/extract/ground-truth";
import { sha256Hex } from "../src/lib/files/hash";

const ROOT = path.resolve("samples");
const TEMPLATES = path.join(ROOT, "templates");
const OUT = path.join(ROOT, "out");
const GT = path.join(ROOT, "ground-truth");

async function renderPdf(html: string): Promise<Uint8Array> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}

/** Pins metadata so re-rendering unchanged HTML yields byte-identical files where Chromium allows it. */
async function normalise(bytes: Uint8Array): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fixed = new Date("2026-01-01T00:00:00Z");
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  doc.setProducer("Vouch samples");
  doc.setCreator("Vouch samples");
  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, pages: doc.getPageCount() };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest: Manifest = [];
  const templates = (await readdir(TEMPLATES)).filter((f) => f.endsWith(".html")).sort();
  for (const file of templates) {
    const name = file.replace(/\.html$/, "");
    const gtRaw = await readFile(path.join(GT, `${name}.json`), "utf8");
    groundTruthSchema.parse(JSON.parse(gtRaw));
    const html = await readFile(path.join(TEMPLATES, file), "utf8");
    const { bytes, pages } = await normalise(await renderPdf(html));
    const outName = `${name}.pdf`;
    await writeFile(path.join(OUT, outName), bytes);
    manifest.push({ name, file: outName, mime: "application/pdf", sha256: sha256Hex(bytes), pages, kind: "pdf_text" });
    console.log(`rendered ${outName} (${pages} page${pages === 1 ? "" : "s"}, ${bytes.length} bytes)`);
  }
  await writeFile(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest: ${manifest.length} samples`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
