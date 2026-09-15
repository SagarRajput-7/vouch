# Vouch

Invoices you can vouch for. Messy vendor invoices become a verified, queryable ledger where every value shows its source.

**Live:** https://vouch-eight-black.vercel.app

Status: the pipeline is complete. Every document is parsed (positioned pdf.js text, with Tesseract OCR for scans and phone photos), extracted by Claude through a structured output schema, grounded token by token to a box on the page, validated by rules V001 to V012, and given one focused second look when the arithmetic contradicts itself. Each of the six stages is checkpointed, so a retry resumes where it stopped instead of paying for the whole document again.

The deployed demo runs in mock mode until an `ANTHROPIC_API_KEY` is configured, so it needs no key and no login to try: load the samples from the empty state and the real pipeline runs over them. Once `pnpm samples:record` has been run and its recordings are committed, the samples replay the recorded live model output in both modes, and only files that are not samples reach the API. Per-sample scores are in [docs/eval/mock.md](docs/eval/mock.md).

## What the samples show

- **clean-digital**: a well-formed digital invoice. Every field is located on the page and nothing is flagged.
- **mismatch-total**: the subtotal and tax add up to 791.70 but the invoice prints 719.70, so V003 blocks verification and suggests the transposed digits.
- **multipage-lineitems**: 25 lines over three pages in Indian lakh grouping, with each cell anchored to its own row and the totals on the last page.
- **euro-format**: day-first dotted dates, decimal commas and a trailing euro sign, all read correctly.
- **scan-lowres**: an image-only PDF that carries no text at all, rasterised and read through OCR.
- **scan-photo**: a phone photo with a shadow across the totals block. OCR reads the printed 366.00 as 66.00, so the total cannot be found anywhere on the page: Vouch refuses to confirm it and V010 blocks verification instead of quietly banking a number nobody can see. That is the product working.
- **injection**: an invoice whose text instructs the model to zero the total. The instruction is extracted as content and never followed.
- **not-an-invoice**: a bank statement, rejected with V011 before any ledger row is written.

## Quickstart

```bash
pnpm install
pnpm dev
```

No services or keys are needed locally. The app uses an on-disk Postgres (PGlite), local file storage, and a mock model that replays the sample ground truth.
