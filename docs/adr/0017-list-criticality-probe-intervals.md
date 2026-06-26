# 0017. Probe interval keyed by list criticality, not per service

- **Status:** accepted
- **Date:** 2026-06-26
- **Deciders:** Esi

## Context

The backlog (`docs/TODO.md`) carried "per-service probe interval override" — let each
Service set its own probe cadence. In practice only two cadences are wanted: probe
**critical** lists often (so outages surface fast) and **non-critical** lists rarely (to
spare the network). The `ServiceList.critical` flag already exists and already drives the
severity rollup, so it is the natural key for cadence too. A single global
`probe_interval_secs` (default 30) governed every Service before this change; the
per-Service probe-task rewrite (ADR-0014) reads that base once per cycle.

## Decision

- Replace `Config.probe_interval_secs` with two global settings:
  `critical_interval_secs` (default **30**) and `noncritical_interval_secs` (default
  **60**). Both `#[serde(default)]`, so old `config.json` files load unchanged — the now
  unknown `probe_interval_secs` key is ignored and the new fields fall back to defaults.
- The Service probe task selects its base interval from its parent list's `critical`
  flag via a pure `base_interval(critical, crit, noncrit)` helper in `scheduler.rs`.
- Raise the probe floor `MIN_INTERVAL_SECS` from 5s to **10s**; `update_settings` mirrors
  the floor with `.max(10)`. Users edit both values from Settings (two number inputs,
  `min=10`), never from the lists themselves.
- Backoff/jitter (ADR-0014) are untouched — only the `base` selection changes; the 120s
  `BACKOFF_CEILING` still caps a backed-off 60s base.

## Alternatives considered

- **Per-service override (the original TODO)** — rejected: finer granularity than anyone
  needs, and a per-row UI for it. Criticality already captures the intent (YAGNI).
- **Per-list interval field** — rejected: a larger schema and a per-list settings panel,
  when two buckets keyed on the existing `critical` flag cover the requirement.
- **A config schema-version/migration system** — rejected here: serde defaults make the
  field swap forward/back compatible. Versioned migration stays its own backlog item.

## Consequences

## **Positive:**

- Simpler model: two values, no per-row UI; new lists auto-inherit cadence by criticality.
- No migration code — `serde(default)` keeps old and new `config.json` mutually compatible.
- Critical outages surface in ~20s while non-critical lists probe a third as often.

## **Negative / accepted trade-offs:**

- A single criticality bucket cannot hold two cadences — every critical list shares one
  interval, every non-critical list another.
- Existing users' customised `probe_interval_secs` (if any) is dropped and replaced by the
  30/60 defaults on next load. Acceptable: interval is a tunable, not user content.

## **Follow-ups:**

- Revisit per-list cadence only if a real need for two critical lists at different rates
  appears.
