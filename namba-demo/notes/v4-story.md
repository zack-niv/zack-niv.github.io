# v4 — Story (item 4 + the tutorial side of 6) · owner: js/game/*, js/ui/hud.js, css/game.css, index.html

Status: **implemented**, full walk bot completes the demo with the coffee leg (results at the bottom).

## The coffee checkpoint — where

Nav-graph probe (`scratchpad/story4/cafes.mjs`, nav distances from the rapi:t spawn, detour = start→café→Daikichi −
start→Daikichi, which is 500 m):

| café | where | detour | verdict |
|---|---|---|---|
| Wakakusa Coffee Stand `link_e03` | B1 link passage, x −81 | **+396 m** (3 extra level changes) | too long: +4–5 min |
| Café Mocca Rest / Lantern / Pine Tree … | CITY 2F mall | +0–2 m | on the straight line: no turns |
| **Café Mitsubachi `city_1e12`** | **Namba CITY 1F**, east side, at the foot of the `esc_city_b` escalators (x 4, z 111) | **+34 m** | **picked** |
| Blue Hour Coffee `parks_4Fe03` | Parks 4F east | +22 m | late in the trip, after the wonder |

**Café Mitsubachi (CITY 1F).** Walking down the long CITY 2F mall the player must turn back into the down escalator at
z ≈ 124 (it runs north), step off on 1F, turn to the café beside the escalator foot, order, then ride the up lane, which
leaves you on 2F heading south again. A couple of turns + a floor change, ~30 s extra, and it breaks up the longest
straight walk of the demo. The name is read at runtime from `businessBySlot` (procedural name; the slot id is the contract).
Aya asks for an **iced latte** (the order line is overridden for the errand café).

## Order of beats — coffee FIRST (picked in Maps), the upgrade lands on the way

The coffee is the **first destination** (picked in Maps during the tutorial). The Lodestone offer keeps its v3 triggers
(lost/stalled from 45 s, "Where are you??" at 100 s, fallback 165 s), so the upgrade still lands at ~2 min. The café is
~344 m from the start (≈ 4 min of walking), so for almost every player the offer arrives on the way to the café; Lodestone
keeps the destination picked in Maps (contract) and snaps straight into guidance **to the café**. After the coffee, Aya
suggests Daikichi and the player picks it (second use of the list, now usually in Lodestone).

Why not after the upgrade: the coffee leg would then have to be a third pick (Daikichi in Maps → café in Lodestone →
Daikichi again) or start the trip with no destination of its own; and the upgrade timing would be the same anyway.
Coffee-first gives exactly two picks: **café (Maps, tutorial)** → **Daikichi (Lodestone, short hint)**.

## Planned script (texts in `script.js`)

| when | what |
|---|---|
| (v3) | look → walk → Q → "Landed??" + chips → reply → *"Meet me at Tempura Daikichi. Namba Parks, 6F! I'm already in the queue 🍤"* |
| right after | Aya: *"oh!! can you bring me an iced latte from {Café Mitsubachi}? Namba CITY 1F, it's on your way 🙏 the queue here is forever"* → `phone.suggest('city_1e12')`; quest "Iced latte for Aya" |
| tutorial step **pick** (replaces v3 "open Maps") | hint: phone down *"{Q} then open Maps"* · up, other app *"Open Maps — Tab…"* · up in Maps/Lodestone *"Pick where to go — Aya's pick ☕ is at the top"*. Validated by `nav:destination` (any pick). Fallback without the contract: Maps opened (v3 rule). |
| picked something else (once) | Aya: *"ooh, {name} first? 😂 I'll wait…"* (Daikichi picked directly: *"straight to the tempura? respect 😂 …my latte though 🥲"*). The suggestion stays highlighted. |
| (v3, unchanged) | "Where are you??" / "I'm lost 😭" → Lodestone offer → install → *"see? 😌 6F, I'm 3rd in line"* |
| at the café (nav:arrived or ≤ 12 m from its door on 1F, no coffee yet) | late hint: *"Walk up to the counter, {E} to order"* |
| `demo:order` at a café | the errand café: *"One iced latte, please. To go!"*; Aya: *"omg you're an angel 😭☕ ok NOW come: Daikichi, Parks 6F"* → `phone.suggest('parks_6Fdw03')`. Another café: *"that's not Mitsubachi… but I'll allow it 😌 now come — Parks 6F"* |
| second leg, short hint (late step **pick2**) | *"Next stop — pick <b>Tempura Daikichi</b>"* (phone up) / *"{Q} — pick your next stop"*; validated by `nav:destination` (any) |
| walked well past the café without coffee (once) | Aya: *"no latte? 🥲 fine. FINE. the tempura is worth it"* → `suggest('parks_6Fdw03')` + pick2 hint. Never blocks. |
| arrival with coffee | *"THERE you are 🥹 and you brought my latte?? best friend ever. I saved us the two seats at the counter"* + Aya's caption *"ありがとう〜！ Thank youuu!"*, cup icon handed over |
| arrival without | v3 text + tease *"…wait. where's my latte 😑 kidding. (not kidding)"* |

## End card

