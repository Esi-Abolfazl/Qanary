# 0016. Multi-version changelog: list contract, accordion modal, on-demand from Settings

- **Status:** accepted
- **Date:** 2026-06-25
- **Deciders:** Esi-Abolfazl

## Context

The "What's new" modal previously showed only the CHANGELOG section for the currently running
version. A user who skipped several releases (e.g. 1.0.0 → 1.0.3 in one install) saw only
the 1.0.3 notes; everything between was silently lost. Additionally, there was no way to
re-open the changelog after dismissing it — Settings had no such button.

The Tauri command `take_new_changelog` returned a single `Option<ChangelogPayload>`
(`{version, body} | null`). Showing multiple skipped versions required a new return shape.

## Decision

**`changelog_entries()` in commands.rs.** A new private function parses every `## [version]`
block in CHANGELOG.md into a `Vec<ChangelogPayload>`, newest-first, applying `modal_notes`
(dev-only section stripping) to each. Entries with empty bodies after stripping are dropped.

**`take_new_changelog` returns `Vec<ChangelogPayload>`.** The command now collects all entries
above `last_changelog_version` in the file (i.e. newer than the last-seen version) and returns
them. Two edge cases are handled quietly (empty list, no auto-modal):
- `last_changelog_version` is `None` (fresh install): quiet first launch.
- `last_changelog_version` is not found in CHANGELOG.md (pruned old entry): quiet, use the
  Settings button to browse.

The existing short-circuit (when running == last-seen, return early without re-saving) is
preserved so the modal fires exactly once per version.

**New `get_changelog` command.** Returns all entries for the manual "Release notes" button in
Settings. Does not touch `last_changelog_version`, so clicking it never marks notes as seen.

**`ChangelogModal` renders a native `<details>` accordion.** The modal accepts `entries:
ChangelogEntry[]`. The first entry is rendered `<details open>` (expanded); subsequent entries
are collapsed. The existing `renderMarkdown` function is reused per entry — no new Markdown
engine needed. The title reads "What's new" for multiple entries and "Qanary vX.Y.Z" for a
single entry.

**"Release notes" button in Settings.** Added beside the app version label in the
`.update-row`. Calls `getChangelog()`, sets the changelog state, closes Settings, and opens
the modal. The `onShowReleaseNotes` prop threads this handler from App down to Settings.

**Frontend contract change (api.ts):** `takeNewChangelog` → `ChangelogEntry[]` (was
`{version,body}|null`); `getChangelog` → `ChangelogEntry[]` (new). Callers updated together
with test mocks.

## Alternatives considered

- **Flat stacked list (no accordion)** — rejected. With several skipped versions the modal
  would become a wall of text; `<details>` gives context at a glance.
- **Semver comparison library** — rejected. CHANGELOG.md is already newest-first, so "entries
  above the last-seen heading" is a simple `take_while` with no version parsing.
- **Auto-show full history on fresh install** — rejected. Noisy and unexpected on first launch;
  the Settings "Release notes" button provides on-demand access.

## Consequences

## **Positive:**

- Users who skipped versions see all intermediate release notes in one modal.
- Full changelog is always accessible from Settings with one click.
- Fresh installs stay quiet (no surprise modal on first launch).
- Reuses the existing Markdown renderer and `<details>` (no new dependencies).

## **Negative / accepted trade-offs:**

- Tauri command return shape changed for `take_new_changelog` (list instead of option). All
  callers (App.tsx, api.ts, test mocks) were updated together; no config migration needed
  since `last_changelog_version` persistence is unchanged.

## **Follow-ups:**

- CSS for `.cl-version` and `.cl-version-summary` may need design polish to match the canary
  design system (ADR 0006) — functional but unstyled at this point.
