---
status: draft # draft -> approved -> done
date: YYYY-MM-DD
adr: none # none | required | NNNN (set to the committed ADR number once written)
skills: [] # skills /plan-execute should preload, e.g. [coding-standards, ui-testing]
---

<!--
Formatting rules — the first audience is a HUMAN skimming this for review:
- Prefer tables and short bullets over prose. No paragraph longer than 3 sentences.
- Each fact lives in exactly one section; reference it ("see §2") instead of repeating it.
- Task titles are short imperatives; details go in indented sub-bullets. Never pack
  files + change + why into one long bullet line.
- Include a mermaid diagram (```mermaid fence — renders in VSCode Mermaid Preview and
  GitHub) only when the plan changes architecture or module boundaries.
- Include before/after payload examples (fenced json) only when the plan changes an
  API/data contract — that is what the human reviewer checks hardest.
- Omit any heading or sub-heading that would be empty. Never write "none" placeholders
  (exceptions: §7 and §8 require an explicit "None"/"No ADR needed" + why).
-->

# <Plan title>

## 1. Goal & scope

<Goal in 2–4 sentences: what changes and why.>

<Mermaid diagram of the target state — only if architecture/module boundaries change.>

**In scope:**
- <tight bullets>

**Out of scope:**
- <item — one-line reason it is excluded>

## 2. Codebase findings

<Only facts that shape the plan. The executor re-reads the code at run time — do not
transcribe it. One row per fact; group with bold sub-headings only when the table grows
past ~10 rows.>

| Where | Fact that matters |
|---|---|
| `path/File.cs:12` | <one line> |

<Before/after payload examples go here when an API/data contract changes.>

## 3. Assumptions & open questions

<Include only the non-empty groups below; omit the rest entirely.>

**Safe assumptions:**

**Blocking (resolve before approving):**

**Residual risks / unknowns for reviewer:**

**Bookkeeping** (one line each, only if any): terms resolved → `CONTEXT.md`; glossary
conflicts surfaced; prior ADRs that constrained this plan.

## 4. Implementation tasks

<The execution checklist. /plan-execute walks these top-to-bottom and flips - [ ] -> - [x]
as each lands. One task = one coherent, verifiable unit, ordered so each builds on the
last. Group into phases when cross-group ordering matters. Sub-bullets carry the detail:
Files, Change (1–2 lines), plus a constraint/ordering note only when load-bearing. Add a
"Why" sub-bullet only when the reason is not obvious from the title.>

### Phase A — <name>

- [ ] **A1. <short imperative title>**
  - Files: `path/one.cs`, `path/two.cs` (new)
  - Change: <1–2 lines>
  - <constraint or ordering note, only if load-bearing>

## 5. Definition of done

- [ ] <criterion> — verify: `<test / command / manual check>`

## 6. Risk & rollback

| Risk | Severity | Mitigation |
|---|---|---|
| <failure mode> | high/med/low | <how the plan addresses it> |

- **Rollback:** <how to undo>
- **Irreversible:** <migrations, data changes, contract/API changes — omit if none>

## 7. Skills Needed

<Skills /plan-execute should load for §4, by exact name (mirrored in `skills:`
frontmatter). Only skills that exist in this project. If none apply, write "None" + why.>

- `<skill-name>` — for: <task ref> — why: <reason>

## 8. ADR (compressed — /plan-execute expands)

<If an ADR trigger applies (see /plan-draft phase 9): set frontmatter `adr: required` and
draft tight bullets only, ≤20 lines total — /plan-execute expands them into full prose at
docs/adr/NNNN-<slug>.md and writes the number back. Otherwise: "No ADR needed" + one line
of why.>

- **Title:** <the decision in one line>
- **Context:** <2–3 bullets>
- **Decision:** <2–4 bullets>
- **Alternatives:** <one bullet each: alternative — why rejected>
- **Consequences:** <"+" and "−" bullets>

## Execution log

<Filled in by /plan-execute: files changed, task/verify results, divergences and how they were resolved.>
