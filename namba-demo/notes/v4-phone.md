# v4 — Phone (items 5, 6-UI) · owner: js/ui/phone.js, js/ui/phone/*, css/phone.css

## Destinations contract (Story: use this) — FINAL

```js
ctx.phone.suggest(slotId | null)   // Aya's pick. Highlighted at the TOP of both apps' lists ("From Aya", key 1).
                                   // Glance strip (no destination yet): "Pick a place in Maps" · "Aya: Wakakusa Coffee Stand".
                                   // Idempotent; null clears. Unknown slot ids are ignored (returns false).
ctx.phone.suggested                // the current suggestion (slotId) or null
ctx.phone.destination              // { slotId, name, level, app, suggested, arrived } or null
ctx.phone.setDestination(slotId, { app }?)   // programmatic pick (rarely needed). Returns true/false.
ctx.phone.clearDestination()       // drop the destination (both apps back to their list)
// events
'nav:destination' { slotId, name, app: 'maps'|'lodestone', suggested: bool }   // the player picked one (also on setDestination)
'nav:arrived'     { slotId, name, app }                                         // reached the chosen destination
```

- `slotId` is a shop slot from `js/world/directory.js` (`link_e03` Wakakusa, `parks_6Fdw03` Daikichi, …). The
  lists also offer the non-shop places Maps can search (stations, exits, toilets, areas); those come through with
  their place id as `slotId` (e.g. `t:midosuji`, `x:18`, `f:…`), so a `slotId` that is not in `businessBySlot` is
  "something else".
- **No auto-routing.** Neither app routes until a destination is picked. Maps opens on a "Where to?" list;
  Lodestone (after install) opens on the same list if nothing was picked.
- **One destination, shared by both apps.** Picking in Maps starts Maps' (vague, one-floor) route; Lodestone,
  once installed, guides to the same place. A destination picked in Maps survives the install, so the upgrade
  still snaps straight into guidance. A pick in Lodestone also re-targets Maps.
