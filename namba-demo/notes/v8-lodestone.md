# v8 — Lodestone (items 3 and 4)

## Contract (for the other agents and the lead)

- `phone:upgrade` stages and timing unchanged: `installing` at start, `calibrating` at T_INSTALL + 0.15 s (1.95 s),
  `ready` at + T_CALIB (3.0 s). `ctx.phone.upgradeStage` unchanged. Total install + calibration = 4.95 s, as before.
- `nav:milestone` / `ctx.phone.nextMilestone` unchanged. `LodestoneApp.glanceInfo(full)` keeps its shape; `full = true`
  only rewords the no-destination and arrived states for the raised app.
- `glance.js` exports `NavHeader`: the one header renderer (heading-arrow tile, the milestone's small icon and words, one
  sub line). The glance strip (`Glance`) and the raised Lodestone app (`.ld-head .ld-hdr`) both use it, fed by the same
  `glanceInfo()`. So the strip you see with the phone lowered is the card at the top of the raised app.
- `maprender.js`: additions only (`THEMES.lodestone`, a dark theme). `drawFloor` is untouched, so Maps is unaffected.
- New file `js/ui/phone/ldmap.js` (`LdMap`, `CAL_DONE`): Lodestone's top-down map and the calibration picture.
- `LodestoneApp.calibLabel()`: the current calibration step's words (the glance strip shows them while calibrating).
- `positioning.js`, `mapapp.js`, `routes.js`, `stats.js` and `phone.js` are untouched. Lodestone reads only
  `pos.x/z/level/heading/acc`.
- Removed DOM: `.ld-nav*` and `.ld-then` (the old instruction card). No tool or game file referenced them (grep).

## What changed

### 3 · The full app
- **Header:** the same black card as the glance strip, from the same data: arrow tile, "Cross the bridge", "In 40 m ·
  Namba Parks". It stays put through the reveal; in the 3D view (V) it is the same card.
- **Map:** the old guide view drew a small isometric 3D stack. It is now a full-bleed top-down plan of your floor:
  - built with `maprender.drawFloor` in the new dark theme, baked once per floor;
  - heading-up and following you, with the dot, heading cone and ±1 m halo;
  - the route on this floor in amber, with flowing dashes that show which way to walk;
  - the next milestone as a blue pin with its words ("Escalator ▲ 3F", "Bridge"), clamped to the band edge when
    off-screen; the destination as an amber pin with its name when it is on this floor;
  - 2–3 shops or landmarks right beside the route ahead (within 13 m of the route, re-picked once a second, sticky);
  - a north chip, and a slim floor ladder (you blue, destination amber) when the route changes floor.
  - The zoom eases (1.5–4.2 px/m) so the next milestone stays in the band between the header and the trip card.
- **3D stack:** stays on V and the "3D view" button. Its fly-in now plays the first time V opens it, not behind the map.
- The trip card (You are here, Destination, New place, End route) and the dock are unchanged, just ~20 px tighter.
- Tapping the map still opens the 3D view.

### 4 · Calibration
- Title "Finding you indoors", sub "No GPS needed · just your phone’s compass".
- One picture in a round window: a compass needle hunts and settles (reading the field), then the real floor plan around
  you fades in while amber guesses converge onto you (matching), then the floor chip pops, and the blue dot lands with
  its ring. The amber progress ring around the window turns blue when done.
- Four steps tick off (spinner → blue check): Reading the magnetic field → Matching it to Namba’s indoor map → Finding
  your floor… **3F** → You’re here · ±1 m (done at 0.25 / 0.52 / 0.76 / 0.86 of the 3 s).
- The floor bar scans and then locks onto your real floor (blue).
- The figure-of-8 sway runs while reading the field and settles once matched.
- Glance strip while calibrating: "Finding you indoors…" plus the current step's words.

## Evidence

Screenshots in `notes/v8-shots/lodestone/` (1024×576 and 1280×720; `*-calib-*`, `*-ready-reveal`, `*-full-*`,
`*-glance-*`, `*-stack-view`). Harness: a small Playwright script (`ldshot.mjs`, kept in the agent's scratchpad) that
installs Lodestone, freezes the calibration at 12/42/70/96 %, then teleports to route points facing along the route.

## For the lead

- `DEMO.md` still describes the calibration as "Learning this building's magnetic fingerprint…" with field lines. That
  copy is gone (Zack found it unclear); update the doc if you like.
- The hero 3D stack no longer plays automatically at the reveal. The reveal is now the map with "You're on 3F". If you
  want the stack fly-in back as the hero beat, it is a one-line change: in `_finish`, call `this.setView('stack')`.
