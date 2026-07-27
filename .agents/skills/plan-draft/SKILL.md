---
name: plan-draft
description: Build a reviewed, execution-ready plan (no code) for a change, using Opus. Manually invoked with /plan-draft; writes one self-contained artifact under .Codex/plans/ and delegates a cold review to the plan-critic agent (or the plan-review skill).
when_to_use: Invoke directly with /plan-draft <goal> before starting any non-trivial change. Pairs with /plan-execute.
category: Workflow
tags: [workflow, artifacts]
argument-hint: [what you want to build or change]
allowed-tools: Read, Grep, Glob, Write, Task, Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(ls:*), Bash(find:*)
disable-model-invocation: true
model: Codex-opus-4-8
effort: high
---

You are producing an implementation **plan only**. You must not modify, create, or
delete any source file. The only file you may write is the plan itself under
`.Codex/plans/`. You deliberately have no Edit tool — if you feel the urge to change
code, that is a signal to write it into the plan instead.

This is the **planning half** of a compact two-step workflow (`/plan-draft` then
`/plan-execute`). The plan you write is the single source of truth — one self-contained
artifact, no separate spec files. Its task list is what `/plan-execute` walks; its ADR
section is how non-trivial decisions get documented. Make both execution-ready.

The plan has two readers, in priority order: a **human** who must approve it by skimming
(tables, diagrams, short bullets), and the **executor model** that follows it (concrete
paths, ordered tasks). When detail would serve only the executor, keep it to one tight
sub-bullet; when it would serve neither — code transcription, restated context — leave
it out. The executor has the codebase; the plan only needs to carry the decisions.

The plan template lives next to this skill at `${CLAUDE_SKILL_DIR}/PLAN.md` — read it
before you start writing the plan so the artifact matches the section order exactly. The
glossary format lives at `${CLAUDE_SKILL_DIR}/CONTEXT-FORMAT.md` — read it before phase 3.

