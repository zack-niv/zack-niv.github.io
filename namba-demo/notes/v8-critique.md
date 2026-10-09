# v8 critique (critic + fixer)

Overall: **7.5 / 10** for the round. All seven items moved, nothing regressed in the full playthroughs, and the upgrade
moment is better than v7: a clear calibration, then the 3D hero, then a map you can actually walk by. It is not higher
for three reasons: the JA voice and the crowd at the doors are still unverified by eye or ear, the hero stack's labels
clump, and every headless check here runs at about 20 fps on SwiftShader.

Shots: `notes/v8-shots/critic/` (mine) and `/home/user/namba-shots/walk/c8n-*` / `c8w-*` (the walks).

## Playthroughs (real keys, phone up)

| run | arrive | offer | ctx.errors | console |
|---|---|---|---|---|
| `P=c8n node tools/walk.mjs` | t = 501 s | 3:04 (`lost`) | `[]` | only the walk's own `dbg` warnings |
| `Q='?quality=low&noaudio&wander' P=c8w` | t = 546 s | 3:04 (`lost`) | `[]` | same |

End card, Before → After:

| row | normal (c8n) | lost player (c8w) |
|---|---|---|
| On track | 100% · 0:00 off → 100% | **82% · 0:27 off** → 100% (v7.3 expectation 83% / 0:26) |
| Position error | ±33 m mean, p90 68 m → ±0.5 m | ±23 m, p90 52 m → ±0.5 m |
| Wrong floor | 26% → 0% | 30% → 0% |
| Blue dot within 5 m | 4% → 100% | 9% → 100% |
| Trip | 8:21 · 661 m · 1 latte | 9:06 · 734 m · 1 latte |

Reroutes: 18 and 9 per km, about 5 "Recalculating…" in a 3-minute Maps phase. That reads as frustrating, not spam.
The tutorial pick worked in both runs ("Pick a place in Maps" → 1 → Café Mitsubachi, `nav:destination` app=maps), and so
did the gate step and the café order. The end card is sane (`c8n-14-endcard.png`).

`loadprobe` on the final tree: `READY 227.1s []`. The machine was at load average ~15 from other agents' browsers, and the v7 baseline was 46 s unloaded. `mouseshot` **did not finish**: it hit my 700 s timeout under that load. My edits don't touch its paths (pause menu, chip), and the Fixes agent's v8 run passed with errors `[]`, but the lead should rerun it before deploy.

## Per item

| # | item | grade | evidence | verdict |
|---|---|---|---|---|
| 1 | Maps feels lost | **8** | `c8n-04-maps-wrong-dev.png` ("Approximate ±41 m", "Compass needs calibration", "Directions for the remaining floors will appear once we detect you on 2F"), `c8w-04-maps-wrong-full.png` | Fixed. Frustrating, not broken: destination list, route sheet and tutorial all work, and the offer still lands at 3:04. The dot was 51–83 m off right before the offer, which is funny-bad. |
| 2 | Louder JA PA | **6** | critic8 log: on nk_plat_2 `testPA` → duck amb 0.739 → **0.25** (−12 dB), sfx **0.355** (−9 dB), engaged within 1 s; the concourse hears nk_plat_3 at gain 0.22; City 2F → `null` (silent) | Duck logic verified. The voice itself is untestable headless (no ja voice, `ja: null`). Partly fixed, until Zack hears it. |
| 3 | Lodestone full app | **8** | `c8n-08b-ready-3s-dev.png`, `c8n-09r-riding-dev.png`, `c8n-10b-lodestone-near-dev.png`, `h-e-6.2s.png`; Lodestone agent's `1024-full-*` | Fixed. One header shared with the glance strip; a heading-up map with route, dot, milestone pin and 2–3 shop names. It reads at a glance in the walk shots. Labels are small (about 9 px at 1024×576). |
| 3b | Upgrade "wow" | **7 → 8 after fix** | before: `c8n-08-ready-reveal-dev.png` (flat map, no 3D at all unless you press V). After: `h-a-snap-0.4s.png` → `h-c-3.6s.png` / `h-d-4.6s.png` (stack fly-in, route climbing to Daikichi 6F) → `h-e-6.2s.png` (settles to the map) | **Fixed by me** (see below). The stack's milestone labels overlap ("Canyon" under "▲3F"), which predates v8. |
| 4 | Calibration screen | **8** | `c8n-07-calibrating-dev.png`; Lodestone agent's `1024-calib-*` | Fixed. "Finding you indoors", a compass with converging guesses on the real plan, and four ticked plain-English steps with the floor bar lock. A first-timer can say what is happening. The sub line wraps with fallback fonts. |
| 5 | IC prompt off the escalator | **8** | `5-gate-prompt.png` (Nankai 3F, 1.2 m, facing: prompt shown; real `KeyE` → `ic:pay 970`, `gate:tap`); walk c8n: the only `bot:E` gatetaps are at the gate (64–66 s), then the 3F→2F escalator ride at 105 s with no tap | Fixed (the root cause is a body on a ramp keeping its level; the Fixes agent's per-frame trace went from 21 → 0 of 333). My own scripted ride did not move (setScript doesn't drive the real-time loop in this harness), so the trace and the walk are the evidence. |
| 6 | NPCs board through doors | **6** | `6-doors-start-b-nk_track_4.png` (rapi:t car 3 door open, the door frame lines up with the opening); crowd agent's doorprobe: 0 of 87 boarders > 0.5 m from a real door (was 52%) | Root cause fixed in numbers. **Not seen by eye:** no Nankai arrival happened in my 420 s of headless wall time (about 40 game s), so there's no shot of people walking into a door. The start platform looks as sparse as v7.3 from the bot's spawn view (`c8n-01-intro-2s.png` vs `v73-01-intro-2s.png`, both nearly empty), so the change didn't empty it, but it was never busy. |
| 7 | One loading title | **9** | `7-load-0.5s.png`, `7-load-mid.png` (42%), `7-title-screen.png`, `c8w-00-title.png` | Fixed. "Lost in Namba" with the なんば accent from 0.5 s to the title. The title moves from centred (loader) to left (title screen), which is the same words with a layout change; that's acceptable. The kana accent is low-contrast over the bright platform. |

