# zack-niv.github.io — Claude operating notes

Zack's personal site (GitHub Pages; `main` deploys automatically). Most top-level files are standalone pages; leave them alone
unless asked. The active project is **Namba**, a first-person Three.js recreation of Osaka's Namba station, malls and Namba
Parks.

## Working with Zack

Zack's preferences: be curious, positive but not delusional, break paradigms, stay ahead of the curve, be your own (honest)
critic, be helpful, and help him focus when he drifts.

- He plays the live build and sends numbered feedback with screenshots. Treat every item as a requirement: fix the root cause,
  not the symptom, and verify visually.
- He prefers short status updates: what is done, what is next, and an honest ETA. Never claim something works without
  evidence (screenshots or numbers).
- Ping him when a deploy is live, with a push notification if that tool is available.
- Keep a contact line, Oriient branding and similar choices for him to decide. Don't invent them.

## The two Namba projects

| | Path | State |
|---|---|---|
| **Lost in Namba** (focused demo) | `namba-demo/` → https://zack-niv.github.io/namba-demo/ | **Active.** Job-application demo for Oriient (indoor positioning). |
| **Namba** (full game) | `namba/` | **Paused.** Never edit it while working on the demo. |

**Demo**
- Read in order: `namba-demo/DEMO.md` (audience, story, brand rule, budgets) → `namba-demo/DEVNOTES.md` (architecture,
  contracts, testing) → the latest `namba-demo/V{n}.md` round spec.
- Per-area notes live in `namba-demo/notes/v{n}-<area>.md`; the newest round's `v{n}-critique.md` holds open items and risks.

**Full game**
- Read `namba/DEVNOTES.md`, `namba/notes/PROTOCOL.md` and `namba/notes/critique/*` (scores and briefs from before the pause).
- To resume, port the demo's proven fixes back first: shells, crowd flow, humans, the phone, audio.

## Operating system (how we build)

1. **Feedback round.** Zack's feedback becomes a `namba-demo/V{n}.md` spec: items table → owner, disjoint file ownership,
   contracts between agents, quality bar. Commit it before starting the agents. Use the `/namba-round` skill.
2. **Fan out** about 4–5 background agents with disjoint files:
   - design, architecture and hard debugging go to **Opus** (`namba-designer`);
   - well-scoped code goes to **Sonnet** (`namba-implementer`);
   - agents never run git; the lead commits.
   - Agents coordinate through `notes/v{n}-<agent>.md`. Send contract changes to the other agents yourself.
3. **Check-ins.**
   - Schedule a check every 30–45 min (send_later or ScheduleWakeup): notes mtimes, recent edits, browser processes over
     ~45 min with no new output (hung).
   - Commit and push a WIP checkpoint each time; the cloud container is ephemeral.
   - Nudge agents to wrap up near their budget (60–90 min).
4. **Critic + fixer** (`namba-critic`, Opus) once all agents are done:
   - a full playthrough with `tools/walk.mjs`;
   - grade every item with a screenshot and fix what it finds;
   - write `notes/v{n}-critique.md` with a 1–10 score and the top 3 risks.
5. **Deploy**:
   - run `bash namba-demo/tools/deploy.sh "Deploy Lost in Namba vX: …"` (pre-approved for `/namba-demo/` only);
   - verify the live files' sha1 against local, then ping Zack with a short table of what changed and what is still rough.
6. **Hotfix** anything the critic couldn't fix as a focused single-agent pass, then redeploy (vX.1).

### Development branch and commits

- Dev work goes on the session's designated `claude/*` branch.
- `main` changes only through `tools/deploy.sh`.
- Don't open PRs unless asked.

### Testing (headless; SwiftShader is slow, a first frame takes 10–200 s)

- One-time setup per fresh container: `cd namba-demo/tools && npm install`. Chromium is preinstalled at `/opt/pw-browsers`.
- Run from `namba-demo/`:

| Tool | What it does |
|---|---|
| `node tools/loadprobe.mjs` | Load time + errors; must print `READY … []` |
| `node tools/shot.mjs --views start,canyon` or `--pose "2F,x,z,yaw,pitch"` | Screenshots + draw calls |
| `node tools/walk.mjs` | Full playthrough bot (`&nocoffee` variant) |
| `node tools/accshot.mjs <prefix>` | NPC accessory close-ups |
| `node tools/leakprobe.mjs` | Ray probe for see-through / back-face leaks |
| `node tools/headtest.mjs` | NPC head-turn sanity |
| `node js/npc/flowprobe.mjs --max 1500` | Escalator congestion (Node only) |

- Browser slots are rate-limited by `tools/slot.mjs` (4 slots). Keep at most 2 browsers per agent, no persistent daemons, and
  never `pkill` broad patterns: it kills other agents' runs and your own shell.
- `window.__namba` is the live context (`teleport`, `phone`, `crowd`, `audio.debug()`, `events`).
- The budget: zero console errors (ignore the sandbox's Google Fonts `ERR_CERT_AUTHORITY_INVALID`) and an empty `ctx.errors`.

### Known lessons

- When something "isn't drawn", check data and precision before blaming shaders. A float32 `int(x + 0.5)` hid every NPC
  accessory.
- Geometry built only as inward-facing skins leaks when new viewpoints open up. `arch/shells.js` closes it; probe with
  `leakprobe.mjs`.
- Crowd jams come from spawning and relocation logic as much as from queues. Measure with flowprobe at the real population
  (1500).
- Real-GPU frame rate and crowd density have never been measured; only Zack can, on a laptop.
