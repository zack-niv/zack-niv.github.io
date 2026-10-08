# v5 — Nav (items 1, 4, 5, 6) · owner: js/ui/phone.js, js/ui/phone/*, css/phone.css, js/game/*, css/game.css

## Contracts (published first — FINAL unless noted)

### Milestones (item 1)

```js
ctx.phone.nextMilestone   // the next thing to expect on the active route, or null (no route / arrived / Maps without a route)
// {
//   kind: 'escalator'|'stairs'|'lift'|'passage'|'gate'|'turn'|'arrive',
//   dir: 'up'|'down'|null,           // ramps only
//   toLevel: '3F'|null,              // ramps: the floor it takes you to; arrive: the destination floor
//   dist: 120,                       // metres of path to it (Lodestone: true path; Maps: its one-floor leg, as it believes)
//   name: 'Namba Parks canyon'|'Tempura Daikichi'|undefined,   // passage / arrive
//   side: 'left'|'right'|'ahead'|null,                         // where it is relative to your heading (when < 30 m)
//   level, x, z,                     // where it is
//   app: 'lodestone'|'maps',
//   pass: { name, dist } | undefined // long legs (> 60 m): the shop you'll walk past next ("Straight past Sneaker Lab")
// }
// event: 'nav:milestone' { ...same } — emitted when kind / dir / toLevel / name changes (not on every metre)
```

### Place links in messages (item 5)

