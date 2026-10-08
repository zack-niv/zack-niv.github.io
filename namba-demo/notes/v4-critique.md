# v4 critique — harsh critic + fixer pass

Machine quiet (load avg ~2.4 at start, no other agents). Headless Chromium + SwiftShader, 1024x576 (walks, `quality=low`) and
1280x720 (`quality=high`) for the vantage / crowd shots. Shots: `notes/v4-shots/critic/` (`after_*` = after my fixes,
`d_*` = lunch queue run before the lane fix, `ph_*` = phone UI). Walk-bot shots copied as `walk_*`; logs in the scratchpad (`critic-demo/walk.c1.out`, `walk.fin.out` (after fixes),
`walk.alt.out`, `shots/c1-*`, `shots/alt-*`).

## 1. Full playthrough (walk bot, v4)

**Coffee path** (`walk.c1`, Aya's pick both times): look/move → "Landed??" 11.7 s → reply → "Meet me…" 18.2 s → coffee ask
21.7 s → **pick step: Maps list, key 1 = Café Mitsubachi (suggested)** 24.3 s → "Where are you??" 102.6 s → offer 108.9 s →
**Lodestone ready 117.6 s** (keeps the café, "see? 😌 it even knows which floor my latte is on") → down the CITY 2F mall, U-turn
into the down escalator → `nav:arrived city_1e12` 257.1 s (fires as you step off the escalator: the café is at its foot, so the
~4 m radius is generous but not wrong; the late hint then says "walk up to the counter, E") → order at the counter 270.4 s
("One iced latte… To go!") → Aya "omg you're an angel" → **pick 2 in Lodestone, key 1 = Tempura Daikichi** 276.8 s → canyon
→ 6F → arrive 423.6 s → end card *±4.5 m vs ±0.5 m · 25 s vs 0 s wrong floor · 7:04 min · 567 m · 1 iced latte delivered*.
`ctx.errors []`, 0 console issues (only the bot's own `dbg` lines).

**Other-pick + skip path** (`walk.alt`, `&nocoffee`, first pick = row 2): picks Wakakusa (`suggested:false`) → Aya
*"ooh, Wakakusa Coffee Stand first? 😂 I'll wait…"* → upgrade 117.6 s → walks past the café → *"no latte? 🥲 fine. FINE."* →
pick 2 taken via the **Next chip while still routing to Wakakusa** (key 1) → arrive 366 s → sane end card (±7 m vs ±0.5 m,
12 s vs 0 s, 509 m). `ctx.errors []`.

Heading guidance: sensible on both legs (Escalator down 2F→1F at 172 m, "Turn right", "Arrive at Café Mitsubachi"; leg 2:
"Take the escalator up to 2F" → canyon → 6F). One flicker: at the 1F escalator foot the step toggles "Arrive at Café…" ↔
"Escalator down 2F→1F · 0 m" for ~2 s while you step off. The bot loses ~20 s at that escalator foot (bot, not game; the
c1 walk-through probe shows a player walking straight at a lane boards in 4.4 s, even through a lunch queue).

Load (quiet): READY 38.7 s / first frame 38.8 s at `quality=high`; **the v3 commit (1e58a5a) measured the same way today gives
41.0 s first frame**, `&nocrowd` v4 40.8 s — so no v4 regression: the ~30 s "Drawing the first frame" is SwiftShader on this box
today (the 11–13 s quiet runs were on an earlier day). Systems ready 7.3 s.

## 2. Scorecard (before = as handed to me → after my fixes)

| # | item | before | after | evidence |
|---|---|---|---|---|
| 1a | CITY B1/1F court: furniture hanging from the ceiling | **fixed** | fixed | `a_city_b1_up`, `a_city_1f_top`, `a_city_1f_court` — closed ceilings. Residual: faint gray cell-stepped patches on the court ceiling over the void (light-field cells, not geometry) |
| 1b | Parks 6F skywalk: open back room | fixed (strata wall right behind the glass, reads like a slab) | **fixed + frosted** | `b_parks6f_skywalk` → `after_b_parks6f_skywalk` (obscured beige panels behind the glass) |
| 1c | Roofless restaurants from terrace / canyon / ride | fixed | fixed | `c_canyon_w` (closed strata), `c_ride6f7f`, `c_5f_boardwalk`; the shells note's `7F,40,345` pose is inside solid mass (no space there) — not a vantage point |
| 2 | Phone prop in hand | **not fixed** | **not fixed** (one cause fixed) | `phone_closeup*`, `after_phone_closeup*`, crowd's own `after_phone.png`: empty hand. See "What remains" |
| 3 | Seated people on seats | mostly fixed | fixed (+ footrests) | `seats_cafe_mitsubachi`, `seats_daikichi`, `seats_cafe_2f`, `seats_counter_stools*`, `after_seats_*`: hips on seats, facing tables/counter, no legs through chairs |
| 3' | Seat spot heights / cafe.js stool offset (Shells) | done (syntax only) | verified | log: café spots h 0.82 / 0.495 / 0.46, udon counter 0.73, Daikichi 0.584, 0 bad seats, people sit on the drawn stools |
| clump | Nankai 3F head at start | **fixed** | fixed | `nk3f_head_t10/20/40`: ≤ 8 people within 3.5 m of any 3F head at t = 10–55 s, lines ≤ 3 |
| late | NPC flow / congestion at escalators | **partly** | **partly** (no measurable change) | start and route-time flow fine (Nankai head, walk-through boards in 4.4 s); but at lunch (12:10) the CITY 2F down escalator `esc_city_b_1` holds 25–50 queued, a blob (`city_esc_lunch`, `d_city_esc_lunch_settled`). Lane balancing added; browser re-run still 23→41 queued, ~0.9 boardings/s (`after_city_esc_lunch_settled`) |
| 4 | Coffee checkpoint, turns | fixed | fixed | walk c1 / alt above |
| 5 | Lodestone navigates anywhere (free roam) | fixed | fixed | `ph_09–11` (Change → search "sushi" → pick 2 → guidance), phone notes' free-roam run |
| 6 | Choose destination (tutorial) + suggested highlight + free choice | fixed | fixed | `c1-p1a-list-dev` (Aya's pick highlighted, key 1), alt run (row 2 + Aya reacts) |
| P | Phone agent's 4 unrendered tweaks | unverified | verified | glance "Arrived · Wakakusa Coffee Stand" wraps to 2 lines cleanly (`ph_06`); Change beside Destination (`c1-08b`, `ph_08`); Maps Next chip clear of × (`ph_15`, name was truncated → fixed); Lodestone search clears after pick (`ph_10`→`ph_11`) |

## 3. What I fixed (files)

- `js/world/env/kit.js` — `stool` geometry gains a **footrest ring + cross brace** at 8 cm (×1.12 on bar stools): the feet of
  people on 0.82 m bar stools (which hovered ~8–10 cm) now rest on it; the 0.73 / 0.58 stools get a ring that sits behind the feet.
  ~90 triangles per stool, same material, merged.
- `js/world/arch/shells.js` — room backs seen through **skywalk glass** use `wall_panel_white` (reads as obscured/frosted glazing)
  instead of the canyon strata; everything else unchanged (`wall_panel_white` is already in the Parks chunks).
- `js/npc/sim.js` `_beginRamp` — **lane balancing**: when the stand-lane line at an escalator end is ≥ 4 and more than twice the
  walk-lane line, able people (no suitcase, not elderly/child/tourist) take the walk lane. Realistic and harmless (flowprobe in Node
  unchanged: Nankai start max density 6, worst wait 10 s; CITY 2F lunch maxQ 8), but the in-browser lunch blob did **not** shrink
  measurably (still ~0.9 boardings/s), so the bottleneck is elsewhere (see remains 2).
- `js/npc/humans.js` — the phone box sat 5 mm off the hand's centre line, i.e. inside the 3 cm hand mesh; moved to the palm side,
  slightly proud of the fingers. Necessary but **not sufficient** (see below).
- `css/phone.css` — the narrow Maps "NEXT" chip hides "from Aya" so the place name fits ("Tempura D…" → "Tempura Daikichi").

## 4. What remains (honest)

1. **Phone prop still not visible (item 2, quality bar "no exceptions").** Diagnosis so far: CPU-skinned positions of the phone
   vertices land at the wrist (5–10 cm), the clip→flag logic sets the PHONE bit, but a debug run with a 0.45 m white phone box AND
   every accessory bit forced on (`renderer._flags = () => 0xffffff`) still drew **no accessory at all** on near people 2 m away.
   So the near (SkinnedMesh) accessory geometry is not reaching the screen — suspects: the global lighting material hook
   (`render/lighting/inject.js nbHook` runs its `patch()` before the crowd's `#include <begin_vertex>` replacement), the shared
   program cache key across outfits, or the hidden-vertex collapse. Needs a GPU-side look (dump the compiled `crowd_person` vertex
   shader). This is the biggest open item; the player will notice it again.
2. Lunch-time escalator blob: in the browser (600 people at `quality=high`) the CITY 2F down escalator boards ~0.9 people/s for
   both lanes together, while Node flowprobe (~240 people) never exceeds 8 queued — so the probe under-reproduces the browser.
   Next step: measure per-lane boardings in the browser (is the walk lane ever used? is the head-of-line approach the limit?) and
   cap the line (people beyond ~12 re-plan to a same-floor destination). Only reached in long free roam (the demo runs 11:20–11:27;
   at 11:24 the bot rode it without waiting).
3. Arrival glance still reads "Daikichi on your right · In 5 m" during the arrival cut-scene (`c1-12-arrive-aya`); coffee payoff
   caption not seen headless (real-time timing, as in v3).
4. 1F court ceiling over the void: faint gray, cell-stepped patches (light-field cells over the extended ceiling).
5. Tutorial "Move the mouse to look around" toast can sit over the phone's list for a player who hasn't looked around yet (bot-only
   in practice).
6. Lodestone trip card truncates long names ("Café Mitsub…", "Tempura Da…") next to the ETA.

## 5. Would this impress the team? **8 / 10**

The two-leg errand is the right fix for "too straight": you pick from a real list, Aya reacts to whatever you do, the upgrade
still lands at ~2 min and snaps straight into guidance, and nothing ever blocks. The shells pass genuinely closed the dollhouse
views from every vantage I tried. It loses points for the one thing the player explicitly asked for that still isn't on screen —
phones in hands — and for lunch-crowd blobs if someone free-roams long enough.

Top 3 risks:
1. **Phones still invisible** in people's hands (the player's item 2) — possibly other hand/head accessories on near people too (debug run showed none).
2. **Escalator crowding in free roam** at lunch on the CITY 2F down escalator (on the coffee route).
3. **SwiftShader-only verification**: 30 s first frame here, frame rate / crowd density on a real laptop GPU still unmeasured.

## 6. Re-verification after my fixes

Full walk again (`walk.fin`, coffee path): pick 1 Mitsubachi (Maps, key 1) → Lodestone ready 117.8 s → `nav:arrived` 255.9 s →
order 275.2 s → pick 2 Daikichi (Lodestone, key 1) → arrive 430 s → end card ±7.9 m vs ±0.5 m, 13 s vs 0 s wrong floor, 568 m,
1 iced latte delivered. `ctx.errors []`, zero console errors (the sandbox Google-Fonts cert error excluded). Route, upgrade,
canyon, escalator wells and end card unchanged. Phone UI harness phases B / D / F: `ctx.errors []`, 0 real console errors.

## Correction (v4.2)
"No accessories drawn on near people" had two causes, fixed in sequence:
1. **v4.1 hotfix** (`notes/v4-hotfix.md`): a float32 rounding bug in the accessory mask (`int(crMask + 0.5)` overflowed to 1<<24) hid every accessory on every non-backpacker outfit. The `inject.js` lighting hook was not involved.
2. **v4.2** (side session, commit 697987a, merged): with accessories drawn, the phone was still buried. The old `phoneArm` pose put the hand at the chin with the palm toward the face, so the phone sat between the hand and the face. The new pose holds the hand in front of the chest with the palm up to the eyes, loose grip; `photo` is one-handed with the phone turned outward; the phone case is graphite with a screen face. `browse` (reaching for a shelf) no longer shows a phone.
