# 0004. Persist per-list collapsed state in config + dedicated save-only command

- **Status:** accepted
- **Date:** 2026-06-17
- **Deciders:** Esi-Abolfazl

## Context

Lists needed a remembered open/closed (collapsed) state that survives app restarts — an
explicit product decision. All existing config mutations route through `mutate()`, which
saves config **and** triggers a full network re-probe. Collapsing a list is a pure UI
action with no bearing on probe results, so firing a re-probe on every chevron click would
be wasteful (up to 9 concurrent TCP probes per click).

- The config already uses `#[serde(default)]` for optional fields (`icon`, `enabled`,
  `port`), so adding a new defaulted field is back-compatible with existing `config.json`
  files.
- The snapshot (`ListStatus`) is computed each cycle from config; it must carry `collapsed`
  so the UI can seed its local toggle correctly on the next cycle without an extra API call.

## Decision

Add `collapsed: bool` (serde default `false`) to `ServiceList` (persisted config) and
`ListStatus` (runtime snapshot). Introduce a dedicated `set_list_collapsed` command that
saves the config without triggering a re-probe. The frontend holds local collapsed state
for an instant toggle and persists fire-and-forget via this command.

## Alternatives considered

- **In-memory only (localStorage / React state)** — rejected: requester explicitly wanted
  persistence across restarts, and localStorage is not available in Tauri webviews without
  extra plugins.
- **Reuse `mutate()` for collapse** — rejected: `mutate()` always triggers a full
  background re-probe, which is unnecessary and wasteful for a UI-only state change.
- **Separate UI-state file** — rejected: over-engineering; adding one boolean to the
  existing config is simpler and the serde default keeps it back-compatible.

## Consequences

## **Positive:**

- Instant, persistent collapse toggle with no network overhead.
- Schema addition is fully back/forward-compatible (`#[serde(default)]`).
- Pattern is consistent with how `icon` and `enabled` were added before (ADRs 0003, 0001).

## **Negative / accepted trade-offs:**

- Two persistence paths now exist: `mutate()` (saves + re-probes) and `set_list_collapsed`
  (save only). Future contributors must know which to use for new commands.

## **Follow-ups:**

- If more UI-only state is needed in future (e.g. per-service notes, sort order), consider
  a separate `ui_state.json` to clearly separate UI preferences from probe config.
