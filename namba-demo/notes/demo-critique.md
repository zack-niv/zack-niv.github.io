# Demo critique — final critic (ship day)

Status: IN PROGRESS (written incrementally). Evidence: scratchpad `critic-demo/` (walk.mjs, walk.out, shots/).

## Static review findings (before play-test)
- `game/script.js` `ENDCARD.contact = 'contact: zack@…'` is still the placeholder. Shown on the end card to Oriient.
- No Open Graph / Twitter card meta in `index.html` (no og:image/og:title). The link will be pasted into an email/Slack to Oriient and unfurl as a bare URL.
- Lodestone's full route from `start` (offline `critic-demo/tbt.mjs`, guidance.compute): 520 m, ETA 6.4 min, 5 steps only:
  `123 m Escalator down 3F→2F` · `148 m Continue into Namba CITY 2F` · `399 m Cross the bridge` · `430 m Escalators up 2F→6F · 4 flights` · `520 m Arrive, on your right`.
  There is a ~250 m stretch (Namba CITY 2F) with no maneuver at all; correct but the turn-by-turn feels thin.
- Calibration screen (phone agent shot 03b): the stat strip runs values into the next label: `|B| 43.1 µTANCHORS 1,026FLOORS 7/10` (missing gap between unit and next label).
- Arrival frames from the flow agent's own run (`scratchpad/demo-flow/shots/H-arrive-aya.png`, `I-arrive-counter.png`), to be re-checked in my walk:
  * a SUBWAY PLATFORM PA caption ("The train for Minami-Tatsumi will arrive at track 1 shortly...") plays while you stand on Namba Parks 6F;
  * 4-5 text layers stacked at once: the PA caption, the "なんばパークス" chapter card, Aya's speech caption, the iMessage toast, plus the "Q take out your phone" pill, all during the 7-second emotional payoff;
  * the chef's caption is cut off under the Aya toast (bottom right);
  * the counter shot is blocked by two huge backs of heads in the foreground.
