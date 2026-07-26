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

    // The header's freshness dot (lib/health.ts). This run sets WIZARD_DISABLE_DB=1,
    // so freshness is `unknown` — which must render as the ordinary live state. An
    // indicator that warns when it cannot measure anything is one people learn to
    // ignore, and it would make this suite non-deterministic besides.
    // (`banner`, not `header` — every CardFrame renders a <header> too, but those
    // are scoped to a <section> so only the site header carries the landmark role.)
    const banner = page.getByRole("banner");
    await expect(banner).toContainText(/\blive\b/i);
    await expect(banner).not.toContainText(/\bstale\b/i);

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
   * Reported 2026-07-26: thousands of pixels of scrollable emptiness below the
   * footer. Cause: each post/row carries an absolutely-positioned `sr-only`
   * span, and an absolute element is only clipped by an overflow ancestor that
   * is ALSO its containing block. The capped scroll containers were static, so
   * the spans resolved against the card section instead, laid out at full
   * height, and stretched the document by ~9,000px.
   *
   * This asserts the invariant rather than the mechanism: nothing scrollable
   * may exist meaningfully below the footer.
   */
  test("the page ends at the footer — no scrollable void beneath it", async ({ page }) => {
    await mockApiRoutes(page);
    // The shared fixture holds 3 posts, which fit inside the capped list and so
    // could never reproduce this. Override with enough posts to overflow it —
    // the overflow IS the condition under test.
    await page.route("**/api/social**", async (route) => {
      const posts = Array.from({ length: 40 }, (_, i) => ({
        id: `flood-${i}`,
        source: "official",
        authorHandle: "swizardcore",
        authorName: "SMOKING WIZARD",
        authorAvatarUrl: null,
        text: `post ${i} — ${"filler ".repeat(20)}`,
        createdAt: Date.now() - i * 3_600_000,
        likes: i,
        reposts: 0,
        replies: 0,
        media: [],
        url: "https://x.com/swizardcore",
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          stale: false,
          dataAsOf: Date.now(),
          data: { source: "official", posts, lastFetchedAt: Date.now(), hiddenCount: 0 },
        }),
      });
    });
    await page.goto("/", { waitUntil: "networkidle" });

    // Guard the guard: the list must actually be overflowing, or this proves nothing.
    const overflowing = await page.evaluate(() => {
      const ol = document.querySelector("#feed ol");
      return !!ol && ol.scrollHeight > ol.clientHeight + 200;
    });
    expect(overflowing, "the feed list must overflow for this test to mean anything").toBe(true);

    const slack = await page.evaluate(() => {
      const footer = document.querySelector("footer")!;
      const footerBottom = footer.getBoundingClientRect().bottom + window.scrollY;
      return document.documentElement.scrollHeight - footerBottom;
    });

    // A little trailing margin is normal; a screenful is not.
    expect(slack).toBeLessThan(200);
  });

  test("each shareable card offers its image, and the route rejects anything else", async ({
    page,
  }) => {
    await mockApiRoutes(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // The four modules that answer a question on their own carry the affordance…
    for (const [anchor, slug] of [
      ["#ledger", "ledger"],
      ["#holders", "holders"],
      ["#safety", "wards"],
      ["#verdict", "verdict"],
    ] as const) {
      const link = page.locator(anchor).getByRole("link", { name: /shareable image/i });
      await expect(link, anchor).toHaveAttribute("href", `/share/${slug}`);
    }

    // …and the ones that would lose their meaning as a still image do not.
    for (const anchor of ["#chart", "#tape", "#flow", "#feed"]) {
      await expect(
        page.locator(anchor).getByRole("link", { name: /shareable image/i }),
        anchor,
      ).toHaveCount(0);
    }
  });

  /**
   * The Buy menu, reported broken from real use and fixed 2026-07-26. Its panel
   * carried both `.wiz-card` and `absolute`; `.wiz-card` declares
   * `position: relative` and wins the cascade, so the panel dropped into normal
   * flow, stretched the header row to 210px and shoved its contents off-screen.
   * It also could not be dismissed by clicking away.
   */
  test("the Buy menu opens below the button without moving the header", async ({ page }) => {
    await mockApiRoutes(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // "Buys" is also a button (the tape's side filter) — scope to the header.
    const buy = page.locator("header").getByRole("button", { name: "Buy ✦" });
    const menu = page.getByRole("menu", { name: /where to buy/i });
    const headerRow = page.locator("header .ml-auto").first();

    const rowBefore = await headerRow.boundingBox();
    await buy.click();
    await expect(menu).toBeVisible();

    // The panel must float: opening it may not change the header row's height.
    const rowAfter = await headerRow.boundingBox();
    expect(rowAfter?.height).toBeCloseTo(rowBefore?.height ?? 0, 0);

    // …and it must sit below the button, fully on screen.
    const buyBox = await buy.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(menuBox!.y).toBeGreaterThanOrEqual(buyBox!.y + buyBox!.height);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);

    await expect(page.getByRole("menuitem", { name: /axiom/i })).toBeVisible();

    // Dismisses by clicking away.
    await page.mouse.click(30, 400);
    await expect(menu).toBeHidden();
  });

  /**
   * Two dismissal bugs reported from real use, fixed 2026-07-25:
   *   • the backdrop swallowed clicks meant for "outside the dialog", so clicking
   *     away never closed the palette;
   *   • Escape was bound to the input, so once a stray click moved focus to
   *     <body> the key reached nothing and the palette appeared stuck open.
   */
  test("the palette dismisses on a click outside, and on Escape without focus", async ({
    page,
  }) => {
    await mockApiRoutes(page);
    await page.goto("/", { waitUntil: "networkidle" });

    const dialog = page.getByRole("dialog", { name: /command palette/i });
    const openPalette = async () => {
      await page.keyboard.press("ControlOrMeta+k");
      await expect(dialog).toBeVisible();
    };

    // 1. A click well clear of the dialog closes it.
    await openPalette();
    await page.mouse.click(20, 20);
    await expect(dialog).toBeHidden();

    // 2. Escape closes even when focus is not in the search field. Clicking the
    //    dialog's own footer blurs the input without dismissing the palette.
    await openPalette();
    await dialog.getByText(/navigate/i).click();
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("combobox", { name: /search commands/i })).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
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

  test("the header VHS switch shares its state with the palette command", async ({ page }) => {
    await mockApiRoutes(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // Both controls drive the same state (lib/vhs.ts, DOM attribute as the source
    // of truth) — two switches that disagreed would be worse than one.
    const headerSwitch = page.getByRole("switch", { name: /vhs overlay/i });
    await expect(headerSwitch).toHaveAttribute("aria-checked", "true");

    await headerSwitch.click();
    await expect(page.locator("html")).toHaveAttribute("data-grain", "off");
    await expect(headerSwitch).toHaveAttribute("aria-checked", "false");

    // The palette, opened after, must show the state the header just set.
    await page.getByRole("button", { name: /open command palette/i }).click();
    await page.getByRole("combobox", { name: /search commands/i }).fill("vhs");
    await expect(page.getByRole("option", { name: /turn vhs overlay on/i })).toBeVisible();
  });

  test("the VHS overlay toggles off from the palette", async ({ page }) => {
    await mockApiRoutes(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // Default is on (no attribute); toggling sets data-grain="off" on <html>.
    await expect(page.locator("html")).not.toHaveAttribute("data-grain", "off");
    await page.getByRole("button", { name: /open command palette/i }).click();
    // Searched by an old keyword on purpose: "grain" must keep finding it now
    // that the command is labelled "VHS overlay".
    await page.getByRole("combobox", { name: /search commands/i }).fill("grain");
    await page.getByRole("option", { name: /vhs overlay/i }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-grain", "off");

    // The overlay's layers must actually be painting when it is on.
    await page.reload({ waitUntil: "networkidle" });
    const painted = await page.evaluate(() => {
      const el = document.querySelector(".wiz-grain");
      if (!el) return null;
      const before = getComputedStyle(el, "::before");
      const after = getComputedStyle(el, "::after");
      return {
        grain: before.backgroundImage.includes("svg"),
        scanlines: after.backgroundImage.includes("repeating-linear-gradient"),
        track: !!document.querySelector(".wiz-vhs-track"),
      };
    });
    expect(painted).toEqual({ grain: true, scanlines: true, track: true });
  });
});
