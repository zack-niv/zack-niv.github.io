---
name: namba-round
description: Run one Namba feedback round end to end. Turns Zack's play-test feedback into a V{n} spec, fans out agents, runs check-ins, then critic, deploy and ping. Use when Zack sends numbered feedback or screenshots for the Namba demo or game.
---
# Namba feedback round

1. **Triage.**
   - Read `CLAUDE.md` and the latest `namba-demo/V{n}.md` and `notes/v{n}-critique.md`.
   - Save Zack's screenshots to `namba-demo/notes/v{n+1}-shots/player/`, named by issue.
   - If his scope is unclear, state the lean interpretation and the ETA. Don't over-build; he will tell you if you
     overestimated.
2. **Spec.** Write `namba-demo/V{n+1}.md` (structure as in `V4.md`):
   - an items table → owner;
   - a hypothesis for each bug, with verify-first wording;
   - disjoint file ownership;
   - contracts (APIs and events) between agents;
   - a quality bar per item.

   Commit and push it before launching anything.
3. **Fan out**, in one message: background agents `namba-designer` (Opus) for design, architecture and debugging, and
   `namba-implementer` (Sonnet) for scoped code.
   - Each prompt covers: files owned, the player's words verbatim, the screenshot paths to look at, the testing tools,
     a budget of 60–90 min, and the notes file to write.
   - Then tell Zack the plan in a short table, with an honest ETA (headless testing dominates the time).
4. **Check in** every 30–45 min (send_later / ScheduleWakeup):
   - look at notes mtimes, recent file edits, and browsers older than 45 min with no new output;
   - commit and push a WIP checkpoint;
   - forward cross-agent requests yourself;
   - nudge agents near their budget.
5. **Critic.** When all agents are done, launch `namba-critic` with the known open items listed explicitly.
6. **Ship.**
   - Run `bash namba-demo/tools/deploy.sh "Deploy Lost in Namba v{n+1}: …"`.
   - Verify that the live files' sha1 match local.
   - Push-notify Zack and reply with a table (item → what changed), what is still rough, and what to look for when playing.
7. **Hotfix.** Anything the critic could not fix gets one focused agent, then redeploy as v{n+1}.1. Check its screenshots
   yourself before deploying: newly visible things can look crude.
