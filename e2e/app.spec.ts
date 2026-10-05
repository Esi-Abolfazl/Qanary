/**
 * e2e specs for Qanary — Playwright drives the Vite dev server (port 1420)
 * with the Tauri IPC bridge mocked via @tauri-apps/api/mocks.
 *
 * Scenarios:
 *   1. Initial seeded snapshot renders correct status (green → "All clear")
 *   2. Refresh button → `refresh_now` invoked
 *   3. Add-list modal → `add_list` invoked with parsed args
 *   4. Settings modal → `update_settings` invoked after changing a field
 *   5. Settings Config card → Export / Import buttons
 *   6. List reorder survives a `service-update` delta
 *   7. A long list name shows an ellipsis, scrolls to its end on hover and eases back
 *   8. The hero's boxes (☰, orb, IP chip, logo) sit on the cards' left and right edges; the list icons share a centre line
 *   8b. The list count is as far from the next icon as the icons are from each other
 *   8c. The orb's refresh arrow uses the orb icons' frame and stroke, at 0.85 opacity
 *   9. A service being re-checked shows an animated "Pinging…", then its result
 *  10. Long names never push a row past its card: the row buttons stay inside it
 *  11. Lists stack in a narrow window, sit side by side in a wide one, and a full-screen window
 *      centers them at 480px each instead of stretching
 *  8d. Controls share one family: 32px / 12px (28px / 10px small), cards and dialogs 16px
 *  8e. The open ☰ drawer is the ☰'s own shape stretched: every cell 32px, no uneven gap at either end
 *  8f. The Pulse orb's ripples are outlines that keep its corners; its shake never tilts it
 *  12. The Pulse alarm shows its dead line on arrival, dashed and crawling, and its X beats (the orb's
 *      draw-in must not override them)
 *  13. The ☰ drawer grows out to the ☰'s left (the ☰ turning into a ›), names an action on hover,
 *      and slides shut on Escape
 */
import { test, expect, SNAPSHOT } from "./fixtures";
import type { Page } from "@playwright/test";
import { LIST_MAX_PX, columnCount } from "../src/utils/listColumns";
import { DRAWER_MS } from "../src/components/useCollapsible";

// Add list, Edit order and Settings sit in the hero's ☰ drawer.
async function heroAction(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("group", { name: "App actions" }).getByRole("button", { name }).click();
}

// The column count follows the window's resize event, so wait for that re-render before measuring.
async function setWidth(page: Page, width: number, height = 720) {
  await page.setViewportSize({ width, height });
  await expect
    .poll(async () => {
      const [cols, lists] = await page.evaluate(() => [
        Number(getComputedStyle(document.querySelector(".app")!).getPropertyValue("--cols")),
        document.querySelectorAll(".list").length,
      ]);
      return cols === columnCount(width, lists);
    })
    .toBe(true);
}

test("1 — initial snapshot renders green status", async ({ mockedPage: page }) => {
  // Hero should show the "all clear" headline for overall=green
  await expect(page.locator(".hero-headline")).toContainText("All clear");
  // The seeded list name should be visible
  await expect(page.getByText("Internet")).toBeVisible();
});

test("2 — refresh button triggers refresh_now command", async ({
  mockedPage: page,
  getInvokedCmds,
}) => {
  // The refresh button is the status-light button (aria-label="Refresh")
  const refreshBtn = page.getByRole("button", { name: /refresh/i });
  await refreshBtn.click();

  // After click, refresh_now should appear in the invoked commands
  await expect.poll(() => getInvokedCmds()).toContain("refresh_now");

  // Hero should still show green (mock returns the same snapshot)
  await expect(page.locator(".hero-headline")).toContainText("All clear");
});

test("3 — add-list modal submits add_list command", async ({
  mockedPage: page,
  getInvokedCmds,
}) => {
  await heroAction(page, /add list/i);

  // Fill in the list name modal
  const nameInput = page.getByPlaceholder(/list name/i);
  await nameInput.fill("Test List");

  // Submit the modal
  const saveBtn = page.getByRole("button", { name: /add|save|create/i }).last();
  await saveBtn.click();

  // Verify add_list was called
  await expect.poll(() => getInvokedCmds()).toContain("add_list");
});

