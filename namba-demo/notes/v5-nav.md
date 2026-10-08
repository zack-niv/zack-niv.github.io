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
