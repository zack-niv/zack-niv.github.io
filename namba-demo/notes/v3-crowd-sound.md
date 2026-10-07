# v3 Crowd + Sound (items 4, 3, 9, caption channels)

Owner files touched: `js/npc/render.js`, `js/npc/render_v1.js`, `js/npc/sim.js`, `js/npc/behave.js`,
`js/audio/announcer.js`, `js/audio/audio.js`, `js/audio/foley.js`. New tools: `tools/headtest.mjs`, `tools/escshot.mjs`.
(`js/player/*` needed no change: footstep loudness lives in audio.)

## Item 4 - "heads spin like crazy": root cause and fix

**Root cause (js/npc/render.js `_near`, old `_turn`).** Near people are `SkinnedMesh` + `AnimationMixer`. The head look was applied
*in place* after `mixer.update(0)`: `Neck/Head.quaternion.premultiply(turn)`. `PropertyMixer.apply()` in three.js only writes a
bone when the clip's accumulated value for it **changed since the previous update** (`if (buffer[i] !== buffer[i + stride]) setValue`).
Whenever the animated Neck/Head value does not change between two consecutive frames, the mixer leaves the bone alone, so last
frame's turn is still on it and the next turn is composed on top: the yaw **integrates every frame** (up to ~0.6 x lookYaw per frame,
i.e. tens of rad/s) until the clip value changes again. Triggers found:
* the clip time does not advance: `renderer.update(0)` while the game is paused (pause menu), or a frame with dt = 0 (`main.js`
  clamps `(now-last)/1000` to [0, 0.05], duplicate rAF timestamps give 0);
* clips whose Neck/Head track is flat for part of the loop: the baked `interact` clip (counter staff serving the player, who
  `lookAt` the player at the same moment) has **58 %** bit-identical consecutive head frames at 30 fps (`flatFrameShare` in the
  test output); every other clip is animated each frame.
Secondary issues in the old code: no clamp (lookYaw could be up to +-1.2 rad plus whatever behave set), the yaw was relative to
the body yaw *at the time of `lookAt`* (stale while the body turns), `wrap()` could loop forever on +-Infinity, the world-space
turn went through `getWorldQuaternion` decomposition under a non-uniform root scale (slight shear).

**Replay of the old behaviour** (`tools/headtest.mjs` "MECHANISM": same code with the clean-pose restore disabled, held look target
of 34 deg, then 1 s of paused frames `lateUpdate(0)`): head yaw vs body after the paused second, per person:
old behaviour `-17, +117, -8, -126, -129, +113, -127, -129 deg` (spinning), fixed `29.2, 30.7, 29.8, 28.6, 29.0, 30.6 deg` (unchanged
from before the pause).

**Fix (render.js).**
* `_anim`: the look target is `lookYaw` (or, right after `sim.lookAt`, the *world bearing* minus the current body yaw so the head
  keeps looking at the spot while the body turns), wrapped to [-pi, pi], **clamped to +-70 deg yaw / +-25 deg pitch**, NaN/Inf safe, then
  eased (exp, k=5/s) with a **rate limit of 180 deg/s** (dt capped at 0.1 s). State is `a.pHY` / `a.pHP`.
* `_near`: before `mixer.update(0)` the Neck/Head quaternions are put back to the **clean animated pose saved last frame**
  (`s.nClean/hClean`), then the mixer runs, the clean pose is saved again, and the turn is applied on top of the clean pose each
  frame. Nothing accumulates, whatever the mixer decides to write.
* `_look3`: the rotation is built from local quaternions only (parent chain up to the person root, axes = root up / -right), so root
  scale cannot shear it; neck takes 40 %, head 60 %; pitch is supported (model faces +Z: about -X tips the face up).
* `sim.js`: `lookAt` also stores `lookAbs/lookRel`; `reset` clears look state; `wrap()` guards non-finite input.
* `render_v1.js` (fallback `?v1crowd`): head yaw clamped to +-70 deg.
* Far LOD: baked GPU-skinned instances have **no** head turn at all (the head is part of the baked clip), so they cannot spin; the
  baked clips themselves are fine (no flips). The near->far hand-over loses the look-turn (<= 70 deg) over the 0.3 s cross-fade; not visible.

**Proof (`node tools/headtest.mjs --secs 15 --spawns ...`).** Steps the crowd at 30 Hz for N s of sim time at several spots, and for
every near person and frame measures the head bone's world yaw relative to the body, with the bones as rendered and with Neck/Head
put back to the clean pose (difference = applied look). Three runs per spot: natural play; `stress 1` = extreme yaw targets injected
into near agents every 0.67 s (+-3.1, +-6.5, -9 rad, targets behind the body); `stress 2` = same plus pitch targets +-0.9 / 3 rad.
Frames in which the engine rendered between two steps (bigger dt) are not compared. Results (SwiftShader, quality high):