## What I fixed

| file | change |
|---|---|
| `js/ui/phone/lodestone.js` | **The reveal hero beat.** After the "You're on 2F" snap card clears (about 2.9 s), the 3D stack opens with its fly-in (2.4 s), holds, and auto-settles to the top-down map after `HERO_S = 4.6` s. It plays only while the phone is up within 7 s of the reveal and needs a destination. Any manual view change (V, Done, a tap) cancels the auto-settle. `setView(v, hero)`, `_heroWait`, `_heroT`. The first try (the stack at once) hid the stack behind the big card (`r-e-walk-1.png`), hence the sequencing. |
| `js/ui/phone/mapapp.js` | A coarse Wi-Fi "You have arrived" false positive no longer sticks: once the believed dot is more than 15 m from the target, `R.arrived` resets and the route sheet returns (no Recalculating flash). |
| `DEMO.md` | The calibration copy (no more "magnetic fingerprint" / field lines), plus the hero beat and the everyday map view. |

I did not touch `js/analytics.js`, `js/npc/humans.js` or `js/npc/humanGeo.js` (the Apron agent's).

## What remains (honest)

- **JA voice loudness**: unmeasurable headless. Ask Zack whether he can hear it now. If not, the next lever is ducking the
  `voice` bus too and checking which ja voice Chrome picked (`audio.debug().pa.ja`).
- **Crowd at real doors on arrival**: no visual proof yet. Needs a shot during an actual Nankai arrival, or Zack's eye.
- **Stack label clutter** in the hero (milestone pills overlap). It is pre-existing, but now it's on screen in the hero beat.
- **Map after an escalator ride** (`h-e-6.2s.png`): on 1F right after riding down, the header still said "Riding down to
  1F" and no route line showed for a moment. That is probably the route-recompute lag; worth a look in a real-time walk.
- **Phone-up real-time walk with Lodestone**: not done. Headless runs about 1 game s per 10 wall s with screenshots, and
  the scripted input didn't drive the real-time loop. Readability is judged from the stepped walk shots.
- The "Click to look around" chip shows in the harness shots because pointer lock is stubbed. Real players won't see it.

## Would this impress the team? **7.5 / 10**

The upgrade now tells the Oriient story in one breath: the "No GPS · last seen 40 s ago" grey dot and a 26%-wrong-floor
Maps, then "Finding you indoors" in four plain steps, then "You're on 2F", then the whole building in 3D with the route to
6F, then a heading-up map that just works. It is held back by the unverified audio and doors, and by the small map labels.

## Top 3 risks

1. **The JA PA may still be too quiet on Zack's machine.** It depends on the OS voice, and the duck is the only lever we
   can measure.
2. **The hero beat's timing in real play**: if a player lowers the phone during the snap card, the hero is skipped (by
   design, within 7 s). If they're mid-walk, a 4.6 s 3D view replaces the map briefly. It's cancellable with V/Done, but
   it is untested by a human.
3. **Crowd density and door use at the start**, never seen on a real GPU. The start platform looks sparse from the spawn
   view, and fewer people board in the first 20 s since the doors are now real.
