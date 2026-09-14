import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Cleared here, before the server process exists, rather than in globalSetup: Playwright
    // always finishes webServer's own setup (spawn the command, poll `url` until ready) before
    // running the config's globalSetup file, and this app's instrumentation.ts opens and
    // migrates the PGlite directory as soon as the process boots. Deleting the directory from
    // globalSetup therefore deletes it out from under the already-running, already-migrated
    // server, corrupting it. See decisions.md, 2026-09-15.
    command: process.env.CI ? `rm -rf .data/e2e && pnpm start -p ${PORT}` : `rm -rf .data/e2e && pnpm dev -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PGLITE_DATA_DIR: ".data/e2e/pglite",
      LOCAL_DATA_DIR: ".data/e2e",
      LLM_MODE: "mock",
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: "e2e-secret-at-least-sixteen-chars",
    },
  },
});
