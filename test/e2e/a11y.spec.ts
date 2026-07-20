import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApiRoutes } from "./helpers";

/**
 * Accessibility gate (IMPLEMENTATION_PLAN.md §8, M7 DoD): zero CRITICAL axe
 * violations on the fully-rendered, mocked page. We also assert zero SERIOUS and
 * log everything else so regressions surface in the report.
 */

function summarize(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations.map((v) => `${v.impact}:${v.id}(x${v.nodes.length})`).join(", ") || "none";
}

test.describe("Wizard's Tower — accessibility (axe-core)", () => {
  test("no critical or serious violations on the mocked page", async ({ page }, testInfo) => {
    await mockApiRoutes(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("#verdict")).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    await testInfo.attach("axe-violations.json", {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    console.log("axe (page):", summarize(results.violations));

    const critical = results.violations.filter((v) => v.impact === "critical");
    const serious = results.violations.filter((v) => v.impact === "serious");
    expect(critical, "zero critical a11y violations").toEqual([]);
    expect(serious, "zero serious a11y violations").toEqual([]);
  });

  test("no critical violations with the command palette open", async ({ page }) => {
    await mockApiRoutes(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /open command palette/i }).click();
    await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    console.log("axe (palette open):", summarize(results.violations));
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, "zero critical a11y violations (palette open)").toEqual([]);
  });
});
