<!-- Paste into the project's CLAUDE.md (the kickoff skill fills it in). Keep the project's own sections; this adds the
     adapter the studio loop reads. -->

## Studio adapter

How we work is in `.claude/studio/LEAD.md` (installed from zack-niv/studio; don't edit the copy, change studio and
reinstall). This section tells the loop how this project is wired.

@.claude/studio/LEAD.md

- **Audience:** <who this must impress>. Critic question: "<would this … ?>" (1–10).
- **Goal (now):** <the goal for the next 4–6 weeks, set by Zack, with the date it was set>.
- **Where the truth lives:** status <tracker>; roadmap <where>; decisions <docs>; invariants <section/file>.
- **Rounds:** specs `docs/rounds/R{n}.md`, notes `docs/rounds/notes/`, shots `docs/rounds/shots/R{n}/`.
- **Evidence tools:**

  | Tool | Proves |
  |---|---|
  | `<command>` | <what it proves> |

- **Ship:** <deploy command or merge path>; verify live by <hashes / smoke run / event>; pre-approved: <what>; needs Zack:
  <what>.
- **Branches and PRs:** <the project's rules>.

## Status at handoff (update at the end of each session)

- **Live:** <version / commit>, critic <score> (<critique file>). Confirmed in the real world: <what, by what evidence>.
  Unproven: <what>. Next: <one line>.

## Known lessons

- <root cause as a rule a future session can follow> (<origin>).
