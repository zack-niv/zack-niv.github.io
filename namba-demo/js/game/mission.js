// =============================================================================
// v22: the mission — two legs, scored in points. Pure data + one pure function (testable in Node: no imports).
//   leg 1 LUNCH  from Aya's "meet me" text: a seats clock counts down (DEMO.seatsS). Reaching her in time = seats made;
//                late = seats gone, the run continues (no fail state here).
//   leg 2 TRAIN  after the lunch beat: a train clock counts down (DEMO.trainS). Finish = tapping through a Nankai ticket
//                gate. Optional: iced coffees from one café (DEMO.coffeeSlot) for bonus points. Clock at zero = train missed.
// The mission object lives on demo.mission (also game.mission / story.mission — the same object, mutated in place):
//   { leg: 0|1|2|3, seats: {limit, seconds, made, left}, train: {limit, seconds, made, left}, coffee, hints,
//     seconds, score, tier, lines }
//   leg 0 = before the meet text, 1 = lunch, 2 = train, 3 = finished. seconds = play seconds of both legs (the lunch beat
//   is not counted). score / tier / lines are null until the run finishes (missionScore).
// =============================================================================
export const SEATS_BASE = 500, SEATS_PER_S = 5;       // seats made: 500 + 5 per whole second left
export const TRAIN_BASE = 1000, TRAIN_PER_S = 10;     // train made: 1000 + 10 per whole second left
export const COFFEE_PTS = 1500;                       // coffee bought in leg 2
export const AMBER_S = 120, RED_S = 30;               // the HUD chip's warning thresholds

export function newMission(seatsS, trainS) {
  return { leg: 0, seats: { limit: seatsS, seconds: 0, made: false, left: seatsS }, train: { limit: trainS, seconds: 0, made: false, left: trainS },
    coffee: false, hints: 0, seconds: 0, score: null, tier: null, lines: null };
}
export const fmtClock = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// m needs: seats.made / seats.left, train.made / train.left (/ train.seconds, train.limit for "missed by"), coffee
export function missionScore(m) {
  const S = m.seats, T = m.train, left = (x) => Math.max(0, Math.floor(+x.left || 0));
  const seatsMade = !!S.made, trainMade = !!T.made, coffee = !!m.coffee;
  const seatsPts = seatsMade ? SEATS_BASE + SEATS_PER_S * left(S) : 0;
  const coffeePts = coffee ? COFFEE_PTS : 0;
  const trainPts = trainMade ? TRAIN_BASE + TRAIN_PER_S * left(T) : 0;
  const over = Math.max(0, Math.floor((+T.seconds || 0) - (+T.limit || 0)));
  const lines = [
    { icon: '🍤', label: 'Counter seats', pts: seatsPts, note: seatsMade ? `${fmtClock(left(S))} to spare` : 'seats gone' },
    { icon: '☕', label: 'Coffee for the ride', pts: coffeePts, note: coffee ? 'bought' : 'skipped' },
    { icon: '🚆', label: 'Train made', pts: trainPts, note: trainMade ? `${fmtClock(left(T))} to spare` : over > 0 ? `missed by ${fmtClock(over)}` : 'train gone' },
  ];
  // a missed train scores nothing: seats and coffee keep their nominal points but are "not counted"
  for (const l of lines) l.counted = trainMade && l.pts > 0;
  const tier = trainMade ? (seatsMade ? 'full' : 'train') : 'missed';
  const score = trainMade ? seatsPts + coffeePts + trainPts : 0;
  return { score, tier, lines };
}
