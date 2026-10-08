// =============================================================================
// Interactions registry. Anything can register an interactable:
//   ctx.game.addInteractable({ id, level, x, y?, z, radius, prompt, promptJa, sub,
//                              passive?, canUse?(), onUse(), test?(body, fwd) })
// Targeting: what you are near AND roughly looking at (or ctx.player.lookTarget
// when the movement system provides one). E (or Enter) uses it.
//   canUse() may return true/false or a string (shown as the reason, greyed out).
//   test(body, fwd) (optional) replaces the default geometric test and returns
//   a score (lower = better, null = not available).
//   facing: {nx, nz} (optional) — only usable from the side the normal points to
//   space: space id (optional) — always in range while standing inside it
// =============================================================================
const TAU = Math.PI * 2;

export class Interactions {
  constructor(ctx) {
    this.ctx = ctx;
    this.items = new Map();
    this.byLevel = new Map();
    this.target = null;
    this.enabled = true;
    this.counterItem = null;     // (counter) -> interactable | null, set by the game (js/game/order.js)
    this.counterCovers = null;   // (item) -> bool: an order spot supersedes this legacy item
  }
  add(def) {
    if (!def || !def.id) throw new Error('interactable needs an id');
    const it = Object.assign({ radius: 2.2, level: null, y: null }, def);
    this.remove(it.id);
    this.items.set(it.id, it);
    const lv = it.level || '*';
    (this.byLevel.get(lv) || this.byLevel.set(lv, []).get(lv)).push(it);
    return () => this.remove(it.id);
  }
  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.items.delete(id);
    const arr = this.byLevel.get(it.level || '*');
    if (arr) { const i = arr.indexOf(it); if (i >= 0) arr.splice(i, 1); }
    if (this.target === it) this.target = null;
  }
  get(id) { return this.items.get(id); }

  // choose the best target this frame
  pick() {
    const { player } = this.ctx;
    if (!player || !this.enabled) return null;
    const b = player.body;
    const fwd = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
    const lt = player.lookTarget; // optional, from movement: {level,x,y,z}
    let best = null, bestScore = Infinity;
    const consider = (it) => {
      let score;
      if (it.test) {
        score = it.test(b, fwd);
        if (score == null) return;
      } else {
        const dx = it.x - b.x, dz = it.z - b.z;
        const d = Math.hypot(dx, dz);
        const inside = it.space && player.space && player.space.id === it.space;
        if (d > it.radius && !inside) return;
        if (inside && d > it.radius + 12) return;
        if (it.facing && !inside) {
          const side = (b.x - it.x) * it.facing.nx + (b.z - it.z) * it.facing.nz;
          if (side < -0.2) return;
        }
        if (it.y != null && Math.abs((b.y + 1.6) - it.y) > 3) return;
        // angle between look direction and the point
        let ang = 0;
        if (d > 0.6) {
          ang = Math.acos(Math.max(-1, Math.min(1, (dx * fwd.x + dz * fwd.z) / d)));
          const maxAng = inside ? 1.25 : (d < 1.4 ? 1.1 : 0.62);
          if (ang > maxAng) return;
        }
        score = ang * 2 + d * 0.15;
        if (lt && lt.level === b.level) {
          const dl = Math.hypot(lt.x - it.x, lt.z - it.z);
          if (dl < 1.5) score -= 1;
        }
      }
      if (score < bestScore) { bestScore = score; best = it; }
    };
    const lists = [this.byLevel.get(b.level), this.byLevel.get('*')];
    const cs = this.ctx.counters;
    const counters = this.counterItem && Array.isArray(cs) && cs.length ? cs : null;
    const covered = counters && this.counterCovers;
    for (const arr of lists) if (arr) for (const it of arr) {
      if (it.superseded && covered && covered(it)) continue;   // the old modal coffee counter yields to the order spot
      consider(it);
    }
    // v2: service counters published by the Shops agent (ctx.counters) -> "Order a coffee" / "Say hi" at the order spot
    if (counters) {
      for (const c of counters) {
        if (!c || c.level !== b.level || !c.order || (c.order.x - b.x) > 2.5 || (b.x - c.order.x) > 2.5 || (c.order.z - b.z) > 2.5 || (b.z - c.order.z) > 2.5) continue;
        let it = null;
        try { it = this.counterItem(c); } catch (e) { it = null; }
        if (it) consider(it);
      }
    }
    return best;
  }

  // opts.keyOnly: the phone is raised — only the E key (or gamepad A / touch E, which raise KeyE too) uses the target;
  //   Enter belongs to the phone then. opts.lowerPhone: lower the phone first, unless the target keeps it up
  //   (it: { keepPhone: true }, e.g. tapping your IC card at a gate with Maps still in your hand).
  update(dt, allowUse, opts) {
    const t = this.pick();
    this.target = t;
    const hud = this.ctx.hud;
    if (!t) { hud && hud.prompt(null); return null; }
    let can = true;
    try { can = t.canUse ? t.canUse() : true; } catch (e) { can = false; }
    const view = typeof t.view === 'function' ? t.view() : null;
    const disabled = can !== true;
    const show = Object.assign({ id: t.id, prompt: t.prompt, promptJa: t.promptJa, sub: t.sub, passive: t.passive }, view || {});
    if (disabled && typeof can === 'string') { show.sub = can; }
    show.disabled = disabled;
    hud && hud.prompt(show);
    if (allowUse && !t.passive && !disabled) {
      const inp = this.ctx.input;
      const use = opts && opts.keyOnly ? inp.pressed('KeyE') : typeof inp.action === 'function' ? inp.action('interact') : (inp.pressed('KeyE') || inp.pressed('Enter'));
      if (use) {
        const ph = this.ctx.phone;
        if (opts && opts.lowerPhone && !t.keepPhone && ph && ph.isOpen && typeof ph.close === 'function') { try { ph.close(); } catch (e) { /* cosmetic */ } }
        this.ctx.events.emit('interact', { target: t.id });
        try { t.onUse && t.onUse(t); } catch (e) { console.error('[interact]', t.id, e); }
        return t;
      }
    }
    return null;
  }
}
export { TAU };
