# 0010. Mode-gated drag-reordering with @dnd-kit; save-only commands (no re-probe)

- **Status:** accepted
- **Date:** 2026-06-23
- **Deciders:** Esi-Abolfazl

## Context

Lists, Services within a list, and IP-provider slots are already stored as ordered `Vec`s (and their
frontend mirror `ListStatus[].services[]`). Order is already meaningful in all three cases: Lists
render top-to-bottom in the app window; Services render in list order; IP providers are tried in
sequence when resolving the WAN IP. Despite this, the UI offered no way to change that order after
initial creation — the only options were delete and recreate.

The problem was therefore: how to let users change order in-place without (a) triggering wasteful
network re-probes on every drag step, and (b) creating click/drag conflicts with the existing row
buttons (add, collapse, edit, remove).

No drag library was installed at the time; the React 19 project had no UI utility dependencies beyond
Tauri plugins.

## Decision

We add `@dnd-kit/core` and `@dnd-kit/sortable` for all three draggable surfaces. They are small (≈ 30 kB
gzipped combined), widely-used, and handle pointer/touch normalisation and accessibility attributes that
would otherwise require significant custom code.

**Reorder mode (Lists + Services):** An app-wide boolean `reorderMode` is toggled from a new "Edit order"
item in the hero menu. While active, drag grip handles appear on every list header and service row. A
floating "Done" button in the bottom-right exits the mode. Dragging is only possible inside this mode,
which eliminates click/drag conflicts entirely — the existing row buttons remain unchanged and are hidden
while the mode is active.

**Persist-on-drop (not on Done):** Each drop fires the corresponding save command immediately. Done only
exits the mode. This is crash-safe — if the user quits mid-session the last dropped order is already
persisted — and simpler than batching saves at Done.

**Two new save-only Rust commands** — `reorder_lists` and `reorder_services` — mirror `set_list_collapsed`
(ADR-0004): they reorder the target `Vec` by id-position, save to disk via `store::save`, and return the
updated config. They explicitly do **not** call `mutate()` and therefore do not trigger a background
re-probe. Dots do not flash to "checking" on drag.

**IP providers:** Drag-reorder is always available inline in the Settings modal (no separate mode). The
4-slot string array is promoted to `[{id, value}]` pairs to give dnd-kit stable item identities. On Save,
the existing `update_settings` command persists the new array order; this command does route through
`mutate()` and does re-probe — acceptable because changing provider order is a real settings change, not a
cosmetic reorder.

## Alternatives considered

- **Native HTML5 drag-and-drop API** — rejected. Cross-browser polish (ghost image suppression, drop
  targeting, pointer events) is fiddly and would have produced more app code than the dnd-kit dependency
  adds. dnd-kit is small and battle-tested.

- **Always-on drag (no mode toggle)** — rejected. The requester explicitly asked for an Edit-order →
  drag → Done flow. Always-on drag also creates conflicts: the list header has a favicon `<img>` (browser
  treats images as naturally draggable), and row buttons overlap potential drag targets.

- **Route list/service reorder through `mutate()`** — rejected. `mutate()` always triggers a background
  re-probe (see ADR-0004). A re-probe per drag step would cause every service dot to flash to "checking"
  with every drop, which is noisy and confusing.

- **Cross-list service moves** — deferred. Requires a `move_service` command and cross-list drop zones.
  Out of scope for this change; within-container reordering covers the primary use case.

## Consequences

### Positive:

- Users can reorder Lists, Services, and IP providers without delete-and-recreate.
- Reorder mode provides an explicit, low-conflict surface for drag; no click/drag ambiguity.
- Persist-on-drop is crash-safe; order is durable from the moment of the drop.
- Config shape (`Vec` order) is unchanged — old and new `config.json` are mutually compatible; no
  migration needed.
- `reorder_lists` / `reorder_services` carry zero probe-cycle cost (save-only, like collapse).

### Negative / accepted trade-offs:

- One new frontend dependency (`@dnd-kit`). Locked to its API surface for drag interactions.
- Nested `DndContext`s (outer for lists, inner per-list for services) while in reorder mode. dnd-kit
  supports nesting via separate `SortableContext` id sets; service drags stay inside their container.
- App-wide `reorderMode` flag is threaded through two component levels (`App` → `ServiceList` →
  `ServiceRow`). Acceptable for a boolean flag; would warrant a context if it grew.
- IP-provider reorder re-probes on Save (via `update_settings`). Accepted — provider order change
  is a genuine settings mutation, not a cosmetic reorder.

### Follow-ups:

- Cross-list service moves (deferred above) if the need arises.
- Touch/keyboard drag tuning beyond dnd-kit defaults (currently desktop-mouse only).