test("4 — settings modal opens and update_settings is invoked", async ({
  mockedPage: page,
  getInvokedCmds,
}) => {
  await heroAction(page, /^settings$/i);

  // Settings panel should be visible
  await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();

  // Find and click a "Save" or "Apply" button
  const saveBtn = page.getByRole("button", { name: /save|apply/i }).last();
  await saveBtn.click();

  // Verify update_settings was called
  await expect.poll(() => getInvokedCmds()).toContain("update_settings");
});

test("5 — settings panel shows Config card with Export and Import buttons", async ({
  mockedPage: page,
}) => {
  await heroAction(page, /^settings$/i);

  // Config card legend and both action buttons must be present
  await expect(page.getByText("Config", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /export/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /import/i })).toBeVisible();
});

// R3: a reorder painted without moving the delta merge base was reverted by the next
// per-service update (the backend's probe results keep arriving while you drag).
test("6 — a list reorder survives the next service-update", async ({
  mockedPage: page,
  getInvokedCmds,
  emitEvent,
}) => {
  const names = page.locator(".list-name-text");
  await expect(names).toHaveText(["Internet", "Intranet"]);

  await page.getByRole("button", { name: "List options" }).first().click();
  await page.getByRole("button", { name: "Edit order" }).click();

  const grip = page.locator(".list-grip-btn");
  const from = (await grip.nth(1).boundingBox())!;
  const to = (await grip.nth(0).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y - 10, { steps: 12 });
  await page.mouse.up();
  await expect(names).toHaveText(["Intranet", "Internet"]);
  await expect.poll(() => getInvokedCmds()).toContain("reorder_lists");

  await emitEvent("service-update", {
    list_id: "internet",
    service: {
      id: "s1",
      label: "Google",
      state: "up",
      endpoints: [{ id: "e1", host: "google.com", state: "up", latency_ms: 25 }],
    },
    list_all_down: false,
    overall: "green",
    cut_off: false,
    settled: true,
  });
  await expect(page.getByText("25 ms")).toBeVisible();
  await expect(names).toHaveText(["Intranet", "Internet"]);

  await page.getByRole("button", { name: /^done$/i }).click();
  await expect(names).toHaveText(["Intranet", "Internet"]);
});

/** A snapshot with one list, for the cases where names are long. */
const longSnapshot = (listName: string, serviceLabel: string) => ({
  lists: [
    {
      id: "internet",
      name: listName,
      icon: "🏢",
      collapsed: false,
      critical: true,
      all_down: false,
      services: [
        {
          id: "g",
          label: "Claude",
          state: "up",
          endpoints: [
            { id: "a", host: "claude.ai", state: "up", latency_ms: 30 },
            { id: "b", host: "api.anthropic.com", state: "up", latency_ms: 32 },
          ],
        },
        {
          id: "s2",
          label: serviceLabel,
          state: "blocked",
          endpoints: [{ id: "d", host: "really-long-hostname.example.co.uk", state: "blocked", latency_ms: 55 }],
        },
      ],
    },
  ],
  overall: "green",
  wan: null,
  cut_off: false,
  settled: true,
});
const LONG_LIST = "Corporate intranet and internal services for the Tehran office";
const LONG_SERVICE = "A very long service label that keeps going and going";

