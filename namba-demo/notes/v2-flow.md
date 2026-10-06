# v2 — Flow + Transit (items 1, 9, 7-order) · owner: js/game/*, js/ui/hud.js, js/ui/title.js, css/game.css, index.html, js/world/transit/*, js/world/transit.js

## Item 1 — solid track bed (no lower floor through the pits)

**Cause.** `transit/env.js` drew the Nankai ballast as a 3.0 m strip centred on the rail line, but each Nankai track rect is
5 m wide (and tracks 2/3, 4/5, 6/7 abut, so the pit between two platforms is 10 m wide). The remaining 2 m per track (4 m
between abutting tracks) had no floor at all, so from the platform you looked straight down onto the 2F shops (the
bookstore). The subway pits had the same hole: a 2.9 m slab in a 6 m rect.

**Fix (all in `js/world/transit/env.js`, no architecture change needed).**
* Nankai: the ballast bed now spans the whole track rect (+0.65 m under the platform lip, +0.1 m into the far wall), same height and
  material as before, so the rails/sleepers look unchanged but there is no gap.
* A dark concrete underside quad (`transit_tunnel_dark`) under the bed for anyone looking up from the level below.
* Subway station sections (Midosuji `m_track1/2`, Sennichimae `s_track1/2`): a full-width dark pit floor under the slab
  (the tunnel tubes already had one).