| spot / run | people | samples | applied yaw (bones) max | yaw step max per frame @30 Hz | pitch max |
|---|---|---|---|---|---|
| start, natural | 10 | 2792 | 69.2 deg | 6.03 deg (181 deg/s) | - |
| start, stress 1 | 12 | 2749 | 70.0 deg | 6.51 deg | - |
| start, stress 2 | 16 | 4024 | 70.0 deg (state) | 6.0 deg (state) | 24.1 deg |
| nankai gate, natural | 17 | 3685 | 0 | 0 | - |
| nankai gate, stress 1 | 10 | 2675 | 66.7 deg | 6.27 deg | - |
| nankai gate, stress 2 | 5 | 1672 | 69.4 deg (state) | 6.0 deg (state) | 24.1 deg |

State-level (`a.pHY`) over all runs: max |yaw| 70.0 deg, max step 6.0 deg/frame = 180 deg/s, max |pitch| 25 deg, 0 NaN. Bone-level
numbers are a hair above because the clip's own head motion adds to the measurement. See the end of this file for the second batch
(Namba CITY 2F with queues and seated people, NAMBAWALK) and the earlier run on the old code: natural play on the old code reached a
head yaw of **179.6 deg vs the body** in Namba CITY 2F (queueing people) and 34.5 deg / 10.9 deg-per-frame spikes at Nankai 2F; with
extreme targets it spun at up to **5400 deg/s** (all 3 numbers from the first run of `headtest.mjs`, before the fix).
The headtest's total head-vs-body yaw in natural play still shows occasional 13-25 deg/frame steps: those are the clean animation
(clip changes / cross-fades), not the look turn (applied step <= 6 deg).
Escalator riders and queueing people are in the sample (`onRamp`, `queueing` columns in the raw output); seated people carry a
baseline ~28 deg head offset from the `sit` clip itself (not from the look).

## Item 3 - Japanese only

`js/audio/announcer.js`: only `lang:'ja'` parts are ever spoken, with a ja-JP voice (`u.lang = 'ja-JP'`). The English voice search is
gone, `canSpeak` needs a ja voice, `_speakable()` returns null for `en`. No ja-JP voice (or `settings.speech` off): **chime only**, the caption
still shows the English text. `parts` keep their `en` entry purely as caption text. `stats()/debug()` report no English voice.
Test (`tools/escshot.mjs`, stubbed `speechSynthesis` with a ja and an en voice; then en-only; then none): see the results below.

## Item 9 - footsteps

* `audio.js _step`: base gain 0.8 -> **0.45 on hard floors (tile/stone/metal/wood, -5 dB) and 0.38 elsewhere (-6.5 dB)**; the squeak
  and the landing step are -6 dB too. Surface character (recipes per surface, shoe, squeak on polished floors) is unchanged.
* `foley.js footstep` (sneaker): 2.5 ms raised-cosine onset (time to half-peak 0.09-0.2 ms -> 1.3-1.7 ms, measured offline), 6.2 kHz
  low-pass to shave the top. The 1.5-4 kHz click body stays, RMS after normalisation unchanged, so tile / stone / metal remain clearly audible.

## Caption channels

Pass `channel` wherever this area raises captions (HUD reads it via `captionChannel`):
* announcer PA / escalator safety lines / background shop voices -> `'ambient'` (`announcer.js` caption event; `item.channel` overrides);
* `crowd:excuse` caption (すみません to the player, audio.js) -> `'speech'`; announcer items of kind `crowd` -> `'speech'`;
* `crowd:callout` (shop staff, behave.js): `'speech'` when the staff member is within 3 m of the player (a greeting aimed at you), else `'ambient'`.

## Escalator stand side (Osaka: stand right, `ESC_STAND_SIDE = +1`)

Code check: lane offset `u = (+0.24 stander, -0.24 walker) * ESC_STAND_SIDE`, `+u` = right of travel (right vector `(-tz, tx)` verified
for travel -Z -> +X); the standing arm in the `ride` clip is `R` for `+1`. Screenshot result below (`notes/v3-shots/crowd/`).

## Unsure about

* The 13-25 deg/frame head steps that remain in natural play come from clip changes / cross-fades in the clean animation; I did not
  find which clip pair; they are not look-turn.
* Real-browser verification of ja-JP speech was impossible (headless has no voices); tested with a stub only.
* Footstep level is a judgement (-5 / -6.5 dB); `0.45 / 0.38` in `audio.js _step` are the two knobs.
