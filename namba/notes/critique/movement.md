# Movement & feel — experience critique (critic-exp, round 1)

**Verdict:** on an empty floor the locomotion is genuinely good, the best-engineered part of the game: weighty starts, tread-locked stair steps and a continuous escalator comb plate. But Namba isn't an empty floor. The moment people are around, you get shoved metres off line, can't board escalators, get pinned at their feet, and the phone silently halves your speed.

**Score: 6 / 10** for "walking around is itself delightful".

How this was reviewed: a headless harness (`scratchpad/critic-exp/pilot.js` `C.straight`) steps the real game systems at a fixed dt (1/60) with scripted input and records body/camera/speed/gait/ramp per frame (`out/mv_*.json`, analysis in `anmove.py`). The routes were: CITY B1 flat (0, 0 → south), `esc_city_a` up/down, `stair_city_n` up/down/jog, `esc_nk_3` down, a 90°/s arc, and head-on into the `link_west` wall. I also have full traces of a 300 m bot walk from platform 4 (`out/c_trace.json`).

Caveat on run 1: the phone had been left open, so flat speeds were capped at the 0.85 m/s phone glance and jog was disabled. Run 2 (`b06`, phone closed, plus no-crowd control runs) re-measures flat walk/jog. **The escalator, stairs and crowd findings below don't depend on the phone.**

---

## Top 10 issues (ranked by impact on the player's feeling)

### 1. The crowd shoves the player metres off line and the player can't push back
- **Evidence:** `mv_stairs_up` started at B1 (8, −56) facing +X, holding W toward the `stair_city_n` flight (z −58..−54). Within ~9 s the player was displaced to z = −58.29, *outside the 4 m flight*, and then walked 14 m east **alongside** the stairs on B1 without ever climbing (y stays −7.00 for 30 s, `steps 34`, no `stairs_up` gait). `mv_esc_up_stand`: 45 s of holding W at the `esc_city_a` up lane (B1 −3, 49). The player was pushed sideways to x = −2.03 (the lane is −3.5..−2.5), speed spiked to **2.71 m/s** while standing in a crowd, and they **never boarded** (0 frames on the ramp).
- **Why it matters:** this is the opposite of "the crowd sometimes guides you, sometimes blocks a sign". Here it takes the controls away. In Hitman or AC Unity, crowds part, bunch and resist, but your intent always wins at walking pace. Being carried 2 m sideways by invisible forces reads as a physics bug.
- **Fix (`player.js _crowd`):**
  1. Clamp the *lateral* (perpendicular-to-intent) part of the crowd push to ≤ 0.15 m/s, and the per-frame positional correction to the overlap only (it's already ≤ 0.08 m/frame, but that's 4.8 m/s at 60 fps, so lower it to 0.6 m/s × dt).
  2. When the player holds forward into a dense cluster for > 0.8 s, *yield the agents*: ask the crowd to sidestep (`crowd.requestPass(body, dir)`, crowd lead) instead of pushing the player.
  3. Never let the push move the body across a ramp boundary that the intent doesn't cross.

### 2. Escalator mouths become dead zones: you can't board, and at the foot you're pinned
- **Evidence:** besides #1, `mv_esc_down` (1F −1, 74 → the `esc_city_a` down lane): a clean ride (0.50 m/s belt, y 0 → −7 in 26 s, camera vy ≤ 0.32 m/s). Then at the B1 foot the player sits at z = 54.24 **still on the ramp (`ramp 10`, `riding=1`) for 6+ s** while holding W, speed 0.00–0.04. `shots/m_esc_down.png` shows why: a wall of NPCs facing the camera at < 0.5 m, queuing for the *up* lane next door. In the bot walk, the 2F foot of `esc_nk_4_0` re-captured the player **127 times in 5 game-minutes** (`player:ramp` enter → `player:land` → enter …). Every capture fires a head kick (−0.05) and a land kick (−0.09) and a comb-plate footstep.
- **Why it matters:** escalators are Namba's signature transitions (B2 → B1 → 1F → 2F → 3F…). The ride itself is good. Getting on and off must be equally effortless and readable.
- **Fix:**
  1. Stand-latch exit: when the conveyor would carry you off but you're blocked, release the latch and let W walk you off sideways (`_standLatch=false` if `b.ramp` is unchanged for > 1 s at s < 0.05 or > 0.95).
  2. Re-capture hysteresis: after a `player:land`, ignore re-entry into the *same* ramp for 0.6 s unless the intent points into the ramp within 35°. Suppress head kicks and land events on re-entries within 1 s.
  3. Crowd lead: keep a 2.5 m clear apron in front of every escalator mouth (no `queue`/`wait` legs there) and route the up-lane queue *beside* the mouth, not across the down-lane exit (see crowd-behaviour.md).

