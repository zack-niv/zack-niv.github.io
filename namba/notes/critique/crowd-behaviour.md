# Crowd behaviour — experience critique (critic-exp, round 1)

**Verdict:** the *design* is exactly right: purpose-driven trips, train surges, gate lanes, stand-right/walk-left, queues, tourists slower than salarymen. But in motion the crowd **jams**. Around the player, most people are standing still mid-trip in front of escalator mouths and gate lines, while open concourses a few metres away look deserted.

**Score: 4.5 / 10** for "walking around is itself delightful" (crowds are "essential", per the vision).

How this was reviewed: (1) in-browser screenshots at 08:30 / 12:15 / 18:00 at the Midosuji gates, NAMBAWALK, the Nankai concourse, the Nankai and Midosuji platforms (`scratchpad/critic-exp/shots/d_*.png`). (2) A Node lab on the real `CrowdSim` + `Behave` (quality crowdMax 1500, same world/nav), viewer placed at each location, 40–60 s settle at 30 Hz, then sampled (`critic-exp/crowdlab.mjs`; logs `crowd_0830.log`, `crowd_1215_1800.log`). (3) A **displacement test**: who moved more than 2 m in the next 10 s (`crowdlab2.mjs`). Node runs have no transit system, so the director's fallback timetable drives the trains; surges still happen (`trains` 6–34, `surge` 200–970).

---

## Top 10 issues (ranked by impact on the player's feeling)

### 1. Gridlock: most people near the player aren't moving
- **Evidence (displacement test, 10 s, agents within r of the point):**

  | 08:30 | agents | moved > 2 m | standing in a `go` leg, field ready, v = 0 |
  |---|---|---|---|
  | Midosuji platform (B2, r 30) | 237 | **2** | 134 (+ 54 followers, 31 `board/path` at v 0) |
  | Midosuji N gate (B1, r 15) | 109 | **5** | 72 |
  | Namba CITY B1 mall (r 25) | 275 | 55 | 168 |
  | NAMBAWALK (r 25) | 124 | 35 | 62 |

  Instantaneous "fraction moving > 0.3 m/s" across all samples: Midosuji N gate 2 % / 17 % / **0 %** (08:30 / 12:15 / 18:00), Midosuji platform 6 % / 4 % / 9 %, Nankai platform 24 % / 4 % / 15 %, Namba CITY 29 % / 18 % / 13 %. Only NAMBAWALK (47–63 %) and the Nankai concourse at 08:30 (54 %) flow. The browser agrees: `shots/m_esc_up_stand.png` and `m_esc_down.png` show 10–20 people packed at the Namba CITY escalator mouths while the escalator itself is **empty**.
