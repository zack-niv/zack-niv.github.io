---
name: kickoff
description: Bring a new or existing project into the studio way of working - map the repo and where the truth lives, build the evidence harness, write the project adapter, run a baseline critic pass and propose round 1. Use when starting work on a project for the first time, or when Zack says "kick off" a project.
---
# Kickoff

1. **Map.** Read `CLAUDE.md`, the README, docs, CI, scripts and the live product. For a large repo, send a survey agent with
   a fixed report structure (product, truth sources, state per area with evidence, existing agent setup, testing tools,
   invariants, gaps, recent activity).
2. **Truth.** Find where status, roadmap, decisions and invariants live. If a connector is needed (Linear, Notion,
   analytics), say so to Zack in one line. Don't trust committed status snapshots over the tracker.
3. **Evidence harness.** List what can prove things today (tests, bots, previews, analytics, logs, error tracking). Name
   the gaps that would make a round blind: no end-to-end journey bot, no error tracking, no funnel events for the thing
   we'll change. Closing those gaps is usually round 1.
4. **Install** the studio files if they're missing (`install.sh` from the studio repo), and write the project adapter in
   `CLAUDE.md` from `.claude/studio/templates/PROJECT.md`. Keep the project's own conventions; never override its
   invariants.
5. **Baseline.** Launch `critic` on the current state (no round yet): a 1–10 grade per area with evidence and "why that
   grade". This becomes the bar every round moves.
6. **Propose round 1** in a short table (area → goal → evidence of done → owner → ETA) and ask Zack the one question that
   decides the order (usually: what is the goal for the next 4–6 weeks?).
