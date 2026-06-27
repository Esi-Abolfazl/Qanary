/**
 * e2e specs for Qanary — Playwright drives the Vite dev server (port 1420)
 * with the Tauri IPC bridge mocked via @tauri-apps/api/mocks.
 *
 * Scenarios:
 *   1. Initial seeded snapshot renders correct status (green → "All clear")
 *   2. Refresh button → `refresh_now` invoked, UI re-renders with result
 *   3. Add-list modal → `add_list` invoked with parsed args
 *   4. Settings modal → `update_settings` invoked after changing a field
 */
import { test, expect } from "./fixtures";

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
  // Open the menu dropdown
  await page.getByRole("button", { name: /menu/i }).click();
  // Click "Add list"
  await page.getByRole("button", { name: /add list/i }).click();

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
  // Open menu → Settings
  await page.getByRole("button", { name: /menu/i }).click();
  await page.getByRole("button", { name: /^settings$/i }).click();

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
  // Open menu → Settings
  await page.getByRole("button", { name: /menu/i }).click();
  await page.getByRole("button", { name: /^settings$/i }).click();

  // Config card legend and both action buttons must be present
  await expect(page.getByText("Config", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /export/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /import/i })).toBeVisible();
});