- **Why it matters:** "Crowds… move with purpose: commuters stream…" The single most important crowd quality is *flow*. A frozen crowd reads as a bug or a mannequin display, and it also physically traps the player (movement.md #1–#2).
- **Likely causes and fixes:**
  1. **Escalator mouths are the bottleneck and nobody takes the stairs.** The nav cost makes escalators "cheap" (0.7/m) and stairs expensive (1.6/m) (`nav.js`), and nothing feeds the queue back into route choice. 24–36 agents were "queueing at mouths" in every 08:30 sample. **Fix:** when a lane's queue exceeds about 6, divert new arrivals within 15 m to the adjacent stairs (`esc_m_n`/`esc_m_s` have stairs lanes) with probability ∝ hurry. Also raise standing admission to one per 0.75–0.9 s (real 1 m-step escalators move about 1.5–2 people/s per bank). Lay out the queue *beside* the mouth in a 2-wide column, never across the down-lane exit.
  2. **Gate throughput is a fraction of real.** 20–105 passes per 40 s through a 12-lane line (0.5–2.6 /s); real rush throughput is 6–8 /s. Only 2–15 agents are ever in `gate` mode, while 54–78 wait in `field` mode in front. **Fix:** let agents commit to a lane from 8 m (not 3.6 m), form short per-lane files, and cut `busy` to 0.35–0.6 s per pass. Make `occDir` per lane allow a follow-on in the same direction 0.4 s after the previous person.
  3. **"Density follows the player" relocates hundreds of mid-trip agents next to you** (`director.counts.moved` grew 90 → 1268 within one 08:30 session). They arrive on public nodes near you all heading for the same few exits and escalators, and that creates the jam. **Fix:** relocate only agents whose next 60 m of path is *not* a ramp/gate within 20 m of the drop point, and cap relocations to ≤ 1 per second within 40 m.
  4. Add a "stuck" watchdog: an agent in `go` with v < 0.1 for > 6 s replans (an alternative portal or stairs) or, as a last resort when out of view, fades out.

### 2. Open spaces are empty while choke points are packed
- **Evidence:** 12:15 Midosuji South Gate: 16 agents within 15 m (2.3 per 100 m²), `shots/d_1215_mgateS.png` shows a nearly empty gate line at lunch. The 12:15 Nankai platform has 1.9 per 100 m² with 4 % moving, and `d_1215_nkplat.png` shows two trains with open doors and nobody on the platform. The 18:00 Nankai concourse (`d_1800_nkconc.png`) has about 15 visible people in a 70 m hall at the evening peak. Meanwhile Namba CITY B1 at 08:30 holds 247 people within 25 m (12.6 per 100 m²), *before the shops open at 10:00*.
- **Why it matters:** the feeling of a vast, busy complex comes from *wide shots*: a concourse full of people walking in every direction. Clumps at doors read as glitches, and empty halls read as "game level".
- **Fix:** after fixing #1, re-balance the director: 1) density targets per *zone*, not per distance from the viewer (terminal concourses 6–12 /100 m² at rush, platforms after an arrival 10–20, NAMBAWALK 4–8, malls 3–6 before 10:00 → 6–10 at lunch); 2) trips should prefer *through-flows* across large halls (Nankai 3F concourse ↔ 2F ↔ 1F ↔ CITY) at rush.

### 3. Train surges are too small and don't read as waves
- **Evidence:** `onTrainArrive`: n = `LINE_BASE` (Midosuji 55, Nankai 70) × (0.45 + 0.75·rush) × fill. That's 60–90 people per train at the 08:30 peak, and the cap `count > target × 1.25` blocks alighting when the sim is full (1820 of a 1850 cap at 08:30, so surges get truncated). The start-of-game rapi:t on platform 4 has nobody alighting (`shots/a10_chapter.png`).
- **Why it matters:** "trains → surges" is the most cinematic crowd beat a station has: doors open, a wave pours out, the platform empties toward the escalators, silence, the next train. It also gives the player a free guide ("follow the crowd to the exit").
- **Fix:** exempt surges from the population cap (despawn far tier-2 agents instead). Scale Midosuji surges to 120–200 at rush and 40–80 at midday, and Nankai terminal arrivals to 150–300. Fire `onTrainArrive(initial)` for the player's rapi:t at game start (see game.md #4).

### 4. NPCs say すみません to a standing player every couple of seconds, but don't react physically
- **Evidence:** with the viewer standing still, `crowd:excuse` fired **18 times in 40 s** at the Midosuji N gate (08:30) and 12 at the Midosuji platform: one every 2.2 s, the global cooldown floor. `onPlayerBump` doesn't exist, so bumps (`player:bump`) get no stumble, glance or step-back. Agents also walk straight into a stationary camera (`d_0830_mplat.png`, `d_1215_mplat.png`: a face 0.3 m from the lens).
- **Why it matters:** the sound lead now voices these (good), which makes the spam audible. Real crowds route *around* a standing tourist; they only say sumimasen when they really must squeeze past.
- **Fix:** treat the player as a static obstacle in the anticipatory avoidance (predict ≥ 2 s) and give them +0.4 m personal space. Emit `crowd:excuse` only when the agent's desired path is blocked for > 1.2 s *and* no detour exists. Per-agent cooldown 30 s, global 6 s. Implement `onPlayerBump(agent, speed)`: a 0.25 s stagger, a head turn to the player, then an excuse.

### 5. Escalator etiquette is perfect, which is suspicious
- **Evidence:** across 20 samples (up to 234 riders at once): `standLeft 0`, `walkRight 0`, always. Tourists never walk (`walkLane` excludes `tourist`). The flags are honoured exactly.
- **Why it matters:** this is a small point, but real Osaka has deviations that make the rule *visible*: the tourist with a suitcase standing on the left, someone stopping on the walk lane and the person behind sighing, a group of students all standing. Perfect compliance is invisible compliance.
- **Fix:** 3–5 % of tourists stand left (more with suitcases), and walkers bunch behind them and tut. Occasionally a whole escalator stands both sides during surges (Osaka's 2023 "stand on both sides" campaign makes this current).

### 6. Purposes are right on paper but not legible in motion
- **Evidence:** trip mixes are plausible (08:30 Nankai concourse: transit 32, exit 12, transfer 11, coffee 7). Poses near the player are 85–95 % `walk`, with `phone` 5–15 %, `lookup` ≤ 1, `browse`/`eat`/`talk` ≤ 2. Hesitation exists (`behave.js`, conf < 0.6) but tourists still move at about 1.0–1.15 m/s with no visible stops in the samples.
- **Why it matters:** "Tourists hesitate; locals move confidently… check signs, queue outside popular restaurants, sit and eat." Players read purpose from *pauses and gestures*, not destinations.
- **Fix:** raise hesitation frequency near signs (tourist within 8 m of a sign face → 40 % chance of a 2–5 s `lookup` stop facing it). Add a "consult the map board" behaviour at guide boards (現在地), photo stops at the canyon and the fountain, a "meet" leg that waves at a friend near landmarks (it exists, so raise its weight at 17:30–19:00), and `talk` pairs that walk side by side and slower.

### 7. Shops are dead at 08:30, but the corridors are full of "coffee" trips
- **Evidence:** at 08:30 the NAMBAWALK sample shows 19 `coffee` trips among 62 agents, with shuttered shops in `d_0830_walk.png` (correct: most open at 10:00). The Midosuji platform at 08:30 has 36 `coffee` trips.
- **Fix:** weight `coffee` trips to the businesses open *now* (cafés 07:30, Wakakusa 07:30) and away from areas whose cafés are shut. At 08:30, the passage coffee stands (Wakakusa, link) should have short commuter queues: a gift for the coffee quest ("locals queue before work" is in its blurb).

### 8. Queues outside restaurants exist; make the Daikichi line a landmark
- **Evidence:** `director.counts.queued` reaches 89 at 12:15 (good). The quest's tell, "somewhere people queue for", depends on the *Daikichi* line specifically (`queueLength('parks_6Fdw03')`).
- **Fix:** guarantee 6–14 queuers on stools along the wall at Daikichi from 11:30 to 13:30 (hold the queue legs there), and give them `phone`/`talk` poses. Make it visible from the escalator head on 6F.

### 9. Staff behaviour exists but is invisible
- **Evidence:** there are 44 staff at 08:30 and 118 at 12:15 (`director.counts.staff`). Station staff stand at gate ends and shop staff at entrances bow and call out. In the screenshots I found no visible station staff at the Midosuji gates (`d_*_mgate*.png`).
- **Fix:** place one uniformed attendant in the 有人改札 booth window and one at the gate end facing the flow, with a white-glove "point and call" idle every 20–40 s on the platforms when a train departs (指差喚呼). That is iconic and cheap.

### 10. The crowd doesn't respond to the time of day enough at the extremes
- **Evidence:** target 1480 at 08:30, 1108 at 12:15, 1478 at 18:00. Kinds at 18:00 Nankai platform: shopper 53, tourist 44, commuter 39. That's too many shoppers and too few commuters going home at 18:00.
- **Fix:** at 17:30–19:30, commuters ≥ 50 % around stations, with groups of office workers (3–5, `talk`) heading to izakaya after 18:30. At 12:00–13:00, office-worker lunch waves leave Namba CITY dining and NAMBAWALK in pairs with lanyards.

---

## Keep — this works
- **Purpose-driven trips** with real legs (go / queue / dine / browse / board / meet / patrol) and a director tied to the clock.
- **Tourists vs locals speed split**, measured in motion: tourists 0.94–1.18 m/s, commuters 1.25–1.59 m/s.
- **Escalator lanes**: standers right, walkers left, with admission spacing that creates queues (just too much of it now, see #1).
- **Gate lane policy** (in/out/both), lane choice by load, and fences cut from flow fields, so nobody phases through barriers.
- **4 draw calls for the whole crowd** (instanced LODs + GPU animation). Distance-driven walk phase means no foot skating; stalled people stand rather than moonwalk.
- **Restaurant queues and seated diners** (`queued` 89 / `seated` 122 at 12:15).
- **Looks**: suits with briefcases in the morning, suitcases off the Nankai line, uniforms in groups (`d_0830_nkplat.png` shows a convincing commuter wave at the Nankai platform head).

## Bugs found (with repro)
1. **Gridlock on the Midosuji platform at rush.** Repro (Node): `node --expose-gc critic-exp/crowdlab2.mjs 08:30 1500 mplat` gives "moved > 2 m: 2, still: 235", with 134 in `go/field/ready` at v 0.0.
2. **Midosuji N gate stalls.** Repro: `crowdlab.mjs 18:00` → `mgateN fracMoving 0, meanSpd 0` (90 agents within 15 m).
3. **Surges suppressed when the sim is over target.** `_alight` returns if `S.count > target × 1.25`. At 08:30, count 1820 vs a cap of 1850 (1480 × 1.25). The next 66-person Midosuji surge is cut off after about 30 alighters, exactly at peak.
4. **Excuse spam at a standing player:** 18 `crowd:excuse` per 40 s at the Midosuji N gate (Node viewer standing at B1 −116, −174).
