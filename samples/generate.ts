import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { groundTruthSchema, type Manifest } from "../src/lib/pipeline/extract/ground-truth";
import { sha256Hex } from "../src/lib/files/hash";

const ROOT = path.resolve("samples");
const TEMPLATES = path.join(ROOT, "templates");
const OUT = path.join(ROOT, "out");
const GT = path.join(ROOT, "ground-truth");

type Kind = Manifest[number]["kind"];

/** How each template becomes a file. Anything not listed is a digital PDF with a text layer. */
const RECIPES: Record<string, Kind> = {
  "scan-photo": "image",
  "scan-lowres": "pdf_scan",
};

const A4 = { width: 595.28, height: 841.89 };

async function renderPdf(browser: Browser, html: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  await page.close();
  return new Uint8Array(pdf);
}

async function renderScreenshot(browser: Browser, html: string, width: number, scale: number): Promise<Uint8Array> {
  const page = await browser.newPage({ viewport: { width, height: 1200 }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: "load" });
  const png = await page.screenshot({ fullPage: true, type: "png" });
  await page.close();
  return new Uint8Array(png);
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

/** A phone photo: a soft shadow across one corner, a slight tilt, JPEG artefacts. */
async function photoOf(png: Uint8Array): Promise<Uint8Array> {
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 1800;
  const h = meta.height ?? 2400;
  const shadow = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#ffffff"/><stop offset="1" stop-color="#9a948a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  const shaded = await sharp(png).composite([{ input: shadow, blend: "multiply" }]).toBuffer();
  const out = await sharp(shaded).rotate(1.6, { background: "#d9d4cb" }).jpeg({ quality: 78, chromaSubsampling: "4:2:0" }).toBuffer();
  return new Uint8Array(out);
}

/** A low-resolution office scan: downsampled greyscale JPEG wrapped in a PDF with no text layer. */
async function lowResScanPdf(png: Uint8Array): Promise<Uint8Array> {
  const jpg = await sharp(png).resize({ width: 620 }).grayscale().jpeg({ quality: 55 }).toBuffer();
  const meta = await sharp(jpg).metadata();
  const width = meta.width ?? 620;
  const height = meta.height ?? 877;
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpg);
  const page = doc.addPage([A4.width, A4.height]);
  const scale = Math.min(A4.width / width, A4.height / height);
  page.drawImage(image, { x: 0, y: A4.height - height * scale, width: width * scale, height: height * scale });
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest: Manifest = [];
  const templates = (await readdir(TEMPLATES)).filter((f) => f.endsWith(".html")).sort();
  const browser = await chromium.launch();
  try {
    for (const file of templates) {
      const name = file.replace(/\.html$/, "");
      groundTruthSchema.parse(JSON.parse(await readFile(path.join(GT, `${name}.json`), "utf8")));
      const html = await readFile(path.join(TEMPLATES, file), "utf8");
      const kind = RECIPES[name] ?? "pdf_text";
      let bytes: Uint8Array;
      let pages = 1;
      let outName: string;
      let mime: Manifest[number]["mime"];
      if (kind === "image") {
        bytes = await photoOf(await renderScreenshot(browser, html, 900, 2));
        outName = `${name}.jpg`;
        mime = "image/jpeg";
      } else if (kind === "pdf_scan") {
        const fixed = await normalise(await lowResScanPdf(await renderScreenshot(browser, html, 900, 1)));
        bytes = fixed.bytes;
        pages = fixed.pages;
        outName = `${name}.pdf`;
        mime = "application/pdf";
      } else {
        const fixed = await normalise(await renderPdf(browser, html));
        bytes = fixed.bytes;
        pages = fixed.pages;
        outName = `${name}.pdf`;
        mime = "application/pdf";
      }
      await writeFile(path.join(OUT, outName), bytes);
      manifest.push({ name, file: outName, mime, sha256: sha256Hex(bytes), pages, kind });
      console.log(`rendered ${outName} (${kind}, ${pages} page${pages === 1 ? "" : "s"}, ${bytes.length} bytes)`);
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest: ${manifest.length} samples`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