test("7 — a long list name shows an ellipsis, scrolls on hover and eases back", async ({
  mockedPage: page,
  emitEvent,
}) => {
  await setWidth(page, 400, 560);
  await emitEvent("status-update", longSnapshot(LONG_LIST, "Digikala"));
  const text = page.locator(".list-name-btn").first();
  await expect(text).toContainText("Corporate intranet");
  // Cut off with an ellipsis (not clipped whole) …
  await expect(text).toHaveCSS("text-overflow", "ellipsis");
  const run = text.locator("span");
  // The name is longer than its chip, so it is cut off.
  await expect
    .poll(() => text.evaluate((el) => (el.firstElementChild as HTMLElement).getBoundingClientRect().width > el.clientWidth + 20))
    .toBe(true);
  // How far the text has moved left of its resting place, and how far its end is from the chip's edge.
  const moved = () => run.evaluate((el) => 0 - new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
  const gapAtEnd = () =>
    text.evaluate((el) => el.getBoundingClientRect().right - (el.firstElementChild as HTMLElement).getBoundingClientRect().right);
  expect(await moved()).toBe(0);

  await page.locator(".list-name").first().hover();
  await expect.poll(moved, { timeout: 4000 }).toBeGreaterThan(20);
  await expect(text).toHaveCSS("text-overflow", "clip"); // no ellipsis while it scrolls

  // At the end of the glide the last letter sits at the edge: no empty space after it.
  await expect.poll(async () => Math.abs(await gapAtEnd()), { timeout: 6000 }).toBeLessThan(1.5);

  await page.mouse.move(2, 400); // off the chip
  await expect.poll(moved, { timeout: 2000 }).toBe(0);
  await expect(text).toHaveCSS("text-overflow", "ellipsis");
});

test("8 — the hero sits on the cards' lines (text 6px in, orb on the icon column, ☰ on the edge); the list icons share a centre line", async ({
  mockedPage: page,
}) => {
  const edge = (sel: string, side: "left" | "right") =>
    page.locator(sel).first().evaluate((el, s) => el.getBoundingClientRect()[s], side);
  const centreX = (sel: string) =>
    page.locator(sel).first().evaluate((el) => {
      const b = el.getBoundingClientRect();
      return b.left + b.width / 2;
    });
  for (const width of [460, 400]) {
    await setWidth(page, width);
    // Left: the logo is on the cards' edge; the headline and the IP chip sit 6px in from it, together.
    const left = await edge(".list", "left");
    expect(Math.abs((await edge(".logo-mark", "left")) - left), `logo left at ${width}`).toBeLessThan(0.6);
    expect(Math.abs((await edge(".wan", "left")) - (left + 6)), `IP chip left at ${width}`).toBeLessThan(0.6);
    expect(Math.abs((await edge(".hero-headline", "left")) - (left + 6)), `headline left at ${width}`).toBeLessThan(0.6);
    // Right: the ☰ and the orb end where the cards end.
    const right = await edge(".list", "right");
    expect(Math.abs((await edge('button[aria-label="Menu"]', "right")) - right), `☰ right at ${width}`).toBeLessThan(0.6);
    // The orb's halo (6px ring) ends on the right edge of the icon column inside the cards (the
    // chevron); its box is measured, not the orb itself, which pops from a smaller size on arrival.
    const chevronRight = await edge(".list-chevron-btn", "right");
    expect(Math.abs((await edge(".orb-wrap", "right")) + 6 - chevronRight), `orb halo vs icon column at ${width}`).toBeLessThan(0.6);
    // Inside the cards the header chevron and each row's ⋮ still share one centre line.
    const chevron = await centreX(".list-chevron-btn svg");
    const rowMenu = await centreX(".row .list-menu-wrap .list-menu-btn svg");
    expect(Math.abs(rowMenu - chevron), `row menu vs chevron at ${width}`).toBeLessThan(0.6);
  }
});

test("8d — controls share one size and corner family; cards and dialogs have their own", async ({
  mockedPage: page,
}) => {
  const look = (sel: string) =>
    page.locator(sel).first().evaluate((el) => {
      const c = getComputedStyle(el);
      return { h: el.getBoundingClientRect().height, r: c.borderTopLeftRadius };
    });
  // The ☰, the IP chip and a list's name chip: one 32px control with 12px corners.
  for (const sel of ['button[aria-label="Menu"]', ".wan", ".list-name"]) {
    expect(await look(sel), sel).toEqual({ h: 32, r: "12px" });
  }
  // A small button (the ⋯ and + in a list header): 28px with 10px corners.
  expect(await look(".list-head .list-menu-btn")).toEqual({ h: 28, r: "10px" });
  // A list card: 16px.
  expect((await look(".list")).r).toBe("16px");
  // The Add list dialog: a 16px sheet whose fields and buttons are the same 12px controls.
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Add list" }).click();
  expect((await look(".modal")).r).toBe("16px");
  expect((await look(".modal-name-input")).r).toBe("12px");
  expect(await look(".modal-save")).toEqual({ h: 36, r: "12px" });
  expect(await look(".modal-cancel")).toEqual({ h: 36, r: "12px" });
});

test("8e — the open drawer is the ☰ stretched: same height, equal 32px cells, equal ends", async ({
  mockedPage: page,
}) => {
  const menu = page.getByRole("button", { name: "Menu" });
  const bg = (loc: ReturnType<typeof page.locator>) => loc.evaluate((e) => getComputedStyle(e).backgroundImage);
  // Hovering the closed ☰ lights the same surface; it never swaps to another background.
  const restBg = await bg(menu);
  await menu.hover();
  await expect.poll(() => menu.evaluate((e) => getComputedStyle(e).filter)).toContain("brightness");
  expect(await bg(menu)).toBe(restBg);

  await menu.click();
  const drawer = page.locator(".hero-drawer");
  await expect(drawer).toHaveAttribute("data-anim", "open");
  await page.waitForTimeout(700);
  const rect = (loc: ReturnType<typeof page.locator>) =>
    loc.evaluate((e) => {
      const b = e.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, h: b.height, w: b.width };
    });
  const d = await rect(drawer);
  const toggle = await rect(menu);
  const cells = await page.locator(".hero-drawer-btn").evaluateAll((els) =>
    els.map((e) => {
      const b = e.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, h: b.height, w: b.width };
    }),
  );
  expect(d.h).toBe(toggle.h); // as tall as the ☰ itself
  expect(Math.abs(d.r - toggle.r)).toBeLessThan(0.01); // the ☰ is its end cell
  const sorted = [...cells].sort((a, b) => a.l - b.l);
  expect(Math.abs(sorted[0].l - d.l), "first cell flush with the capsule's left end").toBeLessThan(0.01);
  for (const c of cells) {
    expect(c.w).toBe(toggle.w);
    expect(c.h).toBe(toggle.h);
    expect(Math.abs(c.t - toggle.t)).toBeLessThan(0.01);
  }
  // Cells touch each other and the ☰: nothing is wider on one side.
  [...sorted, toggle].slice(1).forEach((c, i) => {
    const prev = [...sorted, toggle][i];
    expect(Math.abs(c.l - prev.r), `cell ${i + 1} abuts the previous one`).toBeLessThan(0.01);
  });
  expect(Math.abs(d.w - (cells.length + 1) * toggle.w)).toBeLessThan(0.01);
  // The capsule's own box is the drawer's box (its border is inside its width).
  expect(await drawer.evaluate((e) => getComputedStyle(e, "::before").boxSizing)).toBe("border-box");
});

