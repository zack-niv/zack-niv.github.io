---
name: round
description: Run one feedback or build round end to end - turn Zack's feedback (numbered items, screenshots) or a goal into a round spec, fan out agents, check in, run the critic, ship, ping and hotfix. Use when Zack sends feedback, asks for a set of changes, or a round of work starts.
---
# One round

Read `.claude/studio/LEAD.md` (sections 4–7) and the project adapter in `CLAUDE.md` first. Paths below are the adapter's
defaults; use the project's own if it names them.

1. **Triage.**
   - Read the latest round spec and critique, and the project's "Status at handoff".
   - Save Zack's screenshots to `docs/rounds/shots/R{n}/player/`, named by issue.
   - Look at each screenshot yourself and list what you see that he didn't mention.
   - If scope is unclear, state the lean interpretation and an honest ETA. Don't over-build.
2. **Spec.** Write `docs/rounds/R{n}.md` from `.claude/studio/templates/ROUND.md`: items table → owner, a hypothesis per bug
   with verify-first wording, disjoint file ownership, contracts between agents, a quality bar per item. Commit and push it
   before launching anything.
3. **Fan out** in one message: `builder` (Sonnet) for well-specified build, `designer` (Opus) for diagnosis and design,
   `strategist` (Opus) for research and options. Each prompt covers: files owned, Zack's words verbatim, screenshot paths,
   the evidence tools, a 60–90 min budget, and its notes file `docs/rounds/notes/R{n}-<agent>.md`. Then tell Zack the plan
   in a short table with an honest ETA.
4. **Check in** every 30–45 min (send_later / ScheduleWakeup): notes mtimes, recent edits, hung test processes; commit and
   push a WIP checkpoint; relay contracts; open new screenshots and send corrections; nudge agents near budget.
5. **Critic.** When every agent is done, launch `critic` with the known risks listed explicitly.
6. **Ship** with the `ship` skill. Check the critic's screenshots yourself first: newly visible things can look crude.
7. **Hotfix** anything the critic couldn't fix with one focused agent, then ship again (R{n}.1).
8. **Retro** with the `retro` skill.
