# Vouch

Invoices you can vouch for. Messy vendor invoices become a verified, queryable ledger where every value shows its source.

**Live:** https://vouch-eight-black.vercel.app

Status: foundation deployed. The live demo runs on a mock model that replays a fixed set of sample invoices, so it needs no API key and no login to try. Load the sample invoices from the empty state to see the pipeline, review states and validation in action. Full documentation lands as later plans build out extraction, review and the ledger.

## Quickstart

```bash
pnpm install
pnpm dev
```

No services or keys are needed locally. The app uses an on-disk Postgres (PGlite), local file storage, and a mock model that replays the sample ground truth.