test("8f — the Pulse orb's ripples are outlines that keep the orb's corners; its shake does not tilt it", async ({
  mockedPage: page,
}) => {
  const orb = page.locator(".status-orb");
  await orb.evaluate((o) => {
    o.setAttribute("data-icon", "pulse"); // the fixture's config may draw Rings
    o.classList.add("status-orb-busy");
  });
  // A ripple is an outline of fixed width around a box with the orb's own corners, moved out by its
  // offset: the browser rounds it concentrically, so the gap is the same all the way round.
  const ripple = () =>
    orb.evaluate((o) => {
      const c = getComputedStyle(o, "::after");
      return { w: c.outlineWidth, style: c.outlineStyle, offset: parseFloat(c.outlineOffset), radius: c.borderTopLeftRadius, border: c.borderTopWidth };
    });
  await expect.poll(async () => (await ripple()).offset, { timeout: 4000 }).toBeGreaterThan(2);
  const r = await ripple();
  expect(r.w).toBe("2px");
  expect(r.style).toBe("solid");
  expect(r.border).toBe("0px"); // not a border whose radius changes every frame
  expect(r.radius).toBe(await orb.evaluate((o) => getComputedStyle(o).borderTopLeftRadius));
  // A circle's ripple stays a circle.
  await orb.evaluate((o) => o.setAttribute("data-icon", "rings"));
  expect(await orb.evaluate((o) => getComputedStyle(o, "::after").borderTopLeftRadius)).toBe("50%");

  // The alarm shake: a square must not rotate; a circle can.
  await orb.evaluate((o) => {
    o.classList.remove("status-orb-busy");
    o.classList.add("orb-pop", "orb-flash", "orb-shake");
  });
  const shake = () => orb.evaluate((o) => getComputedStyle(o).animationName);
  await orb.evaluate((o) => o.setAttribute("data-icon", "pulse"));
  expect(await shake()).toContain("orb-shake-flat");
  await orb.evaluate((o) => o.setAttribute("data-icon", "rings"));
  expect(await shake()).not.toContain("orb-shake-flat");
});