```js
ctx.phone.message({ id, from, text, place: 'city_1e12' })   // any destination id (shop slot, or a Maps place id)
```
- The bubble carries a link-preview card (like a Maps share link): photo tile (the place's art) or category glyph,
  name, `floor · area`, open/closed, the distance as the ACTIVE app sees it (Maps: crow-flies from where it thinks
  you are; Lodestone: true path metres), and an action `Open in Maps` / `Open in Lodestone`.
- Tapping it (phone up on Messages: click, or **Enter** for the newest card when no Lodestone offer is waiting) opens
  the active nav app on that place's card. **Go** (click / **Enter** / **1**) sets the destination and emits
  `nav:destination { slotId, name, app, suggested, via: 'link' }`.
- The Lodestone install card (`link: 'lodestone'`) is unchanged; "From Aya" stays at the top of both lists.
- `aya.say({ text, place })` passes `place` through (js/game/aya.js).

### Route controls (item 6) — same in both apps

| Action | Maps | Lodestone | Key (phone up) |
|---|---|---|---|
| End route | × / End on the route sheet | **End ×** on the trip card | **X** |
| New destination | search box (always there) | **New** (search) on the trip card | **/** |
| Pick from the list | rows, 1–9, ↑↓ Enter | same | same |

- `ctx.phone.endRoute(app?)` — stops guidance (both apps back to "Where to?"), emits `'nav:end' { app, slotId }`.
  The glance strip shows a calm "No route · Where to?"; no heading warnings / buzz while there is no route.
- Picking a place while routing replaces the route (`nav:destination` as before). `nav:arrived` unchanged.

## Findings (root causes)

- **1 (no direction on the glance strip):** `LodestoneApp.glanceInfo()` / `_renderGuide()` showed the live arrow only for
  walking steps (`isLive()` excludes ramp / via / arrive steps). When the next step is an escalator 165 m away the tile
  swaps to the escalator glyph — so the compass disappears exactly when the milestone is far.
- **4 (canyon out-and-back):** `Guidance` forces one via-point (2F, 33, 222) in the canyon; from there the shortest
  path to Daikichi is back west along z = 223 to `esc_pk_23` (nav probe: `canyon → dk` legs `2F 34,223 → -3,223`).
  Detour +64 m, all of it a back-track.

## What changed

### 1 · Compass + next milestone (`js/ui/phone/milestone.js` NEW, `lodestone.js`, `glance.js`, `css/phone.css`)
- The glance strip and the Lodestone instruction card ALWAYS show the live heading arrow (the Tracker's bearing, as in
  v3) in the big tile. The next milestone is a small icon in front of its words:
  - far: `[arrow] [esc] Escalator down to 1F` · `In 105 m · past RE:STYLE`
  - < 30 m it takes over with the side: `Escalator down — straight ahead` / `— on your left` · `In 20 m · to 1F`
  - long legs (> 60 m): the next storefront on the path from the directory (`PassCue`, door within 7 m of the path,
    16–85 m ahead, sticky until passed). Glance: `· past <shop>`; card: a `PAST ↑ <shop> · 25 m` row.
  - off-route amber / rerouting still replace it (unchanged `track.sign()` path).
- `ctx.phone.nextMilestone` + `'nav:milestone'` (Lodestone from its route tick, Maps from phone.update at 2 Hz).

### 4 · Canyon: the natural way up, a loop (`guidance.js` `VIAS`, `script.js` CANYON_TEXT, `tools/walk.mjs`)
- Via chain: canyon floor (2F 33,222) → the canyon's own garden stairs `stair_pk_g3` to the 3F terrace → the 3F glass
  bridge (3F 46,239) → Parks 3F → escalators to 6F. No step is walked twice. Steps (node probe from the Parks bridge):
  `Out into the canyon garden 42 m → Stairs up 2F→3F 52 → Turn right (Parks Garden 3F) 61 → Cross the glass bridge
  80 → Escalators up 3F→6F 129 → Arrive 200`. Cost vs indoor: +98 m (v4 out-and-back: +64 m, all back-track).
  Full garden-terrace route to 6F was +212 m: rejected.
- Stage tracking (`noteBody`): in the canyon / on the 3F garden → stage 1; on the bridge or anywhere in Parks ≥ 3F
  indoors → done (taking the indoor escalators first drops the scenic way, as before). Offered once per game.
- Lodestone wording: "Through the canyon garden — the scenic way up", "Cross the glass bridge over the canyon".
- Aya at the Parks bridge: "take the canyon way up 🌿 out into the garden, up the stairs, then across the glass bridge.
  trust me".
- walk.mjs follows Lodestone's `guid.leadField(body)` while the scenic way is pending (`&nocanyon` to skip).

### 5 · Place links (`apps.js` MessagesApp, `phone.js` openPlace, `mapapp.js` preview, `lodestone.js` preview, `aya.js`, `story.js`, `script.js`)
- Cards: photo tile (placeArt) · name · `6F · Namba Parks · 190 m` · `Open in Maps ›` (blue) / `Open in Lodestone ›`
  (amber). The newest card shows the `Enter` key cap.
- Maps: opens its place card (Directions = Go, `Enter`/`1`). Lodestone: its own preview (photo, "From Aya's message",
  floor chip, TRUE walking distance + minutes, open now, big amber **Go ⏎**, × / X closes).
- Aya's links: "Meet me…" → Daikichi, the coffee ask → Café Mitsubachi, "omg you're an angel… NOW come" → Daikichi,
  the no-latte tease → Daikichi. Tutorial pick step on Messages: "Open Aya's link — Enter or click the card".

### 6 · Route controls (`phone.js` endRoute/newDestination + keys, `lodestone.js` trip card, `mapapp.js` endRoute)
- Lodestone trip card: **New place /** and **End route X** buttons (the old "Change" pill is gone).
- X (both apps, phone up): End route → `nav:end`, list "Where to?", glance "No route · Where to? · Aya: …", no tracker.
- / (both apps): search focused at any time; in Lodestone while routing it opens the chooser over the route.
- Lifted the Next chip / 3D button above the taller trip card; 3D band bottom 264 → 306.
- Tutorial `pick2Route*`: "{1} takes Aya's pick (or {X} ends this route)" (the Change wording was stale).

## Evidence (`notes/v5-shots/nav/`, probe `scratchpad/nav5/ui.mjs` + `ui2.mjs`, ?test&quality=low&nocrowd)
| shot | what |
|---|---|
| 03b_glance_far_full | arrow + `↘ Escalator down to 1F` · `In 105 m · past RE:STYLE` (CITY 2F mall) |
| 04_glance_near | `Escalator down — straight ahead` · `In 20 m · to 1F` |
| 15_canyon_stairs_full | canyon floor, the garden stairs ahead; glance `Stairs up — straight ahead · In 15 m · to 3F` |
| 16_garden3_bridge_full / 17_on_bridge_full | 3F garden → `Over the glass bridge · In 20 m`; on the bridge → `Escalators up to 6F · In 45 m` |
| 14_lodestone_canyon_step | card: `In 45 m · Through the canyon garden — the scenic way up` · THEN `Stairs up to 3F` |
| 05 / 20_lodestone_* | trip card with New place / End route; 20 = Next chip sitting clear above it (after the lift fix) |
| 06 / 07 | after X: "Where to?" list (Aya's pick row 1) · glance `No route · Where to? · Aya: Café Mitsubachi` |
| 08 / 09 | `/` + "ramen" → Enter → new route (Tonkotsu Kamikaze 6F), `PAST Drug Hikari · 25 m` |
| 10 | arrived at the café after replacing the route (/ Esc 1) |
| 01 / 02 | Maps-era link cards → Enter → Maps place card → Enter → `nav:destination {via:'link'}` |
| 11 / 12 | Lodestone-era cards → Enter → preview (190 m · 2 min walk) → Enter → `nav:destination {via:'link'}` |
| 18 / 19 | v4.3 long names wrap to 2 lines on the trip card ("Yōshoku Kitchen Hanada") |
| walk `w-p1a-list-full` | v4.3 tutorial hint sits left of the raised phone (not over it) |
Event log of the cycle: `nav:end` → `nav:destination` (ramen, list) → `nav:destination` (café, list) → `nav:arrived`
→ `phone:link` → `nav:destination {via:'link', suggested:true}`. `ctx.errors []`, 0 console issues. loadprobe READY 16.3 s [].

## Full playthrough (`node tools/walk.mjs`, crowd on, quality low)
Pick 1 (Maps, key 1) café 24.7 s → offer 108.6 s → Lodestone 122 s → `nav:arrived city_1e12` 256.8 s → order → Aya's
"NOW come" text (with a Daikichi link card) → pick 2 (Lodestone, key 1) 283.8 s → Parks bridge, Aya's new canyon text
348.6 s → canyon 372 s (`discover canyon`) → **garden stairs 2F→3F @53,225 404 s** → glass bridge → 3F→6F escalators
→ arrive 502 s → end card "Whole trip 8:22 · 661 m · 1 iced latte delivered". `ctx.errors []`; the 2 console lines
are the bot's own `dbg` warnings. Copied shots: `walk_w-09b-glass-bridge` (on the bridge, glance `Escalators up to 6F ·
In 55 m`), `walk_w-09-canyon`, `walk_w-p2a-list-*`, `walk_w-10b-lodestone-near-dev`, `walk_w-14-endcard`.
Bot trip 7:04 (v4) → 8:22: the loop is +98 m (~+25 s on foot vs the v4 out-and-back) and the bot lost ~20 s stuck at
the garden-stairs foot (52.5, 225.6) and ~15 s at the 3F escalator foot; a player walks it in ~30 s more than v4.

## Unsure / for the lead
- **Trip length:** the canyon loop costs ~+35 m / ~25 s more than v4's out-and-back. It is purposeful now (you climb
  out of the canyon and cross it on the glass bridge), but if the 5–10 min budget gets tight, the fallback is
  `VIAS = []` (indoor escalators only) — one line in `guidance.js`.
- **Maps place card:** Directions sits under the photo (Maps realism); `Enter` / `1` work but the key cap is below the
  fold on a short sheet. Lodestone's preview has the big Go.
- **Milestone wording for "Turn left" under 30 m** has no extra side (the word is the side). Turn steps come from the
  v3 DP-simplified path; I did not touch which turns get announced.
- The `nav:milestone` event fires on milestone identity change only (kind / dir / level / name / position), not per metre.
- `player:teleport` resets the Tracker, but teleport-back in probes still produced a "Rerouted" card once (05) —
  harness artifact, not seen in the walk.