- **`nav:arrived`** uses the TRUE position (not Maps' believed one): same floor and within ~4 m of the door
  (Lodestone: or < 5 m of path left). Fired once per pick. After it the apps show **"Arrived · <name>"** and, if a
  suggestion is set and differs from where you are, **"Next: <suggested>"** (one key / click to go). So for the
  two legs: `suggest('link_e03')` → player picks → `nav:arrived {slotId:'link_e03'}` → `suggest('parks_6Fdw03')`
  → the arrived screen offers "Next: Tempura Daikichi" → player picks → `nav:arrived {slotId:'parks_6Fdw03'}`.
  (Your `demo:arrive` logic at Daikichi is untouched; `nav:arrived` is extra.)
- Picking something other than the suggestion is allowed: `nav:destination` says `suggested: false` — react lightly.
  The suggestion stays highlighted at the top of the list until you change it.
- The old Maps "From Aya's message → Daikichi" button is gone (it was hard-wired); `suggest()` replaces it.

## Keys (phone up, a list on screen: Maps "Where to?" / results, Lodestone list)

| Input | Effect |
|---|---|
| **1 … 9** | pick row N (row 1 = Aya's pick when there is one). Elsewhere 1/2/3 keep their v3 meaning (reply chips / dock slots). |
| **↑ / ↓** then **Enter** | move the highlight, pick it (arrow keys do not walk while a list is up) |
| click / tap a row | pick it |
| **/** | focus the search box (typing there never reaches the game: input.js ignores keys in inputs) |
| Esc in the search box | leave the box |

`ctx.phone.keys.pick = ['1'…'9', 'ArrowUp', 'ArrowDown', 'Enter']`. Suggested tutorial copy:
"**Q** phone up · pick **Aya's place** (press **1** or click it)".

## What the player sees

- **Maps (before the upgrade).** Raising the phone on Maps shows a "Where to?" sheet: where Maps *thinks* you are
  (±9 m), category chips (Coffee · Tempura · Ramen · Sushi · Toilets · Trains → Maps search results), then
  **Aya's pick** (blue card, red "FROM AYA", key cap **1**, "Go") and the places Maps offers up front (the
  directory's FEATURED places: 3 coffees, 3 tempura incl. the decoys, with crow-flies distances and "Closed ·
  opens 17:00"). Maps lists the tiny Wakakusa stand under its Japanese name (v1 realism); Aya's row shows the name
  she wrote with the listing name underneath. Search results are numbered too. Picking starts the old Maps route
  (one floor at a time, vague). × / End on the route = no destination.
- **Glance strip.** No destination: **"Pick a place in Maps"** · "Aya: Wakakusa Coffee Stand" (Q key cap always
  shown while a pick is waiting). Arrived: **"Arrived · Wakakusa Coffee Stand"** · "Next: Tempura Daikichi · pick
  it in Maps". Lodestone: the same in amber ("Pick a place in Lodestone").
- **Lodestone.** Same list in Lodestone styling (graphite + amber), with its own search box (`/`), chips, Aya's pick
  on top (amber), true floor chips instead of crow-flies distances. If a place was picked in Maps, the install
  snaps straight into guidance to it (no list). The trip card's Destination row gets a **Change** button (list + ×
  to go back). After arrival: "You've arrived" card on top + "Where next?" list under it, row 1 = "Next · from Aya".
  Free roam after the end card: the list is always one Change / arrival away.
- **Tracking** (track.js) follows whatever was picked: the Tracker resets on every new destination; one Guidance
  (cost field) per destination is cached, so going back and forth between legs costs nothing after the first time.
  The Namba Parks canyon detour is only offered on the way up into the Parks (3F+) and only once per game.

- **"Next" chip (lead's request).** While a route is active and `ctx.phone.suggested` is somewhere else, both apps
  show a one-tap **"NEXT · <name> · from Aya [1]"** chip: top of the Maps route sheet, and above Lodestone's trip
  card. Key **1** takes it (only 1: arrows and Enter keep their normal meaning there), so the second leg never needs
  Change or ×. Not added to the glance strip (it already carries the step; one glance = one decision).

## Stats across legs
`stats()` keeps every v3 field (before/after are positioning *phases*, not legs, so they stay sane over two legs:
before = Maps time, after = Lodestone time, frozen on `demo:arrive`) and adds
`legs: [{ slotId, name, app, suggested, arrived, seconds, metres }]` (one per pick) and `destination`.
Lodestone's arrival card shows the time of *this* leg with Lodestone (from the pick, or from the install when the
destination was picked in Maps), not the whole after-phase.

## Kept interfaces
`offerLodestone`, `installLodestone`, `positioningMode`, `upgradeStage`, `phone:upgrade`, `stats()`, messages /
replies / typing, dock (Tab, 1/2/3 when no list is up), poses, `search(q)`, `phone:route`, `phone:select`,
`phone:arrive` (Maps' believed arrival + Lodestone's), `lodestone:arrive {id}` (now for whatever destination
Lodestone reaches), `nav:track`.

## Files
`js/ui/phone/destinations.js` (NEW: `Destinations` state/events/arrival + `DestList` shared list + Next chip),
`js/ui/phone.js` (API, list keys captured before the game, `stats().legs`), `js/ui/phone/mapapp.js` ("Where to?"
home sheet, numbered results, routes driven by the shared destination, arrived sheet, route-sheet Next chip; the
hard-wired Daikichi `_goal()` is gone), `js/ui/phone/lodestone.js` (no default destination, list panel, Change,
per-destination Guidance cache, arrival from phone.dest, Next chip), `js/ui/phone/guidance.js` (shared canyon
state, detour only for Parks 3F+, transit destinations may cross the gates), `js/ui/phone/glance.js` (pick /
arrived cards), `js/ui/phone/stack3d.js` (clearing route / destination label), `css/phone.css` (v4 section at the end).

## Testing
Harness `scratchpad/ph4/t.mjs` + `t2.mjs` (PHASE=B/D/E/F, a fresh page per phase: SwiftShader pages crashed after
~8 min of shots on this shared machine — not the code: the same steps pass in a fresh page). Verified in-page:
no route before a pick; `suggest()` → glance "Pick a place in Maps · Aya: …"; ↑↓ move the highlight without moving
the player (0.00 m); typing "ramen 2 q" in the search box neither walks, switches app nor lowers the phone; key 1 →
`nav:destination {suggested:true}` + Maps route; teleport to the door → `nav:arrived` (Maps phase and Lodestone
phase); Arrived sheet with "Next · from Aya"; pick in Maps survives the install (Lodestone `ldRoute:true` at ready,
no list); Change → search "sushi" → 2 → `suggested:false`; Next chip + 1 in both apps; Daikichi → free-roam pick
of another place → guidance (6F → B1); `stats().legs` per leg; `ctx.errors` [] and zero console errors (only the
sandbox's Google-Fonts cert error + SwiftShader ReadPixels warnings).
Shots `notes/v4-shots/phone/`: 01 glance pick · 02 Maps list (Aya highlighted) · 03 keyboard highlight · 04 Maps
route · 05 glance route · 06 glance arrived+next · 07 Maps arrived → Where next · 08 Lodestone snaps into guidance
(picked in Maps) · 09–11 Lodestone Change / search / other pick · 12a Lodestone arrived + Next · 12 arrived, no
suggestion (free roam list) · 13 free-roam guidance · 14 glance · 15/16 Next chip (Maps / Lodestone).
(06, 08 and 12a predate two small layout fixes: glance arrived title now 2 lines, Change moved next to the
"Destination" label so the name isn't cut, Maps Next chip clear of the ×.)

## Unsure / known issues
- Digits on a list beat the v3 dock slots (1 = Aya's pick, not Messages). Tab / click still switch apps. With a
  route + Next chip up, only 1 is taken (2/3 stay dock slots, arrows walk, Enter is not taken).
- Maps search results now pick directly on click (the place card with photos / reviews is still one tap on a map
  pin; its Directions = pick).
- Arrival radius: 4 m from the door's outside point / 3 m from the door / < 5 m of Lodestone path. Story's own
  Daikichi arrival (`demo:arrive`) is separate and unchanged.
- Glance strip has no Next chip (it keeps the one step); "Arrived · …" + "Next: …" appear there after arrival.
- `stats().legs[].metres` come from the phone's walked-distance counter (teleports count 0).