* Nankai pit back end (z = -62): a concrete end wall from the bed to platform level (inset 0.04 m so it cannot z-fight with
  architecture's wall) and a dark floor under the 0.55 m platform-edge recess that architecture draws there.
* Viaduct (z 110..245) already had a deck over the full width; unchanged.

Before/after: `notes/v2-shots/flow/before|after/`.

## Item 9 — controls & navigation walkthrough

New `js/game/walkthrough.js` (class `Walkthrough`, `game.walkthrough`). Four compact glass cards, top-left of the HUD, styled
like the rest of `css/game.css` (`.g-walk`, `.gw-*`):
1. Look & move: mouse, WASD, hold Shift to hurry. 2. Interact: E (doors, machines, counters, order a coffee). 3. Phone:
**Q** raises / lowers it, or **hold the right mouse button** for a quick look (exactly the bindings in `notes/v2-phone.md`;
the phone also drops itself when you walk on). 4. "Follow the signs — the map lies 🙃".

* Starts when the intro hold ends (~5.2 s, just before Aya's first text) via `demo.begin()`; never freezes the player or the clock.
* A card advances on click, Space / Enter / right arrow, its own key (Shift / E / Q) or after 4 s (progress bar along the
  bottom edge). **X** or the corner button skips all. Clicking straight through is ~3 s, letting it run ~16 s.
* Once per browser session (`sessionStorage 'namba.walkthrough.v2'`, in try/catch): **Replay reloads the page and does not show it again.**
  `?tutorial` forces it, `?notutorial` disables it. In `?test` without `&play` it never runs (HUD is hidden there anyway).
* When the walkthrough runs, the old bottom-centre `hud.hint('keys')` / `hint('phone')` are not shown; when it was seen or is
  off, they behave exactly as in v1.
* Events: `tutorial:start`, `tutorial:done {skipped, card}`.
* `settings.js` CONTROLS (pause menu / title drawer) now lists "Q — phone up / down" and "Right-click — hold for a quick look".
* css: captions and the ICOCA chip lift above the phone's glance strip via `--phone-glance-h` (the request in v2-phone.md).

## Item 7 — order at counters

New `js/game/order.js`; `Interactions` (`js/game/interact.js`) gets two hooks (`counterItem`, `counterCovers`) and scans
`ctx.counters` every frame (cheap: only entries on the player's level within 2.5 m are even considered).

* Reads `ctx.counters = [{slotId,name,kind,level,staff,order,role}]` (see `notes/v2-shops.md`) **lazily and defensively**: if it
  is missing, empty or arrives late nothing breaks, the interaction simply appears when it exists.
* In reach: within **1.7 m** of `order` (xz) and the view within ~72 degrees of the staff spot (so you face the counter).
* Prompt: cafés (`kind:'cafe'`) **"Order a coffee ☕"** (bakery: "Order 🥐", repeat: "Order another ☕"); everything else **"Say hi"**.
  Closed by opening hours: greyed prompt "Closed right now · opens HH:MM".
* The exchange (never a modal, you can keep walking, ~2.5 s, 3.4 s cooldown): caption *いらっしゃいませ! Welcome!* -> *"One latte, please."*
  -> *かしこまりました。* -> toast **"Ordered · ☕ latte — Pine Tree Coffee"**, the cup icon appears bottom-left and stays (tooltip + count badge),
  the ICOCA chip shows the price when the card has enough, the order is listed under "Ordered" in the pause menu, `journal.coffees++`.
  Drink per place: Wakakusa pour-over, Kissa Rondo siphon coffee, Mocca Rest / generic cafés latte, bakery melon pan, stand iced coffee.
* "Say hi" (food / shop / non-Daikichi tempura): greeting, then your own line (a PEEK one-liner for restaurants: "...you promised yourself tempura").
* Emits `demo:order {slotId, name, item, kind, t}` (for "Say hi" the payload has `hi:true, item:null` and is emitted a beat after the greeting).
  Also calls `ctx.crowd.wave(staff.x, staff.z)` if it exists.
* **Tempura Daikichi (`parks_6Fdw03`) is excluded**: the arrival moment / quest logic is untouched.
* The old modal coffee vignette (`vignettes.orderCoffee`, the blocking menu) is kept only as a fallback: it is `superseded` for any
  café that has a counters entry, so you never get two prompts.

## Lead follow-ups (done)
* `hud.paAudible()` defers to `ctx.audio.paVolume(payload) > 0.06` when it exists (falls back to the old distance rule).
* Nankai approach PA now leads with the key info: `まもなく、{no}番線に、{destJa}行き、{typeJa}が、まいります。…` /
  "The {typeEn} bound for {destEn} is arriving at track {no}. …" (metro approach text already led with direction + destination).
* No copy mentions an escalator side.

## Requests / notes for the lead
* none blocking. See "unsure" below.

## Status
* [x] item 1  * [x] item 9  * [x] item 7  * [x] screenshots  * [x] load probe

## Verified (headless, SwiftShader; machine was heavily loaded so frame timings are meaningless)
* `node tools/loadprobe.mjs`: READY 12.4 s, `errs []` (35 s with `&nocrowd` while the box was busy). Console: only the sandbox's
  `net::ERR_CERT_AUTHORITY_INVALID` (Google Fonts), nothing from the game; `ctx.errors` empty in every run.
* Item 1: `notes/v2-shots/flow/before/*` (`?oldpit` reproduces v1: bookstore with shelves visible through the Nankai pit,
  `nk_t4_north`, `nk_t4_down`, `nk_t4_far`) vs `after/*` (solid ballast bed from the platform edge to the far wall, same angles).
  `?oldpit` is a test-only flag in `transit/env.js`. The Midosuji/Sennichimae shots (`mid_t1_far`, `sen_t1`) look at the screen
  doors/trains, so they prove little; there is nothing below B2 there, the pit floor is there for correctness.
* Item 9: `walk/walk1..4.png` show the four cards (Look & move, Interact, Your phone, Follow the signs). Click and X skip were exercised
  (the click path advanced 1->2->3->4); the X path is a keydown handler (verified by dispatching the event; a `page.keyboard.press`
  hung the harness once, unrelated to the game).
* Item 7: at Pine Tree Coffee (`city_2nw16`, `ctx.counters` has 134 entries): standing on the order spot facing the staff gives
  prompt "Order a coffee ☕" (`order/order1_prompt.png`), E gives the toast "Ordered · ☕ latte — Pine Tree Coffee", ICOCA chip -¥580,
  cup icon bottom-left (`order/order2_b.png`), `game.orders` filled, `demo:order {slotId:'city_2nw16'}` emitted, facing away: no prompt.
  The caption lines of the exchange were not caught in a screenshot (they are real-time timed and the headless frames are seconds
  long), the same `hud.caption` API as everywhere else is used.

## What I am unsure about
* The captions of the order exchange (JA greeting, "One latte, please.", "Certainly") were not visually confirmed, see above.
* Walkthrough timing (5.2 s start, 4 s per card) is a guess; a human will tell. It overlaps Aya's first text and the chapter card
  (chapter bottom-left, cards top-left, phone strip bottom-right), no overlap seen in the screenshots.
* The ICOCA chip says "運賃 Fare" for a coffee (existing HUD label).
* "Say hi" for shops/restaurants was only code-reviewed, not exercised in a browser.
* Metro pit floors are not visible in any screenshot (PSD glass/trains); the Nankai fix is the one that matters.
