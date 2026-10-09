# NAMBA — "Lost in Namba" focused demo (ship TODAY)

Read this first, then `DEVNOTES.md` (architecture, contracts, testing tools)
and the area notes in `notes/` for the systems you touch.

`namba-demo/` is a frozen copy of the full game. It deploys to
**https://zack-niv.github.io/namba-demo/**. The full game in `../namba/` is
paused and must NOT be edited.

## Audience & goal

The audience is the team at **Oriient**, an indoor-positioning deep-tech
company. Their positioning is geomagnetic: it needs no hardware and is
accurate to about 1 m indoors, including multi-floor. Their taglines are
*"Indoor spaces shouldn't run on guesswork"* and *"The value is not the blue
dot. It's what it unlocks."* We are applying for a job there.

They will play for **5–10 minutes**. In that time they must:
(1) be amazed by an immersive, original, believable Namba;
(2) *feel* the pain of today's maps apps in a giant multi-level complex;
(3) feel the relief and delight of a precise indoor-positioning app mid-game.
The upgrade moment is the emotional and professional climax. It must look
like a product they'd be proud of.

**Branding rule:** never use Oriient's name, logo or brand colours inside the
app. The upgrade app is our own fictional **Lodestone** (a lodestone is the
natural magnet used in the first compasses). A personal note addressed to
the Oriient team appears only on the end card.

## The story (one quest)

1. **0:00 — Arrival.** Spawn `start` (Nankai 3F platform, the rapi:t from the
   airport, 11:20). There is a short, lovely intro with no long text. Aya
   texts: *"Landed? Meet me at Tempura Daikichi — Namba Parks, 6F! I'm
   already in the queue 🍤"*. The only objective is that tempura lunch. Coffee
   and the subway are not quests in the demo; the places still exist as
   world flavour.
2. **0:20–~3:00 — The ordinary map.** The phone has a generic "Maps" app (as
   now: `ui/phone/mapapp.js` + `positioning.js`).
   - The dot drifts 10–25 m underground and hops.
   - The floor is wrong or lagging, and the map is a flat single floor.
   - Daikichi shows as "350 m" as the crow flies, with no idea it's 6 floors
     up and across the complex.
   - Directions stop at the first escalator.
   - Make the frustration recognisable, but never tedious; it should be
     *funny*.
3. **The upgrade (~2:30–3:30, or earlier if the player is clearly lost).**
   - Aya: *"you're lost aren't you 😂 install Lodestone — it actually works
     indoors"*, with a tappable link card.
   - Install (2 s) → **calibration** (~3 s, v8): *"Finding you indoors · No
     GPS needed · just your phone's compass"*. One picture in a round window
     (a compass needle settles, the real floor plan fades in while guesses
     converge on you, the floor chip pops, the blue dot lands) and four plain
     steps that tick off: *Reading the magnetic field → Matching it to Namba's
     indoor map → Finding your floor… 3F → You're here · ±1 m*. The floor bar
     scans and locks onto your floor; the phone sways a figure-of-8 while it
     reads the field.
   - Then the blue dot snaps to the TRUE position with a ±1 m halo, heading is
     true, and the floor is detected instantly ("You're on B1").
   - **Hero beat (v8):** right after the "You're on 2F" snap card, a 3D
     "exploded" stack of the complex's floors flies in (translucent plates,
     the current floor highlighted, the route a glowing line climbing the real
     escalators to the destination pin on 6F), holds ~2 s, then settles to
     the everyday view. V / "3D view" brings the stack back (orbit/zoom by drag).
   - **Everyday view (v8):** a heading-up top-down map of your floor (route,
     dot + heading cone, next-milestone pin, 2–3 landmark names), under the
     same header card as the lowered-phone glance strip.
   - Turn-by-turn that is actually right: "Escalator up · 1F → 2F", "Turn
     left at Namba CITY 2F", ETA and floors remaining.
4. **~3:30–8:00 — Confident navigation.** The phone now *guides*. The player
   still walks through the world: Namba CITY → the Parks bridge → **emerging
   into the Namba Parks canyon** (the wonder moment: sky, strata, greenery) →
   escalators up → 6F.
5. **Arrival.** At Daikichi there is a short *visible* moment, not a black
   card: Aya waves from the queue (or the counter), the sizzle, and a few
   seconds of the counter scene. Then the end card.
6. **End card.**
   - **Before vs after** (measured live):
     - minutes lost before the upgrade vs minutes to arrive after;
     - metres walked in each phase;
     - mean positioning error before (from `positioning.js`) vs after (~1 m);
     - wrong-floor seconds.
   - The line *"Indoor spaces shouldn't run on guesswork."*
   - A short note: *"Built for the Oriient team by Zack Niv — a love letter to
     Namba and to indoor positioning."*, plus a contact line (placeholder
     `zack@…` that the lead fills in).
   - Buttons: "Keep exploring" (free roam with Lodestone), "Replay".

## Scope rules

- **The route is sacred.** Nankai 3F platform → 3F/2F concourse → Namba CITY
  2F → Parks bridge → Parks 2F hall → canyon → Parks escalators → 6F dining.
  Likely detours (Nankai 1F hall, Namba CITY B1/1F, NAMBAWALK) must look
  good. Everything else only needs to not look broken.
- **Cut, don't build.** If a system costs load time or frame time and the
  demo doesn't need it, disable or defer it.
- **Budgets:**
  - load ≤ ~60 s in `tools/loadprobe.mjs` headless (≈ ≤ 10 s on a laptop);
  - 60 fps on a mid laptop at `quality=high`;
  - phones may run `low`;
  - show a polite "best on a computer with keyboard & mouse" note on touch
    devices, but still work.
- **Zero console errors.** No `ctx.errors`.

## Ownership (parallel work in `namba-demo/` ONLY)

| Agent | Owns |
|---|---|
| Phone & Lodestone | `js/ui/phone.js`, `js/ui/phone/*`, `css/phone.css` |
| Demo flow & end card | `js/game/*`, `js/ui/hud.js`, `js/ui/title.js`, `css/game.css`, `index.html` |
| World fixes on the route | `js/world/*` (except `layout.js`, `world.js`, `nav.js`, `directory.js`: ask the lead), `js/npc/*` |
| Load & perf | `js/render/*`, `js/core/*`, `js/main.js` |

Communicate through `namba-demo/notes/demo-<agent>.md` (APIs, requests). No
`git`; the lead commits. Headless browsers are rate-limited machine-wide
(`tools/slot.mjs`). Test with `node tools/shot.mjs` / `tools/loadprobe.mjs`
run from `namba-demo/`.

## Interfaces between agents (agree on these)

- `ctx.phone.positioningMode`: `'gps'` | `'lodestone'` (set by
  `ctx.phone.installLodestone()`; emits `phone:upgrade` {stage:
  'offer'|'installing'|'calibrating'|'ready'}).
- `ctx.phone.stats()` → `{ meanErrorBefore, meanErrorAfter, wrongFloorSeconds,
  ... }` for the end card.
- The game triggers the offer via `ctx.phone.offerLodestone()` (or a
  `phone:message` with `{link:'lodestone'}`). The phone handles the
  install/calibrate UX, then emits `phone:upgrade {stage:'ready'}`.
- `demo:arrive` is emitted by the game when the player reaches Daikichi.