This workflow keeps **two durable docs** alongside the ephemeral plan: `CONTEXT.md` (the
project's ubiquitous-language glossary, maintained inline during the grill phase) and
`.Codex/docs/adr/` (non-trivial decisions). The plan itself is throwaway (draft → done → archive);
the glossary and ADRs outlive it.

## Repository context (injected)

Recent history — orientation only (conventions, in-flight direction). This is NOT the plan's
scope; ignore it if unrelated to the goal.

- Recent commits: !`git log --oneline -5`
- Today's date: !`date +%F`

Goal from the requester: $ARGUMENTS

Work through these phases in order. Do not skip ahead, and do not start writing the
plan file until phase 10.

**1. Understand the request.**
Restate the goal in your own words. Define scope explicitly: what is in scope and
what is out of scope. If the request is ambiguous in a way that would change the
implementation, STOP and ask before continuing — do not guess past a fork that
matters.

**2. Investigate the real codebase + domain.**
Use Glob / Grep / Read to find the files, modules, and patterns this change touches.
Reference concrete paths, not assumptions. Identify the existing conventions you must
follow (naming, structure, error handling, test style). If you expected something and
can't find it, say so rather than inventing it.
Record findings as **table rows** (`path:line` → the one fact that matters), not prose.
Keep only facts that shape a decision or task — the executor re-reads the code at run
time, so never transcribe implementations into the plan.
Also read the domain docs: `CONTEXT.md` (or `CONTEXT-MAP.md` at root → the per-context
`CONTEXT.md` it points to) if present, and skim `.Codex/docs/adr/` for decisions that constrain
this change. These tell you the project's canonical terms and prior trade-offs — honour
them in the plan.

**3. Grill (interview to a shared understanding).**
Interview the requester to resolve the design tree, one question at a time, waiting for the
answer before the next. Walk down each branch, resolving dependencies between decisions in
order. For every question, **state your recommended answer** — do not just ask open-endedly.
Keep it lightweight and bounded:

- **Only grill forks that change the implementation.** If the request is already clear, say
  so and move on — do not manufacture questions.
- **If the codebase can answer it, answer it from the codebase** instead of asking.
- **Sharpen fuzzy language.** When a term is vague or overloaded, propose a precise canonical
  term ("you said 'account' — Customer or User? those differ"). When a term conflicts with
  `CONTEXT.md`, call it out immediately.
- **Stress-test with concrete scenarios.** Invent edge-case scenarios that force precision
  about boundaries between concepts.
- **Cross-reference code.** If a stated behaviour contradicts the code, surface it.

**Update `CONTEXT.md` inline** as each term resolves — do not batch. Create it lazily (only
once the first term is worth recording) using `${CLAUDE_SKILL_DIR}/CONTEXT-FORMAT.md`. Keep it
a glossary and nothing else: canonical terms + `_Avoid_` synonyms, zero implementation detail.
Only record terms specific to this project's domain, not general programming concepts. This is
the only source file you may touch besides the plan.

**4. State assumptions and open questions.**
After grilling, list what remains. Split assumptions into "safe" (low risk if wrong) and
"blocking" (the plan is invalid if wrong). Any blocking question not settled in phase 3 goes
to the requester now.

**5. Write the implementation tasks (the apply-loop checklist).**
Produce an ordered checklist of `- [ ]` tasks — this is exactly what `/plan-execute` walks
and flips to `- [x]`. One task = one coherent, verifiable unit: small enough to land and
check on its own, ordered so each builds on the last (openspec apply-loop discipline).
Format each task as a **short imperative title** with the detail in indented sub-bullets:
Files, Change (1–2 lines), and a constraint/ordering note only when load-bearing. Add a
"Why" sub-bullet only when the reason is not obvious from the title — never cram
files + change + why into one long bullet line. Group tasks into phases when ordering
across groups matters. Be specific enough that the executor can follow without
re-deriving your reasoning, but lean on §2's findings by reference instead of repeating
them.

**6. Define done.**
Write acceptance criteria as a checklist. For each item, specify exactly how it will be
verified. If the project has a test suite, name the test(s); if no tests cover the touched
area, say which tests should be added. If the project has no test setup at all, do not
invent one — specify the verification that does apply (build, type-check, lint, smoke run,
or a manual/visual check) and note tests as a future add-on.

**7. Assess risk.**
What can break? What is the blast radius (other modules, services, consumers)? What is
the rollback path? Flag anything irreversible (migrations, data changes, public API or
contract changes).

**8. Determine the skills needed (section 7).**
Decide which project skills `/plan-execute` should load to carry out section 4. Use only
skills that actually exist here — check `.Codex/skills/` and the available-skills list;
do not invent names. Look for project skills matching the areas the tasks touch: UI /
visual-verification skills for visible UI work, coding-standards or framework
best-practice skills for code-quality-sensitive work, build/run workflow skills for
anything that must be launched to verify.
List each skill with which task(s) it serves and why. Record them in the plan's `skills:`
frontmatter as a YAML list so `/plan-execute` can preload them on demand. If none apply, write "None".

**9. ADR check (the documentation output, section 8).**
This repo documents non-trivial decisions with an ADR under `.Codex/docs/adr/` — there are no
spec files, so the ADR *is* the durable record of what changed and why. An ADR is REQUIRED
if the change does any of:

- adds or removes a dependency / library;
- adds, removes, or changes a module or service boundary;
- changes a data model, schema, or API/event contract;
- deviates from an established pattern already in the codebase;
- makes a security, auth, or data-privacy decision;
- chooses one approach over a viable alternative for non-obvious reasons.

If any apply, set frontmatter `adr: required` and draft the ADR in section 8 as
**compressed bullets only** (Title / Context / Decision / Alternatives / Consequences,
≤20 lines total — see the §8 stub in `${CLAUDE_SKILL_DIR}/PLAN.md`). Do NOT write full
ADR prose in the plan; `/plan-execute` expands the bullets into the full
`${CLAUDE_SKILL_DIR}/ADR.md` structure when it commits `.Codex/docs/adr/NNNN-<slug>.md`. If none
apply, set `adr: none`, write "No ADR needed" and one line of why.

**10. Save the draft.**
Write the plan to `.Codex/plans/YYYY-MM-DD-<short-slug>.md` (use the injected "Today's date"
for `YYYY-MM-DD`, never a guessed date) following the structure in
`${CLAUDE_SKILL_DIR}/PLAN.md` exactly (sections 1–8 + Execution log). Set frontmatter
`status: draft`, `date` (today's date), the `adr` field, and the `skills` list from phase 8.
(It must exist as a
file so the reviewer can read it cold.) Create `.Codex/plans/` with the Write tool path if
it does not exist. Do not write any other file. Do not start implementing.

The first audience is the **human reviewer** — write for a skim, not a read. Follow the
formatting rules in the template's header comment, in particular:

- Tables and short bullets over prose; no paragraph longer than 3 sentences.
- Each fact lives in one section; cross-reference ("see §2") instead of repeating.
- Add a mermaid diagram (renders in VSCode Mermaid Preview / GitHub) only when the plan
  changes architecture or module boundaries; add before/after payload examples (fenced
  json) only when it changes an API/data contract. Skip both otherwise.
- Omit empty headings — no "none" placeholders (except §7/§8 which require an explicit
  "None"/"No ADR needed" + why).
- A reviewer should grasp goal, approach, and risk in ~5 minutes. If the plan runs long,
  trim §2 transcription and task sub-bullets first — never the task list itself or the
  definition of done.

**11. Delegate the review.**
The review must be cold — a fresh context that did not write the plan. Resolve the
reviewer in this order:

1. If the `plan-critic` subagent exists in this environment, invoke it with the Task tool,
   passing the path to the plan file you just wrote. (It is a thin wrapper around the
   `plan-review` skill.)
2. Otherwise, spawn a general-purpose subagent with the Task tool. Its prompt: read
   `${CLAUDE_SKILL_DIR}/../plan-review/SKILL.md` and follow those instructions exactly,
   reviewing the plan file at the path you just wrote.
3. If subagents are unavailable, or the `plan-review` skill cannot be found, stop here:
   print the plan path and tell the requester to run `/plan-review <path>` (ideally in a
   fresh session), then bring back the verdict so phase 12 can run.

The reviewer reads the plan cold, verifies the claims against the codebase, checks the
task list is atomic/ordered/verifiable and the skills list is real, and returns a
structured verdict (APPROVE / REVISE) with prioritised findings. Do not review your own
plan inline — the point is a cold, separate reviewer. Run the review exactly once; do not
re-delegate. Proceed to phase 12 with the verdict and findings.

**12. Apply the findings.**
Address every CRITICAL and SHOULD-FIX item by rewriting the plan file with Write. Resolve
each UNVERIFIED CLAIM (check it, or move it to section 3 "Assumptions & open questions" if it
can't be settled here). If a finding reveals a blocking question for the requester, surface
it. Keep `status: draft` — approval is the human's call, never yours. Then print the file
path, the reviewer's verdict, and a summary of what changed after review. Tell the
requester to set `status: approved` when satisfied, then run `/plan-execute`.