### 3. Opening the phone silently halves your speed and disables jog
- **Evidence:** `MOVE.phone = 0.85` and `jog = … && !this.phoneOpen` (`player.js`). In run 1 the phone stayed up, and every flat measurement read **0.85 m/s max, gait 'slow'**, including the "jog" run (`mv_flat_jog`: max 0.85). The bot covered the 90 m from platform 4 to the gates in 13 game-minutes.
- **Why it matters:** the phone is the main navigation tool, so people will walk with it up for long stretches. A 43 % penalty with no feedback reads as "the game is sluggish", not "I'm a tourist glued to my screen".
- **Fix:** phone-up walk 1.15 m/s (people do slow down, but only 20–25 %), and allow a phone-up hurry at 2.0 m/s with stronger bob and phone sway. Show the glance diegetically: the camera pitches −8° (it already does) and the phone hint icon shows a "walking" glyph while held.

### 4. Escalator rides are long, and the stand/walk control is invisible
- **Evidence:** ride times of 26 s (`esc_city_a` 7 m rise) and about 28 s (`esc_nk_3`, 6 m) at 0.5 m/s. That's realistic, but the Daikichi → Midosuji platform route has **7 level changes** (6F … B2), about 3 minutes of standing if every one is an escalator. Walking on the left needs "release W, press again" or Shift (`_latchNeedsRelease`). Nothing teaches that, and a player who holds W from the floor just stands.
- **Why it matters:** riding is a lovely moment once or twice (the view opens up, people pass on the left), and tedium by the fifth. The Osaka "walk on the left" etiquette is also a gameplay *choice* the game hides.
- **Fix:** keep the latch, but (a) any *fresh* forward press, or holding W for > 1.2 s after boarding, steps you into the left lane and walks at 0.55 relative, and (b) the first time you ride, an Aya text: "Osaka stands on the RIGHT 👉 walk on the left if you're in a hurry". Consider belt 0.6 m/s on the Parks cascade (malls run faster than stations).

### 5. Head motion on stairs is good, but the landing at the top/bottom is a single hard dip
- **Evidence:** `mv_stairs_down` (with the phone up, 0.49 m/s horizontal): eye height relative to body ranges 1.573–1.721 m (stepped plateaus, one riser per strike), camera vy ≤ 1.08 m/s, 35 strikes over 15.9 s on the flight. `mv_stairs_up_jog`: eye up to 1.779 m (+0.18 m transient lead), max accel 23 m/s². On exit, `player:land` kicks −0.07 (up) / −0.10 (down) m/s.
- **Why it matters:** the tread-locked plateaus are AAA-grade (Alyx-like grounding). The +0.18 m eye overshoot when jogging up reads as a hop, though, and the land kick on top of the last tread's lift gives a double bump.
- **Fix:** cap the stair spring overshoot to 4 cm (critically damp the support spring when jogging) and skip the `player:land` kick when the last tread strike was < 0.25 s earlier.

### 6. Momentum turning is good, but there's no "look-at" assist for signs while walking
- **Evidence:** `mv_turn` (90°/s arc): speed holds, roll ±0.14°, and no oscillation. Wayfinding, though, is constant upward glancing at signs hung at ≈ 2.4–2.8 m (signage `yc`). Pitch is raw mouse only.
- **Why it matters:** reading signs is the core verb. In Firewatch or Edith Finch, pausing to read is effortless because the camera leans in.
- **Fix:** while walking and looking ±10° near a sign face within 12 m, apply a gentle 0.3 aim-friction on yaw/pitch (mouse only, off for reduce-motion). When you stop under a sign, a slight automatic +6° pitch "look up" after 0.6 s of standing (people tilt their heads at signs).