test("8b — the list count sits as far from the next icon as the icons sit from each other", async ({
  mockedPage: page,
}) => {
  const gaps = () =>
    page.locator(".list-head").first().evaluate((head) => {
      const count = head.querySelector(".list-count")!.getBoundingClientRect();
      const glyphs = [...head.querySelectorAll(".list-menu-btn svg")].map((s) => s.getBoundingClientRect());
      return { count: glyphs[0].left - count.right, icons: glyphs.slice(1).map((g, i) => g.left - glyphs[i].right) };
    });
  const normal = await gaps();
  for (const icons of normal.icons) expect(Math.abs(icons - normal.count)).toBeLessThan(0.6);

  // Edit order leaves only the chevron; the count keeps the same distance to it.
  await page.getByTitle("List options").first().click();
  await page.getByRole("button", { name: /edit order/i }).click();
  expect(Math.abs((await gaps()).count - normal.count)).toBeLessThan(0.6);
});

test("8c — the orb's refresh arrow is drawn in the orb icons' frame, a little bolder", async ({
  mockedPage: page,
}) => {
  const look = (sel: string) =>
    page.locator(sel).first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: [cs.width, cs.height], stroke: parseFloat(cs.strokeWidth), viewBox: el.getAttribute("viewBox") };
    });
  const arrow = await look(".orb-refresh svg");
  const icon = await look(".status-orb .orb-icon");
  expect({ size: arrow.size, viewBox: arrow.viewBox }).toEqual({ size: icon.size, viewBox: icon.viewBox });
  // Bolder than the status icons (2.2 against their 1.5): it is a button's hint, so it should read.
  expect(arrow.stroke).toBeGreaterThan(icon.stroke);
  // …at 0.85, so it reads as part of the orb rather than a sticker on it.
  await expect(page.locator(".orb-refresh svg")).toHaveCSS("opacity", "0.85");
});

test("9 — a service being re-checked shows Pinging… and then its result", async ({
  mockedPage: page,
  emitEvent,
}) => {
  const delta = (state: "checking" | "up", latency: number | null) => ({
    list_id: "internet",
    service: {
      id: "s1",
      label: "Google",
      state,
      endpoints: [{ id: "e1", host: "google.com", state, latency_ms: latency }],
    },
    list_all_down: false,
    overall: "green",
    cut_off: false,
    settled: state === "up",
  });

  await emitEvent("service-update", delta("checking", null));
  const pinging = page.locator(".row-pinging").first();
  await expect(pinging).toBeVisible();
  await expect(pinging).toContainText("Pinging");
  await expect(pinging.locator(".ping-dots i")).toHaveCount(3);
  // The dots really animate: their opacity changes between two samples.
  const dot = pinging.locator(".ping-dots i").first();
  const samples = new Set<string>();
  for (let i = 0; i < 6; i++) {
    samples.add(await dot.evaluate((el) => getComputedStyle(el).opacity));
    await page.waitForTimeout(200);
  }
  expect(samples.size).toBeGreaterThan(1);

  await emitEvent("service-update", delta("up", 31));
  await expect(page.getByText("31 ms")).toBeVisible();
  await expect(page.locator(".row-pinging")).toHaveCount(0);
});

