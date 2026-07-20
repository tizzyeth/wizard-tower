import { test, expect } from "@playwright/test";
import { attachGuards, mockApiRoutes } from "./helpers";

/**
 * Playwright smoke (IMPLEMENTATION_PLAN.md §8, M7 DoD): every module card renders
 * its title + a non-empty body, no console errors, no live network, and the cmd+K
 * palette opens / filters / navigates. Deterministic — all data is mocked.
 */

// [anchor id, title matcher] for all eleven module cards (plan §4).
const CARDS: Array<[string, RegExp]> = [
  ["ledger", /Ledger/],
  ["chart", /Scrying Glass/],
  ["holders", /Council of Holders/],
  ["pools", /Cauldrons/],
  ["tape", /Ledger of Deeds/],
  ["flow", /Flow of Mana/],
  ["safety", /Wards & Protections/],
  ["feed", /Prophecy Feed/],
  ["origin", /Origin Scroll/],
  ["tribute", /Tribute/],
  ["verdict", /Verdict/],
];

test.describe("Wizard's Tower — smoke (mocked, deterministic)", () => {
  test("every module card renders its title and a non-empty body", async ({ page }) => {
    await mockApiRoutes(page);
    const { consoleErrors, liveRequests } = attachGuards(page);

    await page.goto("/", { waitUntil: "networkidle" });

    for (const [id, title] of CARDS) {
      const card = page.locator(`#${id}`);
      await expect(card, `card #${id} present`).toBeVisible();
      await expect(card.locator("h2").first(), `card #${id} title`).toHaveText(title);
      const text = (await card.innerText()).replace(/\s+/g, " ").trim();
      expect(text.length, `card #${id} has a non-empty body`).toBeGreaterThan(60);
    }

    // Verdict specifics: the overall roll-up, all five axes, its own disclaimer.
    const verdict = page.locator("#verdict");
    await expect(verdict).toContainText(/of 5 wards speak/);
    for (const axis of ["Safety", "Distribution", "Liquidity", "Activity", "Community"]) {
      await expect(verdict).toContainText(axis);
    }
    await expect(verdict).toContainText(/financial advice/i);

    // Prophecy Feed (M6): the Official tab shows real post cards from /api/social,
    // and switching to The Coven swaps in the community feed + its approximation note.
    const feed = page.locator("#feed");
    await expect(feed).toContainText("@swizardcore");
    await expect(feed).toContainText(/Open on X/);
    await feed.getByRole("button", { name: /The Coven/ }).click();
    await expect(feed).toContainText(/every mention of/i); // the approximation note
    await expect(feed).toContainText("@libretaxservice");

    expect(liveRequests, "browser made no live upstream requests (incl. X)").toEqual([]);
    expect(consoleErrors, "no console errors on load").toEqual([]);
  });

  test("cmd+K palette opens, filters, navigates, and closes", async ({ page }) => {
    await mockApiRoutes(page);
    const { consoleErrors } = attachGuards(page);
    await page.goto("/", { waitUntil: "networkidle" });

    const dialog = page.getByRole("dialog", { name: /command palette/i });
    const search = page.getByRole("combobox", { name: /search commands/i });

    // Opens via the keyboard shortcut (Cmd on mac, Ctrl elsewhere).
    await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible();
    await expect(search).toBeFocused();

    // Filter → the matching "jump to Cauldrons" option appears; Enter runs it.
    await search.fill("Cauldrons");
    await expect(page.getByRole("option", { name: /Cauldrons/i })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/#pools$/);

    // Re-opens via the header affordance; Escape closes it.
    await page.getByRole("button", { name: /open command palette/i }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    expect(consoleErrors, "no console errors during palette use").toEqual([]);
  });

  /**
   * Plan §10 backlog ("Bubblemaps iframe embed") resolved as a link-out: Bubblemaps
   * serves a `frame-ancestors` allow-list that excludes this origin, so a framed map
   * is a browser block page in production. This asserts the honest alternative — an
   * affordance that says what the map shows, attributes it, and opens externally —
   * and that no frame or request to Bubblemaps happens on load.
   */
  test("the holder relationship map is an explained external link, never a frame", async ({
    page,
  }) => {
    await mockApiRoutes(page);
    const { consoleErrors, liveRequests } = attachGuards(page);
    await page.goto("/", { waitUntil: "networkidle" });

    const safety = page.locator("#safety");
    await expect(safety).toContainText("Holder relationship map");
    // Attribution: the map is Bubblemaps' reading of the chain, not the tower's.
    await expect(safety).toContainText(/own reading of the chain/);

    const link = safety.getByRole("link", { name: /Open on Bubblemaps/ });
    await expect(link).toHaveAttribute("href", /v2\.bubblemaps\.io\/map\?address=/);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);

    // The card offers no frame, and Bubblemaps is not contacted before a click.
    await expect(safety.locator("iframe")).toHaveCount(0);
    expect(liveRequests, "no third party contacted on load").toEqual([]);
    expect(consoleErrors, "no console errors").toEqual([]);
  });

  test("the grain overlay toggles off from the palette", async ({ page }) => {
    await mockApiRoutes(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // Default is on (no attribute); toggling sets data-grain="off" on <html>.
    await expect(page.locator("html")).not.toHaveAttribute("data-grain", "off");
    await page.getByRole("button", { name: /open command palette/i }).click();
    await page.getByRole("combobox", { name: /search commands/i }).fill("grain");
    await page.getByRole("option", { name: /film grain/i }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-grain", "off");
  });
});