### 7. Crowd bumps give a jolt but no consequence or recovery animation
- **Evidence:** `player:bump` fires and the head kicks (−0.06 m/s, ±0.25 lateral, roll). `crowd.onPlayerBump` doesn't exist (`grep` in `js/npc`), so NPCs never stumble, turn or step back. The sound plays a rustle (`audio._bump`).
- **Why it matters:** a bump with no reaction from the other body feels like hitting a pillar.
- **Fix:** movement emits the event (done). Ask crowd to implement `onPlayerBump(agent, speed)`: a 0.3 s stagger + look-at + an excuse bark (sound now voices `crowd:excuse`). On the player side, add a 120 ms shoulder-roll in the bump direction (±0.6° roll), not just a lateral kick.

### 8. No crouch or "lean to read", and no way to stop at a precise spot in a queue
- **Evidence:** input binds WASD / Shift / C(browse) / E / Q / Esc. Queues, ticket machines and shop counters need fine positioning, and the browse walk is 0.8 m/s with a 0.6 s brake.
- **Why it matters:** this is minor, but standing politely in line is a real Osaka behaviour the game wants you to perform (Daikichi).
- **Fix:** hold C = "shuffle" 0.35 m/s with a 0.15 s brake. Use it to approach counters and queue ends.

### 9. Walking into a wall head-on: a good soft stop, with no material feedback
- **Evidence:** `mv_wall` (link_west, west into the wall): eases to a stop, no jolt beyond the 0.06 kick, and a `player:bump {kind:'wall'}`.
- **Why it matters:** fine as is. A soft hand-on-wall sound (`fs:soft`) exists in audio.
- **Fix:** none needed. Keep it.

### 10. The touch/gamepad paths are unverified in play
- **Evidence:** code review only (`input.js`): a 0.16 deadzone with a radial rescale, a 1.8-exponent look curve and a 2.8 rad/s max for the pad; touch stick jog past 1.45 R.
- **Why it matters:** `quality=low` must run on phones (DEVNOTES).
- **Fix:** add a gamepad "aim friction" equivalent of #6. The pad look speed of 2.8 rad/s is slow for 180° turns in corridors (1.1 s); add a 2× ramp after 0.4 s at full tilt.

---

## Keep — this works
- **The second-order velocity model** (spring + accel + jerk limits): weight without ice, and wall slides at v·cos θ.
- **Tread-quantised stairs** with a per-strike head lift, identical at 20/60 fps, two-at-a-time when jogging up.
- **Escalator comb-plate velocity continuity** (`_resetMotion`, the conveyor add/subtract on ramp change). The ride is smooth: camera vy is constant at 0.29–0.32 m/s on the incline in both `esc_down` and `esc_nk_down`, eye height steady 1.589–1.599 m.
- **Stand right / walk left lane-keeping on escalators**: Osaka-correct.
- **Head-cam**: step-locked bob, ±0.12–0.2° roll, a closing step when you stop, reduce-motion support.
- **Raw pointer lock with spike filtering**, and no Ctrl binding (Ctrl+W).

## Bugs found (with repro)
1. **Can't board the Namba CITY B1 up escalator at midday.** Repro: `?time=11:37`, teleport B1 (−3, 49) facing south (yaw 180°), hold W for 45 s. The player is jostled at the mouth and never enters `esc_city_a_0` (`mv_esc_up_stand.json`).
2. **Pinned at the foot of the down escalator.** Repro: 1F (−1, 74) facing north, hold W. Ride down, then stay on the ramp at B1 z ≈ 54.2 with `riding=true` for 6+ s (`mv_esc_down.json`, `shots/m_esc_down.png`).
3. **Escalator re-capture loop at a down-escalator foot.** Repro: ride `esc_nk_4_0` down to 2F (6.8, −67), then turn round toward the north while creeping forward. You alternate `player:ramp` enter/`player:land` many times per second (127 events in 5 game-minutes), each with a head kick and a footstep.
4. **Crowd pushes the player across a stair boundary.** Repro: B1 (8, −56), yaw −90°, hold W at 11:40. You end up at z −58.3 beside the flight instead of on it (`mv_stairs_up.json`).
