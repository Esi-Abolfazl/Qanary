---
name: plan-execute
description: Execute an approved plan from .Codex/plans, openspec apply-loop style, with verification. Uses Sonnet.
when_to_use: Invoke directly with /plan-execute after a plan from /plan-draft has been set to status approved.
argument-hint: [path to plan, or empty for the latest approved one]
tags: [workflow, artifacts]
category: Workflow
model: sonnet
disable-model-invocation: true
allowed-tools: "*"
---

You are executing an approved implementation plan — the **execution half** of the compact
two-step workflow. The plan is the single source of truth: its section 4 task checklist is
your work queue, and you walk it the way openspec's apply loop walks tasks — one at a time,
flipping `- [ ]` to `- [x]` the moment each lands.

Plan target: $ARGUMENTS
(If empty, use the most recently modified file in `.Codex/plans/` whose frontmatter
`status` is `approved`. If none is approved, list the available drafts and stop.)

**1. Load and gate.**
Read the plan. Check frontmatter `status`:

- If `done` → already executed. Report it and stop (offer to archive if not archived).
- If NOT `approved` → **blocked**. Do not implement. Show the plan summary + its task list
  and ask the human to review and set `status: approved` first. The approval gate is the
  entire point of this workflow — never bypass it on your own initiative, even if the plan
  looks obviously fine.

**2. Load the skills the plan named + the glossary.**
Read section 7 ("Skills Needed") and the `skills:` frontmatter list. As you reach each task
in section 4, load its required skills (or load only once if a skill covers multiple tasks).
Lazy loading keeps context lean. If a listed skill does not exist, note it and continue.
Also read `CONTEXT.md` (or `CONTEXT-MAP.md` → the relevant per-context glossary) if present,
and use its canonical terms in code, identifiers, and comments. If implementation forces a
new domain term or changes an existing one, update `CONTEXT.md` inline (glossary only, no
implementation detail) — same as the plan phase did.

**3. Restate.**
Briefly confirm what you are about to do, the task count (N tasks), and the acceptance
criteria you will be held to.

**4. Walk the task checklist (apply loop).**
Work section 4's tasks top-to-bottom. For each task:

- Announce it: `Working on task K/N: <task>`.
- Make the code changes that task describes — minimal and scoped, no opportunistic refactors.
- Run the relevant build / lint / test for the area you touched.
- The instant it lands, flip its checkbox in the plan file `- [ ]` → `- [x]`.
- Print `✓ Task complete` and move on.

Keep going until every task is `- [x]` or you hit a blocker. After each task show running
progress `K/N tasks complete`.

**5. Handle divergence (pause, don't improvise).**
If reality contradicts the plan — a file isn't where it said, an assumption was wrong, a
task won't work — STOP. Do not invent a different design. Record it in the plan's
"Execution log", then pause with a clear options block:

```
## Execution Paused

**Plan:** <slug>
**Progress:** K/N tasks complete

### Issue
<what contradicts the plan>

**Options:**
1. <option>
2. <option>
3. Other approach

How do you want to proceed?
```

Trivial mechanical fixes (a renamed import) are fine to do inline; anything that changes
the design is not.

**6. ADR (the documentation output).**
If frontmatter `adr: required`, create `docs/adr/NNNN-<slug>.md` using the next free
number, with the structure from `docs/adr/_TEMPLATE.md`. If `docs/adr/_TEMPLATE.md` does
not exist yet, create it first by copying the ADR template from the plan-draft skill
(`${CLAUDE_SKILL_DIR}/../plan-draft/ADR.md`); if that skill is not installed, derive the
structure from the plan's section 8 body. The plan's section 8 is **compressed bullets**
(Title / Context / Decision / Alternatives / Consequences) — expand them into full prose
for the ADR file, staying faithful to the bullets and adding nothing the plan does not
support. Set its `Status:` to `accepted`. Write the chosen
number back into the plan's frontmatter (`adr: NNNN`). This ADR is how the change is
documented — there are no spec files. (Human commits the ADR separately if desired.)

**7. Verify against "done".**
Run every acceptance check in section 5 and report pass/fail for each. Discover the
project's verification commands from its manifest/config (e.g. `package.json` scripts,
`Makefile`, `pyproject.toml`, `cargo`, `go test`, `dotnet test`) rather than assuming a
stack. **If an automated test suite exists, run it** for the touched area, plus any
type-check and lint the project defines. **If no test suite exists**, fall back to other
verification — type-check, lint, build, a runnable smoke check, or the manual/visual checks
named in section 5 — and say which you used and why. For criteria not automatable (visual
UI, behavior), report as manual check needed. If something fails, fix it; if the fix is
genuinely out of scope, log it and flag it loudly rather than marking the plan done.

**8. Close out.**
Append an "Execution log" to the plan: files changed, per-task and verify results, any
divergences and how they were resolved, ADR number if written. Set frontmatter
`status: done`. Then write a PR-ready summary: what changed, why, how it was verified, and
any follow-ups.

Do not push or open a PR unless explicitly asked.
