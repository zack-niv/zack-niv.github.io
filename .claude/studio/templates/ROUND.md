# <Project> — R{n} (<one-line theme>)

<What's live and how the last round scored. What to read first (CLAUDE.md, last round spec and critique). What must keep
working: list the invariants and journeys this round must not break.>

Zack's screenshots: `docs/rounds/shots/R{n}/player/` (one line each: file → what it shows).

## Items → owner

| # | Zack (verbatim) | Owner |
|---|---|---|
| 1 | "<his words>" | **<Agent name>** (<model>) |
| + | Lead: <what you spotted that he didn't mention> | **<Agent>** |

## Diagnosis and hypotheses (verify first)

- **1.** <What the evidence shows. The suspected root cause, phrased as something to verify, with the file and line if
  known. What a fix must achieve, not just what to change. Alternatives to weigh.>

## Ownership (disjoint)

| Agent | Owns |
|---|---|
| **<Name>** (<model>: items) | <files and folders> |
| **Lead** | specs, notes, analytics/config the lead owns, git |

No git for agents. Notes go to `docs/rounds/notes/R{n}-<agent>.md`; the lead relays cross-agent requests.

## Contracts

- **<A> → <B>:** <API, class name, event or data shape, and who sets it when>.

## Quality bar

- **1:** <what proves it: screenshots at which sizes, numbers before → after, a run of which tool, what only the real
  world can prove>.
- **All:** zero console/app errors; the project's checks pass; no regression in <the core journey>.
