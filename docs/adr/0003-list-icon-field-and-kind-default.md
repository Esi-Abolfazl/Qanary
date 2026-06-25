# 0003. List identity = name + icon (separate fields); new lists default to Internet kind

- **Status:** accepted
- **Date:** 2026-06-17
- **Deciders:** Esi-Abolfazl

## Context

Lists previously carried only a `name` field. The product wanted an emoji icon shown
visually distinct from the name — e.g. `🌍` beside `Global` — so the two need to be
independently editable. At the same time, the add-list UI was simplified to just
icon + name (no kind selector) to keep the form minimal. The `kind` field still exists
in the model because it drives outage severity (`internet` → yellow warning,
`intranet` → red critical), but exposing it to users at creation time added friction
for a distinction most users would leave at default.

## Decision

1. Add a persisted `icon: String` field (with `#[serde(default)]` for backwards
   compatibility) to `ServiceList` in `models.rs`, and expose it in the `ListStatus`
   snapshot.
2. Change `add_list(name, kind)` → `add_list(name, icon)`. New lists always get
   `ListKind::Internet` (the gentler yellow severity) — kind is not user-selectable
   at creation time.
3. Add `update_list(list_id, name, icon)` for the new Edit modal; kind is immutable
   after creation.
4. Reseed `Config::default()` with `Global`/`🌍` (Internet) and `Iran`/`🇮🇷` (Intranet).
   No migration of existing configs — the user wipes config manually.

## Alternatives considered

- **Encode icon as a prefix inside `name`** — rejected: can't edit independently,
  brittle to parse, breaks existing `name`-based display logic.
- **Keep kind selectable in the add-list form** — rejected: added a third field to a
  form that only needed two; most users would leave it at internet anyway.
- **Migrate existing configs on load** — rejected: only one user (the author), who
  wipes config manually; the migration code adds risk for zero gain here.

## Consequences

### Positive:
- Icon editable independently of name via the Edit modal.
- Simpler add-list form (icon + name only).
- `#[serde(default)]` on `icon` means old config files deserialise without errors.

### Negative / accepted trade-offs:
- New lists can only be `internet` severity. A future "Edit kind" feature would be
  needed to make a list intranet after creation.
- Existing config names (`Internet`, `Intranet`) stay unchanged until the user edits
  or wipes config.

### Follow-ups:
- Add kind editing to the Edit modal if the need arises.
