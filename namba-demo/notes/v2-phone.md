# v2 — Phone (items 10, 11, 12) · owner: js/ui/phone.js, js/ui/phone/*, css/phone.css

## FINAL KEY BINDINGS (Flow: the controls walkthrough should teach exactly these)

| Input | What it does |
|---|---|
| **Q** (also Tab / M; gamepad **Y**; touch 📱 button) | Raise the phone to full view (the cursor is freed so you can tap / drag on it). Press again to lower it to the glance strip. *(unchanged from v1)* |
| **Hold right mouse button** | Raise the phone for a quick look while held; mouse-look keeps working. Release to lower it. |
| **V** (phone up, Lodestone) | Expand / collapse the 3D floor stack (or click the stack preview). |
| **E / Enter** (phone up, Aya's Lodestone link showing) | Install Lodestone *(unchanged)*. |
| *(automatic)* | While walking, the phone sits **down at the bottom-right edge** as a slim **glance strip** showing the next step (Lodestone) or the vague Maps hint. Raised, it lowers itself when you **run (Shift)** or after **~3.5 s of walking** (~4.5 s after raising). |
| *(automatic)* | A text from Aya slides into the glance strip and it pulses — **Q to read**. |

Suggested walkthrough card copy: **"Q — phone up / down · or hold right-click for a quick look. It drops back down when you walk on."**

## Events / API (all on `ctx.phone`)
- emits `phone:pose {pose:'up'|'glance'|'down', prev}` on every change.
  - `up` = full view (Q, right-mouse hold, install/calibration, a script `setPose('up')`).
  - `glance` = default during play (strip at the bottom edge).
  - `down` = pocketed: before the game starts, while paused, during the end card, or while forced by `ctx.phone.pocket(true)`.
- `ctx.phone.pose` (read), `ctx.phone.setPose(p)` ('up' | 'glance' | 'down'), `ctx.phone.pocket(bool)` (force down, e.g. cutscenes; `pocket(false)` releases).
- `phone:open` / `phone:close` still fire on up / lower (game.js uses them for `phoneOpen`).
- Everything from v1 is unchanged: `offerLodestone()`, `installLodestone()`, `positioningMode`, `upgradeStage`, `phone:upgrade`, `stats()`, `lodestone:arrive`, `phone:arrive`.
- CSS var `--phone-glance-h` on `<html>`: the glance strip's on-screen height in px (0 when down/up). `#phone-root` gets class `ph-glance` while glancing.

## Requests to Flow (game.css / hud.js — not my files)
- Captions: nothing to do. The existing rule `body:has(.ph-peek:not([hidden])) .h-captions { bottom: max(8.5vh, 168px) }`
  still fires: `.ph-peek` is now an invisible marker that is un-hidden while the glance strip shows (strip ≈ 95–110 px tall),
  so captions sit above it. If you prefer the exact height: `bottom: max(8.5vh, calc(var(--phone-glance-h, 0px) + 20px))`.
- The IC-card toast (`.h-ic-card`, right:28 bottom:28) overlaps the glance strip (bottom-right). Suggest
  `bottom: calc(var(--phone-glance-h, 0px) + 28px)`.
- HUD copy that says "Q opens your phone" / "Q for your phone" is still correct.

## What changed (v2)
**Item 11 — realistic raise / lower** (`js/ui/phone.js`)
- Three poses with a spring-driven hand: `glance` (default while playing: phone held low at the bottom-right, only its top
  shows), `up` (full view), `down` (pocketed: title / intro / pause / end card / `pocket(true)`).
- Raising = spring lift on a small arc → the device tilts toward you a beat later (under-damped: small settle). Lowering is
  the reverse, critically damped. Walking bob is layered on top (bigger when lowered). No CSS transitions on the wrap.
- Up pose now sits just RIGHT of the crosshair (you still see where you walk), not over it.
- Auto-lower: running (Shift + moving) lowers it at once; ~3.5 s of walking with it up lowers it (not during install /
  calibration / the 2.3 s reveal, not while typing, not within 2.5 s of using the mouse on the screen, not while the
  right button holds it up). Re-grabs the pointer lock only with a live user gesture (no console error).
- Right mouse hold (pointer stays locked, mouse-look works; context menu suppressed while playing).
- Glance card (`js/ui/phone/glance.js`): the Dynamic Island expands into a black "live activity" card: the next step
  (Lodestone), the vague crow-flies hint with a jittery arrow and "GPS weak" (Maps), install/calibration progress, or Aya's
  text (slides in, pulses green 4×, "Q read" chip, then a green unread dot stays). The "Q" key cap on the card disappears
  after the phone has been raised 3 times.
- The old bottom-right peek card and "Q Phone" hint are gone (Aya's texts live in the glance card).

**Items 10 / 12 — simpler, more helpful apps**
- Lodestone (`js/ui/phone/lodestone.js`) now leads with ONE instruction card: big amber arrow tile (live-rotating for long
  walks), "In 40 m", and a plain sentence ("Take the escalator up to 2F", "Turn left into Namba CITY", "Tempura Daikichi
  is on your right"). A small "Then …" chip only when the next step follows within 30 m. Bottom card: "You are here ±1 m ·
  [2F] Namba CITY" → "Destination · [6F] Tempura Daikichi · 4 min". No stats row, no metres/ramps counters.
- The 3D exploded stack is a framed preview between the two cards; tap it, the "3D view" button, or **V** to expand: the
  stack takes the screen (floor ladder, Route/Me, re-centre, Done) with the full step list in plain words below.
- Upgrade moment kept, reads faster: install 1.8 s, calibration 3.0 s with ONE status line (Sampling the magnetic field →
  Matching field anchors → Finding your floor → Locked ✓) and the floors locking in (the µT / anchors / floors read-out box
  is gone). Then the snap: one big "You're on 3F · ±1 m" card for 2.3 s, then the guidance slides in.
- Maps (`js/ui/phone/mapapp.js`): cleaner chrome (no category chips, no scale bar, no compass button), bigger route banner,
  and the home sheet leads with "From Aya's message · Tempura Daikichi · Namba Parks · 6F · 280 m [Directions]". The
  frustration is intact: drifting dot, wrong/lagging floor, crow-flies distance, directions stop at the first escalator.
- Lodestone logo SVGs get unique gradient ids (a gradient inside a display:none section stopped painting elsewhere).

## Testing
- Scripts (scratchpad): `ph/after.mjs` (screens + logic checks), `ph/run.mjs` (before, run against a pristine copy).
- Logic check in the page (passes): open→up; walk 1 s→up; walk 5 s→glance; stand→up; run→glance; RMB hold→up,
  walking 6 s while held→up; release→glance; pocket→down; unpocket→glance. JS heap flat (~269 MB) across all phone states.
- `tools/loadprobe.mjs`: READY 28.3 s, no errors.
- Screens: `notes/v2-shots/phone/before_0{1,2,3}_*` (v1, pristine copy) vs `after_*` (1280×720, quality=low, nocrowd).
  `after_10c_*` / `after_11b_*` are re-renders of the captured phone DOM with the FINAL css (dark screen under the
  glance card, trip card lifted 16 px) — those last two CSS tweaks were not captured in a live run.
- The only console error in headless runs is `net::ERR_CERT_AUTHORITY_INVALID` for Google Fonts (sandbox proxy), not the phone.

## Unsure / known issues
- **Headless renderer OOM**: 4 of my runs had the page killed by the machine-wide memory cgroup (renderer anon-rss
  3.5–6.8 GB, while 3–4 other agents' browsers ran). Kills happened at different steps (maps route glance, Lodestone
  ready, teleport to city_2f); JS heap stayed flat and Stack3D disposes its route geometry, so I believe it is the
  environment, but Lodestone's second WebGL context does add GPU/renderer memory. Worth a glance in the critic run.
  No `after_14..17` (city_2f / canyon) shots for that reason.
- Pointer re-lock on auto-lower: only requested while `navigator.userActivation.isActive` (holding W counts). If the
  browser refuses, the player is at glance with a free cursor and clicks to look again (no pause, no console error).
- Right-mouse hold could not be exercised for real headless (no pointer lock); tested through the same entry point.
- The glance card's "Q" key cap hides after 3 raises — Flow's walkthrough should still mention Q.
- Maps glance shows the GPS problem as an amber "!" badge on the blue arrow (text was too long for one glance).
- Only console error seen in headless: `net::ERR_CERT_AUTHORITY_INVALID` (Google Fonts through the sandbox proxy).