test("10 — long names never push a row's buttons out of its card", async ({
  mockedPage: page,
  emitEvent,
}) => {
  const right = (sel: string, i = 0) =>
    page.locator(sel).nth(i).evaluate((el) => el.getBoundingClientRect().right);
  for (const width of [460, 400]) {
    await setWidth(page, width, 560);
    await emitEvent("status-update", longSnapshot(LONG_LIST, LONG_SERVICE));
    await expect(page.getByRole("button", { name: LONG_SERVICE })).toBeVisible();
    const card = await right(".list");
    // Every row (a group and a plain service) keeps its ⋮ inside the card…
    for (let i = 0; i < 2; i++) {
      expect(await right(".row .list-menu-wrap", i), `row ${i} ⋮ at ${width}`).toBeLessThanOrEqual(card);
    }
    // …and so does the group's chevron, and the rows themselves are no wider than the card.
    expect(await right(".row-chev"), `chevron at ${width}`).toBeLessThanOrEqual(card);
    expect(await right(".row", 1), `row at ${width}`).toBeLessThanOrEqual(card);
    // Nothing makes the page scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("11 — lists sit side by side once the window fits two, each capped in width", async ({
  mockedPage: page,
}) => {
  const box = (i: number) => page.locator(".list").nth(i).evaluate((el) => el.getBoundingClientRect());
  const at = async (width: number) => {
    await setWidth(page, width);
    return [await box(0), await box(1)];
  };

  let [a, b] = await at(460);
  expect(b.top, "stacked at 460").toBeGreaterThan(a.bottom - 1);

  [a, b] = await at(1000);
  expect(b.top, "same row at 1000").toBe(a.top);
  expect(b.left, "second list to the right").toBeGreaterThan(a.right);

  // One column short of fitting a second: the card stays at its cap, centered.
  [a] = await at(750);
  expect(a.width, "capped at 750").toBeLessThanOrEqual(LIST_MAX_PX);

  // Full screen: the block is only as wide as two cards, centered, and the hero shares it.
  [a, b] = await at(1900);
  expect(a.width, "card width at 1900").toBeLessThanOrEqual(LIST_MAX_PX);
  expect(Math.abs(a.left - (1900 - b.right)), "centered").toBeLessThanOrEqual(1);
  const orb = await page.locator(".orb-wrap").evaluate((el) => el.getBoundingClientRect().right);
  // The orb sits 17px in from the lists' edge (its halo 6 + the cards' icon column 11).
  expect(Math.abs(orb - b.right), "hero ends where the lists end").toBeLessThanOrEqual(20);
});

test("12 — the Pulse alarm line stays dashed and crawling, its X beating", async ({
  mockedPage: page,
  emitEvent,
}) => {
  // Runs after the fixture's init script, so the reload boots the mock with the Pulse icon saved.
  await page.addInitScript(() => {
    const w = window as unknown as { __MOCK__: { cfg: object } };
    w.__MOCK__.cfg = { ...w.__MOCK__.cfg, status_icon: "pulse" };
  });
  await page.reload();
  await page.waitForSelector(".status-orb .orb-icon-pulse");
  await page.waitForSelector('[aria-label="Refresh"]:not([disabled])');
  const down = SNAPSHOT.lists.map((l) => ({
    ...l,
    critical: true,
    all_down: true,
    services: l.services.map((s) => ({
      ...s,
      state: "down",
      endpoints: s.endpoints.map((e) => ({ ...e, state: "down", latency_ms: null })),
    })),
  }));
  await emitEvent("status-update", { ...SNAPSHOT, lists: down, overall: "red" });

  const icon = page.locator(".status-orb .orb-icon-pulse[data-mood='alarm']");
  const style = (sel: string) =>
    icon.locator(sel).first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { dash: cs.strokeDasharray, anim: cs.animationName, opacity: Number(cs.opacity) };
    });
  // Arriving in Alarm shows the dead line at once, not the loop's calm-looking heartbeat.
  expect((await style(".pulse-beat")).opacity, "no heartbeat on arrival").toBe(0);
  expect((await style(".pulse-flat")).opacity, "dead line on arrival").toBeGreaterThan(0.5);
  const flat = await style(".pulse-flat");
  expect(flat.dash, "dashed line").toBe("2px, 4px");
  expect(flat.anim, "dashes crawl").toContain("pulse-march");
  expect((await style(".pulse-x")).anim, "X beats").toContain("orb-drain-x");
  if (await icon.locator(".pulse-maskline").count()) {
    expect((await style(".pulse-maskline")).anim, "mask line holds still").toBe("none");
  }
});