Before/after are positioning phases (generic Maps vs Lodestone), not legs, so two legs don't break them: time/metres
include the café detour in whichever phase it happened; "Net progress toward Daikichi" stays (the detour is +34 m and
it's only shown when Lodestone is clearly faster). The whole-trip line gains *"· 1 iced latte delivered ☕"* when
delivered. Phone stats freeze on `demo:arrive` (Daikichi), not on `nav:arrived` at the café — **Phone agent: please keep
`stats()` running across `nav:arrived` of the first leg.**

## Contract use (Phone → Story)

`ctx.phone.suggest(slot)`, `ctx.phone.destination`, `'nav:destination' {slotId,name,app,suggested}`, `'nav:arrived'
{slotId}` — all feature-detected; without them the v3 behaviour (open Maps) validates the step and the coffee leg still
works through `demo:order` + proximity.

## Files touched

| File | What |
|---|---|
| `js/game/script.js` | `QUESTS.coffee`, `DEMO.coffeeSlot = 'city_1e12'`, `AYA.coffee/otherPick/skipCoffeePick/gotCoffee/gotOtherCoffee/noCoffee`, `ERRAND_DRINK`, `UPGRADE.readyCoffee`, `TUTORIAL.pick/pickDown/pick2/pick2Down/pick2Route/order`, `ARRIVAL.textCoffee/thanks/tease`. v3 texts unchanged. |
| `js/game/story.js` | v3 "maps" step → **pick** (validated by `nav:destination`, any pick; v3 fallback without the contract); the errand (`errand.state none→asked→done/skipped`), `_onPick` (one light reaction), `_onOrder`, `_leg2Start` (suggest Daikichi + late **pick2** hint), late **order** hint at the café, `_checkSkip` (one tease), `errandDrink()`, `readyText()` |
| `js/game/order.js` | at the errand café the prompt is *"Order Aya's iced latte 🥤"* and the line *"One iced latte, please. To go!"*; `demo:order` carries `errand` |
| `js/game/demo.js` | Lodestone's first line via `story.readyText()`; arrival payoff (with coffee: `textCoffee` + Aya's *"ありがとう〜！ Thank youuu! 🥤"* caption + the cup leaves the HUD; asked but no coffee: the tease); `summary().errand` |
| `js/game/endcard.js` | whole-trip line gains *"· 1 iced latte delivered"* |
| `js/game/game.js` | pause "Today" lists the coffee errand once asked |
| hud.js / game.css / index.html | no change needed (the tip anchors `phone`, `phoneup`, `prompt`, `center` already cover it) |

## Edge cases (all non-blocking)

* **Other pick** (anything but Aya's pick, e.g. Wakakusa or ramen): Aya once: *"ooh, Wakakusa Coffee Stand first? 😂 I'll wait…"*;
  the café stays suggested. Picking Daikichi on leg 1: *"straight to the tempura? respect 😂 …my latte though 🥲"*.
* **Coffee from another café** counts (Aya: *"that's not Café Mitsubachi… but I'll allow it 😌"*) and gets the arrival payoff.
* **Walking on without it**: once the nav distance to Daikichi is 40 m shorter than the café's own (≈ the Parks bridge) she
  texts *"no latte? 🥲 fine. FINE…"* (skipped if she already teased the Daikichi pick), suggests Daikichi, pick2 hint.
  A coffee bought later still gets *"wait is that a coffee?? for ME?? 🥹"* and the payoff.
* **Arriving at Daikichi** works whatever the destination (unchanged `demo.arrive`), with the coffee payoff or the tease.
* **pick2 while still routing elsewhere** (not arrived): hint *"end this route (×) and pick Aya's place"* — see "unsure".

## Results

**Full walk bot** (`scratchpad/critic-demo/walk.mjs`, `?quality=low&noaudio`, crowd on, machine heavily loaded):
look/move → "Landed??" 12 s → reply → "Meet me…" 18.9 s → coffee ask 22.4 s → **pick 1 with key 1 in Maps: Café
Mitsubachi (suggested)** 24.9 s → "Where are you??" 102.7 s → "I'm lost 😭" → offer 108.6 s → **Lodestone ready 117 s**
(same as v3) → *"see? 😌 it even knows which floor my latte is on"* → Lodestone (keeping the café) down the CITY 2F mall,
U-turn into the down escalator, `nav:arrived city_1e12` 257.6 s → E at the counter → `demo:order` iced latte 270.9 s →
*"omg you're an angel…"* → **pick 2 in Lodestone (key 1): Tempura Daikichi (suggested)** 277.9 s → up escalator → canyon →
2F→6F → arrive 424 s → end card *"Position error ±7 m vs ±0.5 m · Wrong-floor 39 s vs 0 s · Whole trip: 7:04 min · 567 m
on foot · 1 iced latte delivered"*. `ctx.errors []`, 0 console issues (the 2 listed are the bot's own `dbg` warnings).
Trip +60 s vs v3 (6:04); ~20 s of that is the bot getting stuck at the 1F escalator foot; the real detour is 34 m.
Shots: `notes/v4-shots/story/walk-*.png`.

**Story probe** (`scratchpad/story4/probe.mjs`, nocrowd, teleports): picks row 2 (Wakakusa) → reaction text ✓; café door
→ *"Walk up to the counter — E to order"* ✓; counter prompt *"Order Aya's iced latte 🥤"* ✓; E → order → leg 2 → hints
*"Q — pick your next stop"* / *"Next stop: pick Tempura Daikichi…"* ✓; arrival with coffee → `textCoffee` ✓; end card line ✓.
`ctx.errors []`, 0 console issues. Shots: `notes/v4-shots/story/p-*.png`.
