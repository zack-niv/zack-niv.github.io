// Tiny event bus. Cross-module communication goes through here so systems
// stay decoupled. Known events (add to this list when you emit new ones):
//   'player:step'        { foot, surface, speed, level }        footstep landed
//   'player:level'       { from, to }                           changed floor
//   'player:zone'        { from, to, space }                    entered a zone
//   'player:ramp'        { ramp, entering }                     stepped on/off escalator/stairs
//   'phone:open'/'phone:close'
//   'interact'           { target }                             player pressed E on something
//   'quest:update'       { id, state, text }
//   'train:approach'     { line, track, platform, eta }         ~30s before arrival
//   'train:arrive'       { line, track, platform, doorsAt }     doors open
//   'train:depart'       { line, track, platform }
//   'announce'           { text, ja, kind, position, level }    PA announcement
//   'time:tick'          { minutes }                            game minute advanced
//   -- game flow (js/game/*, see notes/game.md) --
//   'phone:message'      { id, from, text, time }               a text from Aya (phone renders)
//   'caption'            { en, ja, speaker, duration }          subtitle line (HUD renders)
//   'toast'              { kind, title, en, ja }                small HUD notification
//   'discover'           { id, en, ja }                         first visit to a place
//   'game:start' / 'game:pause' / 'game:resume' / 'game:end' { summary }
//   'ic:tap'             { ok, gate, balance, fare, reason }    ICOCA card tapped at a gate
//   'vignette:open' / 'vignette:close'  { kind }                ordering/eating/ticket UI
//   'settings:change'    { key, value, settings }
export class Events {
  constructor() { this.map = new Map(); }
  on(type, fn) { (this.map.get(type) || this.map.set(type, new Set()).get(type)).add(fn); return () => this.off(type, fn); }
  off(type, fn) { const s = this.map.get(type); if (s) s.delete(fn); }
  emit(type, data) { const s = this.map.get(type); if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { console.error('[event]', type, e); } } }
}