test("13 — the ☰ drawer grows out to its left, names an action on hover, and slides shut on Escape", async ({
  mockedPage: page,
}) => {
  const menu = page.getByRole("button", { name: "Menu" });
  const drawer = page.getByRole("group", { name: "App actions" });
  await expect(drawer).toHaveCount(0);

  // A frozen clock holds each animation phase (useCollapsible ends it with a timer), so a slow
  // run can't miss the frames. data-anim lands one render after aria-expanded.
  await page.clock.install();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(drawer).toHaveAttribute("data-anim", "open");
  // It animates in rather than appearing: the capsule starts at the ☰'s size.
  expect(await drawer.evaluate((d) => getComputedStyle(d, "::before").animationName)).toBe("hero-drawer-grow");
  // The drawer stays mounted for DRAWER_MS: every animation in it, delay included, must fit.
  const longestMs = async () => {
    const ends = await drawer.evaluate((d) =>
      d
        .getAnimations({ subtree: true })
        .filter((a) => a instanceof CSSAnimation) // a hover transition may be cut off by the unmount
        .map((a) => {
          const t = a.effect!.getComputedTiming();
          return Number(t.delay) + Number(t.activeDuration);
        }),
    );
    expect(ends.length, "the capsule and the three actions animate").toBeGreaterThanOrEqual(4);
    return Math.max(...ends);
  };
  expect(await longestMs()).toBeLessThanOrEqual(DRAWER_MS);

  // The ☰ has become Lucide's chevron-right (m9 18 6-6-6-6), pointing the way the drawer closes.
  await expect
    .poll(() =>
      menu.evaluate((btn) => {
        const svg = btn.querySelector("svg")!;
        return [".hero-burger-top", ".hero-burger-bot"].map((sel) => {
          const p = svg.querySelector<SVGPathElement>(sel)!;
          const toSvg = svg.getScreenCTM()!.inverse().multiply(p.getScreenCTM()!);
          return [0, p.getTotalLength()].map((d) => {
            const q = new DOMPoint(p.getPointAtLength(d).x, p.getPointAtLength(d).y).matrixTransform(toSvg);
            return [Math.round(q.x), Math.round(q.y)];
          });
        });
      }),
    )
    .toEqual([
      [[9, 6], [15, 12]],
      [[9, 18], [15, 12]],
    ]);

  const left = (name: string) => drawer.getByRole("button", { name }).evaluate((b) => b.getBoundingClientRect().left);
  const menuLeft = await menu.evaluate((b) => b.getBoundingClientRect().left);
  const [settings, order, add] = [await left("Settings"), await left("Edit order"), await left("Add list")];
  expect(settings).toBeLessThan(order);
  expect(order).toBeLessThan(add);
  expect(add).toBeLessThan(menuLeft);

  const tip = drawer.getByRole("button", { name: "Settings" }).locator(".hero-tip");
  await expect(tip).toHaveCSS("opacity", "0");
  await drawer.getByRole("button", { name: "Settings" }).hover();
  await expect(tip).toHaveCSS("opacity", "1");
  await expect(tip).toHaveText("Settings⌘,");
  // Off the pointer, the › is as muted as the actions beside it.
  const idle = await drawer.getByRole("button", { name: "Add list" }).evaluate((b) => getComputedStyle(b).color);
  await expect(menu).toHaveCSS("color", idle);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(drawer).toHaveAttribute("data-anim", "close");
  // It slides shut into the ☰ rather than fading where it stands: each action travels right.
  const closing = () =>
    drawer.evaluate((d) => ({
      capsule: getComputedStyle(d, "::before").animationName,
      action: getComputedStyle(d.querySelector(".hero-drawer-btn")!).animationName,
    }));
  await expect.poll(closing).toEqual({ capsule: "hero-drawer-shrink", action: "hero-item-out" });
  expect(await longestMs()).toBeLessThanOrEqual(DRAWER_MS);
  await page.clock.runFor(DRAWER_MS + 60);
  await expect(drawer).toHaveCount(0);
});
