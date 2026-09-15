import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

function isHydrationIssue(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("hydration") || lower.includes("hydrat") || lower.includes("did not match");
}

test.describe("dashboard", () => {
  test("bootstraps a guest, loads samples, and shows processing results", async ({ page }) => {
    // The eight samples include a phone photo and a low-resolution scan, both of which go
    // through OCR inside the dev server. The config's 90 s default is not enough for that.
    test.setTimeout(300_000);
    const consoleIssues: string[] = [];
    page.on("console", (msg) => {
      const type = msg.type();
      if (type === "error" || type === "warning") consoleIssues.push(msg.text());
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();

    await page.getByRole("button", { name: "Load sample invoices" }).click();
    // Seven PDFs and one JPEG. The extension is not anchored with `$`: a row's text runs on
    // past the filename cell through status, size, date and the action buttons. Scoping to
    // `row` is what keeps the live announcer out of this count, not the pattern.
    const rows = page.getByRole("row").filter({ hasText: /\.(pdf|jpg)/ });
    await expect(rows).toHaveCount(8, { timeout: 60_000 });

    // Scoped to the table: the live announcer's polite region keeps the text of the last
    // status-change announcement (e.g. "mismatch-total.pdf: Needs review") sitting in the DOM,
    // off-screen but not `display:none`, until the next announcement replaces it. An unscoped
    // page.getByText("Needs review") matches that leftover text too and intermittently counts
    // one more than the table holds. See decisions.md, 2026-09-15.
    const table = page.getByRole("table");
    await expect(table.getByText("Needs review")).toHaveCount(7, { timeout: 240_000 });
    await expect(table.getByText("Rejected")).toHaveCount(1);
    await expect(page.getByText("This document is not an invoice.")).toBeVisible();

    // Regression guard for a hydration mismatch (server and client date/time formatting
    // disagreeing on locale or timezone): no console error or warning this run should mention
    // hydration or a server/client text mismatch.
    expect(consoleIssues.filter(isHydrationIssue)).toEqual([]);
  });

  test("skip link is the first tab stop and moves focus to main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("has no accessibility violations", async ({ page }) => {
    // Loads the same eight samples, two of them through OCR: well past the 90 s default.
    test.setTimeout(300_000);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Empty state.
    const emptyResults = await new AxeBuilder({ page }).analyze();
    expect(emptyResults.violations).toEqual([]);

    // Populated state.
    await page.getByRole("button", { name: "Load sample invoices" }).click();
    const rows = page.getByRole("row").filter({ hasText: /\.(pdf|jpg)/ });
    await expect(rows).toHaveCount(8, { timeout: 60_000 });
    // Scoped to the table for the same reason as the first test: an unscoped match can also
    // hit the live announcer's leftover status text. See decisions.md, 2026-09-15.
    await expect(page.getByRole("table").getByText("Needs review")).toHaveCount(7, { timeout: 240_000 });
    const populatedResults = await new AxeBuilder({ page }).analyze();
    expect(populatedResults.violations).toEqual([]);

    // Delete confirmation dialog open.
    await page.getByRole("button", { name: /^Delete / }).first().click();
    await expect(page.getByRole("heading", { name: /^Delete .*\?$/ })).toBeVisible();
    // The overlay's and popup's own fade/zoom entrance transitions (`data-open:animate-in ...`)
    // are still interpolating opacity and scale for a moment after `toBeVisible()` is
    // satisfied, which is enough for axe's color-contrast check to sample a
    // partially-transparent, blended frame and report a failure a settled frame does not have.
    // Waiting for every running animation to finish (a real signal, not a fixed delay) avoids
    // scanning mid-transition. See decisions.md, 2026-09-15.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const dialogResults = await new AxeBuilder({ page }).analyze();
    expect(dialogResults.violations).toEqual([]);
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});
