import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("dashboard", () => {
  test("bootstraps a guest, loads samples, and shows processing results", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();

    await page.getByRole("button", { name: "Load sample invoices" }).click();
    const rows = page.getByRole("row").filter({ hasText: ".pdf" });
    await expect(rows).toHaveCount(3);

    await expect(page.getByText("Needs review")).toHaveCount(2, { timeout: 60_000 });
    await expect(page.getByText("Rejected")).toHaveCount(1);
    await expect(page.getByText("This document is not an invoice.")).toBeVisible();
  });

  test("skip link is the first tab stop and moves focus to main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("has no accessibility violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
