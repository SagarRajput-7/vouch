// Intentionally a no-op. Playwright always finishes the webServer plugin's own setup (spawn
// `pnpm dev`/`pnpm start`, poll the health URL until ready) before running this file, and this
// app's instrumentation.ts opens and migrates the PGlite directory as soon as that process
// boots. Deleting .data/e2e from here would delete it out from under the already-running,
// already-migrated server instead of giving it a clean slate, corrupting it. The reset that
// belongs to "start every e2e run with a clean data directory" runs instead as the first step
// of playwright.config.ts's webServer.command, which is the only point guaranteed to run before
// the server process exists. See decisions.md, 2026-09-15.
export default async function globalSetup() {}
