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
export class Events {
  constructor() { this.map = new Map(); }
  on(type, fn) { (this.map.get(type) || this.map.set(type, new Set()).get(type)).add(fn); return () => this.off(type, fn); }
  off(type, fn) { const s = this.map.get(type); if (s) s.delete(fn); }
  emit(type, data) { const s = this.map.get(type); if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { console.error('[event]', type, e); } } }
}
