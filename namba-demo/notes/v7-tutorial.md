# v7 — Tutorial + gate E (items 2 + 3) · owner: js/game/*, js/ui/hud.js, css/game.css, js/world/transit.js, js/world/transit/*

Status: **fixed and proven at 3 gates** (phone up and down, blocked, wrong-way). Full `walk.mjs` with real E presses:
see "Walk" below.

## Root cause (proved)

**E at the gate: the phone was raised.** v6 switched every world interaction off while the phone is up
(`game.js update`: `canUse = … && !this.phoneOpen`), hid the HUD prompt, and the gate tutorial step was suppressed too
(`available: !ph().isOpen`, `hint → null` while open). The tutorial's last step (pick a place) **ends with Maps raised**,
and the phone only auto-lowers while walking if the cursor isn't moving over it (`phone._lastPointerT` < 2.5 s keeps it
up) — with the phone up the pointer is unlocked, so a human's cursor is right there. Walk to the gate behind the map →
no prompt, no hint, E does nothing, the flaps stop you. The bot always lowered the phone and called `onUse()` directly.

Evidence (human repro: real Playwright key presses, mouse-look by `mousemove` deltas, W held, systems stepped like
walk.mjs; `?test&play&quality=low` because a no-param load never finished its shader precompile under this machine's
load — `?play` keeps the real game path, the HUD and the story):

| Check | Result |
|---|---|
| Targeting sweep: every channel of every gate, both sides, 0.6/1.0/1.5/2.0 m, yaw 0/±0.5 rad | `pick()` = `gatetap` in **4512/4512** allowed poses → gateLaneNear / facing / registration were never the bug |
| Phone **down**, Nankai lane 9.1 | prompt + tip, E → `ic:pay 970`, `gate:tap`, tutorial `gate` done (`07-gate-prompt.png`) |
| Phone **up** (Maps, cursor over it), Nankai lane 14, facing the reader 2 m out — **before** | `keydown KeyE` reached window with `phoneOpen=true`; **no `interact`, no prompt (`.h-prompt` not `.on`), no hint** (`08-phoneup-gate-before-fix.png`) |

**"Most of the tutorial is missing":** `tutorialStore` (sessionStorage `namba.tutorial.v3`, the same key since v3)
marked the tutorial done, and **every later load in that tab** (refresh, Restart, a new deploy) hid every hint except as
a nudge after 12 s idle. Zack had already finished it in that tab (v5 or an earlier v6 run). Only the gate step (a
`late` step, always taught) still showed — "most" missing, exactly.

## Fix

| File | Change |
|---|---|
| `js/game/game.js` | Interactions stay live with the phone raised. With the phone up only the **E key** acts on the world (`keyOnly`; Enter, 1–9, Tab, Q stay the phone's), never while typing in the phone or while Lodestone's install offer is on screen (E installs there). `gatetap` has `keepPhone: true`. Restart text no longer promises hidden hints. |
| `js/game/interact.js` | `update(dt, allowUse, { keyOnly, lowerPhone })`: E uses the target; any target except a `keepPhone` one lowers the phone first (café counters, machines open their panels with the phone down). |
| `js/game/story.js` | Gate lesson shows with the phone up when you're at a channel (`aimed`) or the flaps stopped you (`blocked`); "walk up to a lane" (merely near) stays phone-down only, so the reply/pick hints aren't stolen. `gateAgain` also works with the phone up. |
| `js/game/tutorial.js` | `teach = true` on every run (`?notutorial` still turns hints off). Each hint vanishes the moment its step is done, so a returning player sees them flash by. |
| `css/game.css` | With the phone up, the HUD prompt steps left of the phone (`body:has(#phone-root.ph-is-open) .h-prompt`), like the tip already does. |
| `tools/walk.mjs` (lead asked) | The bot presses E as a real `keydown`/`keyup` on window (→ Input → `Interactions.update`) at gates and the café counter. No `onUse()` calls, no `&autotap`. The café press retries every 2.5 s. |

## Proof (after the fix; shots in `notes/v7-shots/tutorial/`)

| # | Gate | Phone | Approach | Result |
|---|---|---|---|---|
| 1 | Nankai central, lane 14 (paid → free) | **up**, cursor on it | walked from lane 9, faced the reader, 2 m out | prompt left of phone + tip (`09`), E → `gate:tap 14.0`, walk → `gate:pass {player}` (`10`) |
| 1b | Nankai central, lane 16 (free → paid) | **up** | walked straight in untapped | `gate:blocked notap`, stopped at z −66.28, tip "Tap your IC card first — E" (`11`); E → `gate:tap 16.1` → `gate:pass` |
| 2 | Midosuji north, lane 3 (exit-only) | down | from the free side | passive "Exit only — try the next gate ✕" (`12`) |
| 2b | Midosuji north, lane 4 | down | strafed 2 m left (real A key) | "Tap your ICOCA", E → `gate:tap 4.0 dir +1` → `gate:pass` (`13`) |
| 3 | Sennichimae, lane 4 (paid → free) | **up**, cursor on it | walked 6 m to 1.8 m out | E → `gate:tap 4.2 dir −1` → `gate:pass` (`14`) |

Tutorial, fresh session (shots `01`–`07`): look (`01`) → move (`02`) → raise (`03`) → reply (`04`) → pick (`05`, `06`)
→ `tutorial:done` 43.8 s → gate (`07`). All events in order, `ctx.errors []`, console: only the sandbox font cert error
and SwiftShader ReadPixels perf notes.

**Replay** (`scratchpad replay.mjs`: sessionStorage `namba.tutorial.v3 = done` set before load, like a refresh after
finishing): `teach: true`; look → move → raise → reply → pick all hinted and validated, `tutorial:done` 27.6 s
(shots `r01`–`r04`). Before the fix the same tab reloaded with `teach: false` and no hint at all.

## Walk (full `tools/walk.mjs`, default walk params `?quality=low&noaudio`, no `&autotap`, bot presses E as key events)

Tutorial: move, raise, reply, pick → `tutorial:done` 54.6 s. Gate: `bot:E gatetap g_nk_central 9.1` → `ic:pay fare 970`
→ `gate:tap` → tutorial `gate` done; one `gate:blocked notap` at 10.0 (bot side-stepped into the next channel) → E →
tap → through. Café: `bot:E order:city_1e12` → `ic:pay purchase 520` → iced latte. **ARRIVED t 499 s**, end card shown
(±18 m → ±0.5 m, 28 % wrong floor → 0). `ctx.errors []`, console: only the bot's 2 `dbg` warnings. `loadprobe`:
`READY 133.9s []` (sandbox font cert error only).

## For the lead

- **Stale-module risk on deploy (not my files):** `index.html`/`js/**` load with no version stamp and GitHub Pages
  serves `Cache-Control: max-age=600`. Right after a deploy a browser can run a **mix** of old and new modules (I
  reproduced the mechanism locally: a reload kept the old `tutorial.js` while the server had the new one). An old
  `game.js` against the new `gates.js` = no E at the gate. Worth a `?v=<sha>` stamp in `deploy.sh` (importmap / main.js
  URL), and telling Zack to hard-refresh after v7 goes live.
- The phone still stays up while you walk if the cursor moves over it (`phone._lastPointerT`); harmless now that E and
  the gate prompt work with it up, so I left phone.js alone.
