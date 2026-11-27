// =============================================================================
// v22: the mission — two legs, scored in points. Pure data + one pure function (testable in Node: no imports).
//   Scoring (amendment 2): start 10,000, minus 1 point per tenth of a second of mission time over both legs (the lunch beat and pauses
//   do not count), +1,000 counter seats made, +1,500 coffee; train made = the score counts (floor 500), train missed = 0.
//   t1 / t2 = the two legs' durations in whole TENTHS of a second (rounded once, when each leg ends: every consumer uses these integers).
//   leg 1 LUNCH  from Aya's "meet me" text: a seats clock counts down (DEMO.seatsS). Reaching her in time = seats made;
//                late = seats gone, the run continues (no fail state here).
//   leg 2 TRAIN  after the lunch beat: a train clock counts down (DEMO.trainS). Finish = tapping through a Nankai ticket
//                gate. Optional: iced coffees from one café (DEMO.coffeeSlot) for bonus points. Clock at zero = train missed.
// The mission object lives on demo.mission (also game.mission / story.mission — the same object, mutated in place):
//   { leg: 0|1|2|3, seats: {limit, seconds, made, left}, train: {limit, seconds, made, left}, coffee, hints,
//     seconds, t1, t2, liveScore, score, tier, lines }
//   leg 0 = before the meet text, 1 = lunch, 2 = train, 3 = finished. seconds = play seconds of both legs (the lunch beat
//   is not counted). score / tier / lines are null until the run finishes (missionScore).
// =============================================================================
export const START_PTS = 10000, SEATS_PTS = 1000, COFFEE_PTS = 1500, FLOOR_PTS = 500;
export const AMBER_S = 120, RED_S = 30;               // the HUD chip's warning thresholds

export function newMission(seatsS, trainS) {
  return { leg: 0, seats: { limit: seatsS, seconds: 0, made: false, left: seatsS }, train: { limit: trainS, seconds: 0, made: false, left: trainS },
    coffee: false, hints: 0, seconds: 0, t1: 0, t2: 0, liveScore: START_PTS, score: null, tier: null, lines: null };
}
export const fmtClock = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// m needs: t1, t2 (integer tenths), seats.made / seats.left, train.made / train.left (/ train.seconds, train.limit for "missed by"), coffee
export function missionScore(m) {
  const S = m.seats, T = m.train, left = (x) => Math.max(0, Math.floor(+x.left || 0));
  const t1 = Math.round(+m.t1 || 0), t2 = Math.round(+m.t2 || 0);
  const seatsMade = !!S.made, trainMade = !!T.made, coffee = !!m.coffee;
  const seatsPts = seatsMade ? SEATS_PTS : 0, coffeePts = coffee ? COFFEE_PTS : 0;
  const raw = START_PTS - t1 - t2 + seatsPts + coffeePts;
  const over = Math.max(0, Math.floor((+T.seconds || 0) - (+T.limit || 0)));
  const lines = [
    { icon: '🏁', label: 'Start', pts: START_PTS, note: '' },
    { icon: '⏱️', label: 'Time', pts: -(t1 + t2), note: `${fmtClock((t1 + t2) / 10)} at 10 a second` },
    { icon: '🍤', label: 'Counter seats', pts: seatsPts, note: seatsMade ? `${fmtClock(left(S))} to spare` : 'seats gone' },
    { icon: '☕', label: 'Coffee for the ride', pts: coffeePts, note: coffee ? '' : 'skipped' },
    { icon: '🚆', label: 'Train', pts: 0, note: trainMade ? `made it, ${fmtClock(left(T))} to spare` : over > 0 ? `missed by ${fmtClock(over)}` : 'train gone' },
  ];
  const score = trainMade ? Math.max(FLOOR_PTS, raw) : 0;
  if (trainMade && raw < FLOOR_PTS) lines.push({ icon: '🛟', label: 'Minimum for making the train', pts: FLOOR_PTS - raw, note: '' });
  return { score, tier: trainMade ? (seatsMade ? 'full' : 'train') : 'missed', lines };
}
