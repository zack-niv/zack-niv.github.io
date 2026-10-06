# Wayfinding (signage + phone) — log

Owner files: `js/world/signage.js`, `js/ui/phone.js`, `js/ui/phone/*`, `css/phone.css` (linked at runtime by phone.js).

## What exists

### Signage (`js/world/signage.js`, build system)
- **Placement is derived from the layout** (no hand-placed arrows):
  - openings between non-room spaces → junction signs (corridor-end / corridor-side / hall),
  - long corridors → interval signs every ~34 m,
  - every escalator/stairs bank end → escalator-mouth sign ("▲ 2F" + what is up there, from the nav),
  - every gate line → gate board ("中央改札口 Central Gate", free side "のりば Platforms", paid side "出場 Way out" + directions),
  - every street exit → yellow "出口 15 Exit" sign before the stairs + Osaka Metro entrance box on a pole at the top,
  - subway platforms → station-name boards (なんば with ← 心斎橋 | 大国町 → computed for the reader's facing), track boards ("1 天王寺・なかもず方面 | 梅田・新大阪方面 2"), tunnel-wall name boards,
  - Nankai platform heads → "1 高野線 橋本・極楽橋方面 | 2 …", platform name boards,
  - floor guide boards ("現在地 You are here") wall-mounted (`_wallMount` finds a real wall/partition), mini-map rendered from the grid (`ui/phone/maprender.js`), north-up for Nankai/Metro, heads-up for NAMBAWALK/CITY (as in reality), numbered shop directory,
  - column wraps on any square obstacle (columns registered by architecture/props via `world.addBox`), max 60,
  - Parks wooden totems + a few street totems (registered as obstacles),
  - facilities that signage *builds* so it may point to them: toilets (doorway + plate + blade), coin lockers (locker bank + plate), taxi pole. (`FACILITIES` in `ui/phone/places.js`.)
- **Truthful arrows**: a Web Worker (blob module importing world.js/nav.js/routes.js) builds its own World+Nav in parallel with loading and descends each destination's flow field ~18 m from a viewer standing 1.6 m in front of each face; bearing quantised to ↑ ↗ → ↖ ←, behind-you destinations go on the other face. Level changes within 30 m add a "▲2F"/"▼B2" tag. Fallback: main thread with `ctx.nav`.
- **Selection is political**: Nankai signs never mention NAMBAWALK or metro exit numbers; CITY/Parks signs skip numbered exits; Parks signs skip the subway; Takashimaya skips NAMBAWALK/CITY; far destinations only on major signs; deterministic jitter per sign.
- **Sign families**: Osaka Metro (charcoal, white, yellow exits), Nankai (navy + orange stripe), NAMBAWALK (cream back-lit with 1/2/3番街 colour tag), Namba CITY (white + blue arrows-in-circles), Parks (dark wood, lowercase, green arrows), Takashimaya (deep green/gold).
- Faces in shelf-packed 2048² canvas atlases (deduped by content), one MeshBasicMaterial per page (colour ×1.35 for back-lit bloom), housings/rods in GeoBatch per (level, 48 m chunk, material) groups with `userData.chunk`.
- Lights: `ctx.lighting.addLight({kind:'sign'})` per sign during init.

### Phone (`js/ui/phone.js` + `js/ui/phone/*`)
- DOM device (340×700, scaled), slides up from the bottom, hand sway from player bob. Q / Tab / input action `phone` / touch button. Opening calls `input.exitLock()`, closing `input.requestLock()`. A pointer-lock acquired by clicking the world closes it.
- Status bar: game clock, battery drains (faster when open), signal bars by environment, 圏外 on B2 sometimes.
- `positioning.js`: the phone's belief — OU-wandering error (2 m outdoors … 23 m on B2), snaps, map-matching to the believed floor, slow fix rate underground, floor lag 5–20 s + occasional wrong adjacent floor, heading bias/jitter/lag.
- Maps (`mapapp.js`): cached per-floor base layers (4 px/m), vector redraw when zoomed in, roads & building footprint context, zone/shop/escalator/exit/gate/toilet labels with collision culling, floor picker (B2…8F), compass/heading-up, locate, drag/wheel/pinch. Search: businesses (`searchBusinesses`), transit places (lines, platforms, gates, the 4 "Namba" stations, Shin-Osaka/Umeda/KIX trips), areas, toilets/lockers/taxi, exits. Results show ★ rating, open/closed (isOpen + clock), crow-flies distance, floor badge. Place card with generated canvas "photo" (`art.js`) + reviews + hours. Ghost pins with floor badge for other floors; map stays on your floor. Directions: route from where the PHONE thinks you are, only the current-floor leg to the next escalator/stairs ("Take escalator up to 2F"), dotted crow-line to the destination; recalculates on believed-floor change or when 18 m off-route; walking time ignores crowds.
- Notes: quest checklist (`ctx.game.quests` + `quest:update`), defaults until the game provides them. Messages: `phone:message` thread + in-phone banner / peek card when the phone is down (`handlesMessages = true`). Transit: route card + departures via `ctx.transit.nextDepartures(trackId, n)` when it exists.

## APIs I expose
- `ctx.signage.ready()` → Promise (phone init awaits it), `ctx.signage.signs`, `ctx.signage.facilities`; event `signage:ready {count}`.
- `ctx.phone`: `isOpen`, `app`, `open(app?)`, `close()`, `toggle()`, `openApp(id)`, `search(q)`, `pos` ({x,z,level,acc,heading,signal,noService,env}), `handlesMessages`.
- Events emitted: `phone:open`/`phone:close` {app}, `phone:search` {query,count}, `phone:select` {id,kind,slot,key}, `phone:route` {id,level}, `phone:arrive` {id}, `signage:ready`.
- Shared data module `js/ui/phone/places.js` (LINES, DESTINATIONS with nav goals, EXIT_INFO, FACILITIES, TRANSIT_PLACES, PLATFORM_BOARDS) — others may import read-only.

## Requests to other areas
- **Transit**: `ctx.transit.nextDepartures(trackId, n)` → `[{ time:'10:52' | minutes, dest|destination, type }]` would light up the Transit app and place cards.
- **Game**: quests as documented in notes/game.md are rendered; `phone:message` handled.
- **Rendering**: signs are MeshBasicMaterial (`name: 'sign_face'`), colour ×1.35 — tune for bloom if needed; lights are `kind:'sign'`.

## Log
- v1: signage pipeline + worker directions, phone shell + Maps/Notes/Messages/Transit.
