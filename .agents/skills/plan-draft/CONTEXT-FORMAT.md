# CONTEXT.md Format

`CONTEXT.md` is the project's **ubiquitous-language glossary** — the canonical name for
each domain concept, and the words to avoid. It is durable (outlives any single plan) and
is **a glossary and nothing else**: no specs, no scratch notes, no implementation decisions
(those go in `.claude/docs/adr/`).

## Structure

```md
# {Context Name}

{One or two sentences: what this context is and why it exists.}

## Language

**Report**:
A generated financial-analysis document produced from a company's filings.
_Avoid_: Document, analysis, output

**Customer**:
The corporate entity whose financials are being analysed.
_Avoid_: Client, account, company
```

## Rules

- **Be opinionated.** When several words exist for one concept, pick the best and list the
  rest under `_Avoid_`.
- **Keep definitions tight.** One or two sentences. Define what it IS, not what it does.
- **Domain terms only.** A concept unique to this project's domain belongs; a general
  programming concept (timeout, retry, DTO) does not, even if used heavily.
- **Group under subheadings** only when natural clusters emerge; a flat list is fine.

## Single vs multi-context

- Most repos: one `CONTEXT.md` at the repo root.
- Multiple bounded contexts: a `CONTEXT-MAP.md` at root lists each context, where its
  `CONTEXT.md` lives, and how they relate. Read the map first; infer which context the
  current topic belongs to, and ask if unclear.

## Lazy creation

Do not create `CONTEXT.md` up front. Create it the first time a term is actually worth
recording during the grill phase, and append terms inline as they resolve.
