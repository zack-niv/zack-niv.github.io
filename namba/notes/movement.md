# Movement & feel — log

Owner files: `js/player/*` (player.js, headcam.js, look.js, stairs.js, surface.js),
`js/core/input.js`, `css/input.css` (linked from JS on touch devices).

Goal: walking around is itself delightful — grounded, human, weighty-but-responsive, calm.

## What's built
* **Locomotion** (`player.js`, tuning in exported `MOVE`): second-order velocity model
  (critically-damped spring on velocity + max accel + max jerk) → weight on starts/stops, no
  ice, no instant halts. Walk 1.5 m/s, jog (Shift) 3.2, browse (C toggles / Alt holds) 0.8,
  phone open 0.85. Backwards ×0.68, sideways ×0.86 (ellipse). Turning while walking carries
  85% of the momentum with the view (slight, believable carving); blocked velocity components
  are removed after `world.move`, so wall slides run at v·cos(θ) with no stickiness.
* **Stairs**: flights slow you (×0.47 up, ×0.58 down horizontally ≈ 2.1 steps/s on 0.33 m
  treads). Footsteps land when the leading foot reaches a new tread (two at a time when
  jogging up) and the head's support height jumps to that tread; a fast critically-damped
  spring turns that into a distinct lift (or drop) per step. Landing dip at top/bottom.
* **Escalators**: stepping on latches "stand": your own walking decays to zero relative to the
  belt (total velocity stays continuous across the comb plate), you drift to the RIGHT half and
  ride with a faint hum. Release+press forward (or Shift) to walk up the LEFT lane at ×0.55.
  Belt velocity is transferred into your own momentum when you step off (no jolt).
* **Head/camera** (`headcam.js`): step-locked bob — inverted-pendulum vertical double bounce
  (cusp at heel strike), lateral sway once per stride, ±0.25° roll, a heel-strike weight kick;
  amplitude by speed (≈1 cm browse, 2.3 cm walk, 4.5 cm jog p-p); idle breathing + micro
  drift; strafe lean; jog FOV +3.5°; phone glance (−8° pitch, slower walk); bump jolts. Eye
  sway ≤ 3 cm so the eye stays ≥ 0.25 m from walls (radius 0.28); near plane 0.05.
* **Footsteps**: `player:step` exactly at heel strike; closing step when you stop.
* **Walls & corners**: blocked velocity components are dropped (clean slides, no sticky
  corners). Walking head-on into a wall eases you to a stop over ~0.3–0.5 m (closing speed capped
  by the gap) instead of an instant halt. Short faces you walk straight into — pillars, the 1 m
  steps of rasterised diagonal walls — are stepped around toward their open end, starting
  ~0.4 m out, like people do.
* **Crowd soft collisions**: uses `ctx.crowd.agentsNear(level,x,z,r)` (x, z, vx, vz, y; radius
  defaults to 0.25). Personal space: you ease off before contact, slip past sideways, get nudged
  by people walking into you, tiny head jolt + `player:bump`. Agents > 1 m above/below are ignored.
* **Input** (`input.js`): WASD/arrows, Shift jog, C toggle / Alt hold browse, E/Enter interact,
  Q/Tab/M phone, Esc menu; raw pointer-lock mouse (unadjustedMovement, no accel, spike filter);
  gamepad (standard mapping: LS move, RS look with response curve, L3 jog toggle / RT hold,
  LB browse, A interact, Y phone, Start menu); touch: left virtual stick with visible ring
  (drag past the ring = jog), right-side drag look with optional 35 ms smoothing, E and phone
  buttons. Settings persisted in localStorage `namba.settings.v1` (try/catch).
* Ctrl is deliberately NOT bound: Ctrl+W closes the tab and can't be intercepted.

## APIs (ctx.player) — stable
`body, yaw, pitch, level, zone, space, position, forward, right, frozen, radius, eye (eye height),
vel (THREE.Vector2 own walking velocity; zero it to stop dead — momentum is dropped too),
speed (actual m/s incl. belt), walkSpeed (own m/s), headBob (0..1), gait
('stand'|'slow'|'walk'|'jog'|'ride'|'stairs_up'|'stairs_down'), riding, onStairs, phoneOpen, stepPhase`
* `player.lookRay(out?)` → THREE.Ray from the eye along the view.
* `player.lookPoint` → `{level,x,y,z,dist,kind:'wall'|'floor'|'ceiling'|'none'}` first surface the
  eye ray hits (≤ 8 m, ~20 Hz). `player.lookTarget` (the function below) also carries these
  `level/x/y/z` fields, so game.js's `const lt = player.lookTarget; lt.level…` works as is.
* `player.lookTarget(maxDist = 3, { cone = 12°, filter })` → `{item, dist, angle, x, y, z}|null`:
  best-aligned interactable within the cone with 2-D line of sight. Searches
  `player.interactables` (`.add({id, level, x, y?, z, radius?, lookRadius?, enabled?})` → remove fn),
  sources added by `player.addLookSource(() => iterable)`, and duck-typed
  `ctx.game.interactions.items` / `ctx.game.items` if present.
* `player.kick(dy, lateral, roll, pitch)` → head impulse (m/s, m/s, rad/s, rad/s) for others
  (e.g. a train rumble, a door slam). Keep tiny.
* `input.move/look/lookRad/jog/slow/action(name)/pressed(code)/device/settings/set(k,v)/onSettings(fn)/setScript()`.
  `input.sensitivity` is a getter AND setter (rad/px) — game.js assigns it.
  Settings keys: sensitivity, invertY, headBob, reduceMotion, fov, touchLookSmoothing,
  touchSensitivity, padSensitivity, slowToggle. `prefers-reduced-motion` defaults reduceMotion on.

## Events
* `player:step` `{ foot, surface, speed, gait, intensity 0..1.5, final, level, space, ramp, x, y, z }`
  surface ∈ tile | stone | wood | metal | paving | grass (from `space.surface` if set, else
  `space.style`/garden flag, ramps: escalator→metal, stairs→stone; see `surface.js`).
* `player:land` `{ kind:'stairs'|'escalator', dir:'up'|'down', ramp, level, surface }` stepping off a flight/escalator.
* `player:bump` `{ kind:'person'|'wall', agent?, speed, x, z, level }`.
* `player:ramp` `{ ramp, entering, from }`, `player:level`, `player:zone` (unchanged).
* Listens: `phone:open` / `phone:close`, `player:teleport`.

## Requests to other areas
* **Crowd**: using your `agentsNear` — thanks. Optional: `ctx.crowd.onPlayerBump(agent, speed)`
  (called if present) or listen to `player:bump {kind:'person', agent:{id,…}, speed}` so the agent can
  react (stumble, glance, "sumimasen"). A `radius` field on the views would be used if present.
* **Architecture**: stair treads in `_ramp()` currently use N = max(8, round(len·3)) segments.
  `js/player/stairs.js` mirrors that; if you change the step count, set `ramp.steps = N`
  so feet and visuals agree.
* **Sound**: footsteps from `player:step` (surface/intensity/gait), `player:land`, `player:bump`;
  escalator hum while `ctx.player.riding`.
* **Game**: settings UI could expose `invertY`, `fov`, `reduceMotion` via `ctx.input.set(key, v)`.

## Measurements (headless, fixed dt 1/60, scripted input; see "Iterations")
(see below)

## Iterations
