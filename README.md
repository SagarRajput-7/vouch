# Vouch

Invoices you can vouch for. Messy vendor invoices become a verified, queryable ledger where every value shows its source.

Status: foundation in progress. Full documentation lands at the end of the build.

## Quickstart

```bash
pnpm install
pnpm dev
```

No services or keys are needed locally. The app uses an on-disk Postgres (PGlite), local file storage, and a mock model that replays the sample ground truth.
