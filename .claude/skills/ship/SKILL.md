---
name: ship
description: Ship a verified round - run the project's deploy or merge path, verify the live result with evidence, update status, and ping Zack with what changed and what is still rough. Use after the critic passes, or when Zack asks to deploy.
---
# Ship

1. **Pre-flight.** Working tree committed and pushed; the project's checks green (the adapter lists them); the critic's
   screenshots reviewed by you; no open "unsure" item that would embarrass the audience.
2. **Deploy** exactly the way the project adapter says (a deploy script, a merge to the deploy branch, a release
   workflow). Never improvise a production path; if the adapter says a step needs Zack, ask.
3. **Verify live with evidence:** file hashes against the deployed commit, a smoke run of the evidence bot against the
   live URL, or a live analytics/log event. Retry while the CDN catches up; report the attempt count.
4. **Update** the project's "Status at handoff" in `CLAUDE.md` (what's live, the critic score, what's unproven, what's
   next), commit and push.
5. **Ping** Zack (push notification when available, under 200 characters, lead with what he should do), then reply with:
   - a table: item → what changed, with before → after numbers;
   - what is still rough, honestly;
   - what to look for when he uses it, and what only the real world can prove.
