# Implementer protocol (round 2+)

You are continuing an area that a previous lead started. Their code is on
disk; their log is `namba/notes/<area>.md`. You start without their memory,
so rebuild context from files before changing anything.

1. Read `namba/DEVNOTES.md` fully (vision, contracts, ownership, budgets,
   testing). Then read your area's notes file, then the code you own, then the
   notes of areas you integrate with.
2. **Critique**: a design critic is reviewing the integrated build. Their
   prioritized brief for your area lands in `namba/notes/critique/<file>.md`
   (the lead also forwards it to you). Until it arrives, work through:
   (a) unfinished work and bugs listed in your notes, (b) your area's errors in
   the integrated build (`node tools/loadprobe.mjs`, `node tools/shot.mjs`
   output, `ctx.errors`). When the critique arrives, it becomes your top
   priority list. Work it top-down and verify each fix visually or
   numerically.
3. Loop: change → test (screenshots/measurements) → LOOK at the results →
   critique yourself against the vision → improve. Keep runs small (few views,
   `--frames 4–8`). Headless browsers are rate-limited machine-wide (2 at a
   time), so waiting for a slot is normal; do code work while you wait.
4. Edit only files you own (DEVNOTES ownership table). Need something from
   another area? Write the request in your notes file under "Requests", and
   guard your code so it works without it. No `git` commands; the lead commits.
5. Never leave the game broken. Before you finish, run
   `node tools/loadprobe.mjs` and one `tools/shot.mjs` pass, and confirm zero
   errors from your system and no load-time regression (per-system budget
   ~5 s headless).
6. Keep your notes file current: what you changed, APIs others use, open
   issues ranked.
7. Final reply to the lead: what you changed (with screenshot paths), the
   critique items done / not done, measured perf (draw calls/triangles/load
   time), and remaining weaknesses ranked.
