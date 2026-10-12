// =============================================================================
// Touch wording (v11). The tutorial reads TUTORIAL.<key> from js/game/script.js each time it shows a hint, so on a
// touch device we assign touch lines onto that same object once (only keys that already exist; a renamed key just
// keeps its desktop line). Glyphs: <i class="tc-g use"></i> = the Use button, <i class="tc-g phone"></i> = the phone
// button (drawn by css/touch.css to match the real buttons).
// =============================================================================
import { TUTORIAL } from '../game/script.js?v=9ec3217';

const USE = '<i class="tc-g use"></i>';
const PH = '<i class="tc-g phone"></i>';

export const TUTORIAL_TOUCH = {
  look: 'Drag on the right to look around',
  move: 'Left thumb to walk · push further to hurry',
  raise: `Your phone buzzed. Tap it, or ${PH}`,
  raiseHold: `Your phone buzzed. Tap it, or ${PH}`,
  reply: 'Answer Aya: tap a reply',
  replyDown: `Aya asked you something. Tap ${PH} to answer`,
  maps: 'Open <b>Maps</b> in the dock',
  mapsDown: `${PH} then open <b>Maps</b>`,
  pick: 'Pick where to go: <b>Aya\'s pick</b>, or any place',
  pickDown: `${PH}, open <b>Maps</b> and pick where to go`,
  pick2Down: `${PH} to pick your next stop`,
  pick2Route: 'Next stop: <b>Tempura Daikichi</b>. Tap Aya\'s pick (or End route)',
  pick2RouteLs: 'Next stop: <b>Tempura Daikichi</b>. Tap Aya\'s pick (or End route)',
  pickMsg: 'Open Aya\'s link: tap the card (or Maps in the dock)',
  order: `Walk up to the counter, then ${USE}`,
  interact: `${USE} appears when you can use something`,
  interactHere: `${USE} try it`,
  gate: `Tap your IC card at the gate: walk up to a lane, then ${USE}`,
  gateHere: `${USE} taps your IC card here`,
  gateBlocked: `Tap your IC card first: ${USE}`,
  install: `Aya sent a link. ${PH}, then tap <b>Lodestone</b>`,
  installUp: 'Tap <b>Lodestone</b> in Aya\'s message',
};

export const TOUCH_TEXT = {
  begin: 'Tap to begin',
  beginJa: 'タップしてはじめる',
  titleHint: 'Left thumb walks<span class="t-sep">·</span>drag to look<span class="t-sep">·</span>headphones on <span class="t-hp" aria-hidden="true">🎧</span>',
  ghost: 'walk',
  pause: 'Tap <b>Resume</b> to keep playing. Left thumb walks, drag on the right looks, tap your phone to raise it.',
};

let applied = false;
export function applyTouchCopy() {
  if (applied) return;
  applied = true;
  for (const k in TUTORIAL_TOUCH) if (Object.prototype.hasOwnProperty.call(TUTORIAL, k)) TUTORIAL[k] = TUTORIAL_TOUCH[k];
}
