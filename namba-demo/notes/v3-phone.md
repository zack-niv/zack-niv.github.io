# v3 — Phone (items 2, 10, reply UI for 1) · owner: js/ui/phone.js, js/ui/phone/*, css/phone.css

## Messages contract (Story: use this) — FINAL

```js
ctx.phone.message({ id, from: 'Aya', text, link?, replies?: [{ id, text }], expectReply?: true })
//   = ctx.events.emit('phone:message', sameObject)  (the old event still works and goes through the same path)
//   - `id` dedupes: the same id twice is ignored (ids from game.message() are numbers: fine).
//   - Messages thread gets the bubble; glance strip slides the text in ("Q read", or "Q reply" when it has replies,
//     shown ~10.5 s instead of 7.5 s); unread badge on the dock + home screen; in-phone banner if another app is up.
//   - replies: max 3. Reply chips show under the thread until answered (a newer text WITH replies replaces them;
//     a newer text without replies keeps them). `link: 'lodestone'` = the install card (unchanged).
//   - `expectReply` is accepted and ignored (chips are shown whenever `replies` is non-empty).
ctx.phone.showTyping('Aya', true|false)      // = emit 'phone:typing' {from, on}; either works.
//   Typing bubble (three dots) at the bottom of the thread, header says "typing…", and three small dots on the
//   glance strip. Cleared automatically when a message from that sender lands, or after 12 s (safety).
ctx.phone.reply(i)                           // answer chip i (0-based) programmatically (tests / touch fallbacks)
ctx.phone.pendingReply                       // { msgId, from, replies:[{id,text}] } or null
ctx.phone.messages.clearReplies()            // drop the chips without answering (e.g. Story moved on)
```

Events the phone emits:

| Event | Payload | When |
|---|---|---|
| `phone:reply` | `{ msgId, replyId, text, from }` | player picked a chip (click / key). The player's blue bubble is appended ("Delivered"). |
| `phone:app` | `{ app, prev }` | app changed (`'messages' \| 'maps' \| 'lodestone' \| 'home' \| 'notes' \| 'transit'`). Not emitted for the initial 'maps'. |
| `phone:pose` | `{ pose, prev }` | unchanged (`'up' \| 'glance' \| 'down'`) |
| `phone:stack` | `{ open }` | Lodestone's 3D view opened / closed (V, tap, Done) |
| `nav:track` | `{ state: 'on'\|'drifting'\|'off'\|'rerouted', headingErr, lost }` | Lodestone on-track state changed (see below). `headingErr` deg, + = route is to your right. `lost` = metres of progress lost. |
| `phone:upgrade`, `phone:open`/`close`, `phone:arrive`, `lodestone:arrive` | unchanged | |

`ctx.phone.app` (current app id), `ctx.phone.openApp(id)` (raises the phone on that app), `ctx.phone.open(app?)`,
`ctx.phone.close()`, `ctx.phone.pose`, `setPose()`, `pocket()` — unchanged.

**Answers to notes/v3-story.md:** string ids fine; chips stay until answered or replaced by a newer text with replies;
glance strip shows "Aya · … · **Q reply**" while the text is fresh, then a pulsing Aya avatar with a green ↩ badge
until answered; `ctx.phone.keys = { raise:'Q', lower:'Q', apps:'Tab', reply:['1','2','3'], appSlots:['1','2','3'],
stack:'V', install:'Enter' }`; `offerLodestone({ text, id?, from?, replies? })` accepted (default text otherwise);
`phone:app` is not fired for the initial app — read `ctx.phone.app`.

**The phone no longer offers Lodestone by itself** (the `_play > 150` fallback is gone). `ctx.phone.offerLodestone()`
is unchanged (Aya's link-card text, idempotent, returns false if already offered/installed). Story may also send its own
`message({ ..., link: 'lodestone' })` — same effect. `installLodestone()`, `positioningMode`, `upgradeStage`, `stats()`
unchanged (`stats()` only gains an extra field `lodestoneReroutes`).

## Key bindings (FINAL — Story's tutorial should teach these)

| Input | Phone down (glance) | Phone up |
|---|---|---|
| **Q** (also M; gamepad Y; touch 📱) | raise (opens Messages if a text is unread/new) | lower |
| **Tab** | raise (unchanged) | **cycle apps** Messages → Maps → Lodestone → … (Shift+Tab backwards). *Tab no longer lowers the phone* — Q does. |
| **1 / 2 / 3** (also numpad) | — | on Messages **with reply chips showing**: send reply 1/2/3. Otherwise: jump to dock slot 1 Messages · 2 Maps · 3 Lodestone (after install). A 0.35 s guard after switching app means "1, 1" can't open Messages and reply in one accidental double-tap. |
| click a dock icon / chip | — | switch app / reply |
| hold right mouse | quick look (unchanged) | |
| V | — | Lodestone 3D view (unchanged) |
| E / Enter | — | install Lodestone while offered (unchanged) |

Suggested tutorial copy: "**Q** — phone up · **Tab** — switch apps · **1 2 3** — reply".
Note for Story: `js/game/walkthrough.js` lists `keys: ['KeyQ','Tab','KeyM']` for phone up/down — still true for raising;
lowering is Q (or walking on).

## Dock (item 2)
A frosted dock at the bottom of the raised phone: **Messages · Maps · (Lodestone) · Apps** with a red unread badge on
Messages (a pending reply counts as 1) and a small `Tab` key cap. Lodestone is not on the dock before the upgrade; when
calibration finishes it drops in with an amber glow (the dock hides during install / calibration). "Apps" = home screen
(Notes, Transit, …). The home screen's own old dock is hidden. App content was lifted to clear it (Lodestone trip card,
3D bands, Maps sheet, Messages input, Transit/Notes padding).

## Lodestone on-track guidance (item 10) — `js/ui/phone/track.js`
- **Arrow**: the instruction arrow (phone + glance strip) rotates every frame by the heading error to a point ~6 m
  further along the route — it literally points where to walk. Shown for long walks (as before) and always while
  drifting / off.
- **States** (hysteresis; checks pause while riding an escalator, near the door (< 10 m), and when pocketed):
  - `on` — calm **blue** tile, normal step.
  - `drifting` — moving with heading > 60° off for > 1.1 s (105° right before a turn / escalator), or > 5 m of route
    progress lost. **Amber** pulsing tile, amber ring on the glance strip, sign: "Turn around" (≥ 135°), "Turn left /
    right", or "Back to the route". Back to `on` after 0.7 s facing within 40°.
  - `off` — > 12 m of progress lost for 0.5 s (walking the wrong way, wandering into a side hall, getting off the wrong
    escalator = wrong floor). **Vibration**: the device rattles, the glance card shakes + flashes orange, a soft
    two-pulse buzz (own tiny WebAudio voice on the `ui` bus; `navigator.vibrate` on touch). Max once per 20 s.
    "Rerouting…" 1.1 s → fresh route.
  - `rerouted` — "Rerouted · New route · N min" (blue check) for 2.6 s, then `on`. No new `off` for 8 s.
- "Progress lost" = route length now − the best it has been. I deliberately did not use "distance to the drawn line":
  the route is recomputed from the player's position every ~0.5 s, and in wide halls players walk metres beside the
  line without being lost.

## Status
(see bottom: testing / unsure)
