# v2 — Phone (items 10, 11, 12) · owner: js/ui/phone.js, js/ui/phone/*, css/phone.css

## FINAL KEY BINDINGS (Flow: the controls walkthrough should teach exactly these)

| Input | What it does |
|---|---|
| **Q** (also Tab / M; gamepad **Y**; touch 📱 button) | Raise the phone to full view (the cursor is freed so you can tap / drag on it). Press again to lower it to the glance strip. *(unchanged from v1)* |
| **Hold right mouse button** | Raise the phone for a quick look while held; mouse-look keeps working. Release to lower it. |
| **V** (phone up, Lodestone) | Expand / collapse the 3D floor stack (or click the stack preview). |
| **E / Enter** (phone up, Aya's Lodestone link showing) | Install Lodestone *(unchanged)*. |
| *(automatic)* | While walking, the phone sits **down at the bottom-right edge** as a slim **glance strip** showing the next step (Lodestone) or the vague Maps hint. Raised, it lowers itself when you **run (Shift)** or after **~4 s of walking**. |
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

## Status
- [ ] in progress
