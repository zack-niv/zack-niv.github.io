# v4 — Story (item 4 + the tutorial side of 6) · owner: js/game/*, js/ui/hud.js, css/game.css, index.html

Status: **PLAN (early draft for the Phone agent)**; results below get filled in as they land.

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
