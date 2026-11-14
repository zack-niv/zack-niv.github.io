// =============================================================================
// Journey analytics (v7.4): PostHog (EU), so Zack can build a funnel of the journeys taken in Namba.
//
// Privacy: cookieless (persistence 'memory': a new anonymous id per page load, nothing written to the device), no
// autocapture, no session recording, no personal data, IPs anonymised in the project. Only the story beats below.
// Off on localhost and in test runs (?test), unless ?track; ?notrack turns it off anywhere.
//
// Every custom event is prefixed namba_ and carries app=lost-in-namba (v7.4.1: Zack's own experiments org; the tag keeps
// future games in the same project apart).
// Super properties: v (deploy stamp), ref (?r= / ?ref= / utm_source: who the link was sent to), quality, gpu,
// screen, and `stage`: the furthest beat reached, so a $pageleave tells where a player dropped out.
//
//   namba_start · namba_tutorial_step {step} · namba_tutorial_done · namba_destination {app, slot, suggested, via}
//   namba_gate_tap (first) · namba_lost_prompt · namba_lodestone_offer · namba_lodestone_install · namba_lodestone_ready
//   namba_coffee_ordered · namba_arrived {stats} · namba_endcard · namba_choice {roam|replay}
//   namba_recovered {last_stage, reason, ago_s, safe, since_stage_s, tex_mb, canvas_mb, heap_mb, gl_contexts, ld_mode}
//   namba_run_hidden {last_stage, ago_s, …same memory props} (v12.1: last tab hidden and never back)
//   namba_contact {kind: agent|call, where: endcard|pause} · namba_pause · namba_restart · namba_perf {fps, p95Ms, …}
//   namba_reply {msg, reply, lost} (v9: every reply chip the player picks)
//   namba_pa {at: first|summary, ja, unlocked, unlock_via, tried, started, no_start, errors} (v12: did the PA voice speak?)
//   namba_error {kind, msg, where, at_stage, t} (v14: JS errors and unhandled rejections, at most 15 per page)
//   v14: namba_recovered / namba_run_hidden also carry crumbs (the dead run's last stages "stage@t …"), last_quality
//   (its tier, "!" = forced by ?quality), last_errors and geo_mb (core/resilience.js flight recorder)
//   namba_resume {t, level, errand, lodestone, dest} (v15: a run picked up from its crash checkpoint; super prop resumed)
//   namba_memdiet {passes, mb} (v15: static geometry released on phones, sent with the first namba_perf)
//   v17: namba_recovered / namba_run_hidden / namba_resume are sent with send_instantly (a recovery report was lost when the page died again before the batch flushed)
//   v18 (the iPhone dies a few minutes in, with no report): namba_recovered / namba_run_hidden also carry the flight recorder's last readings:
//   gap_max_ms, tick_max_ms, tick_sys, frames (worst frame gap / tick in the last 5 s, slowest system, frames run), long_tasks (the worst
//   gaps over 400 ms, "<ms>ms@<t>:<system> | …"), geometries, textures, programs, calls, tris (renderer), dom_nodes, phone, was_standalone,
//   page_up_s, draw_dist, dist_scale. Super properties standalone (home-screen app), fps_cap (0 = uncapped), dpr, cores.
//   namba_beat {t, stage, fps, gap_max_ms, tick_max_ms, tick_sys, calls, tris, geometries, textures, programs, crowd, phone, draw_dist,
//   dist_scale, drs, diet_mb, diet_canvases, dom_nodes, page_up_s, n} every 30 s while playing and visible (send_instantly, at most 60 per page)
//   namba_longtask {ms, sys, t, at_stage} when one frame gap lasted 1 s or more while visible (at most 10 per page)
// =============================================================================
const KEY = 'phc_yJA7mFjotHz8F3fe8xfArsxYokMgEkQxqc373mRE9ZoQ';    // project API key (Zack's experiments org, EU): public by design (client-side)
const HOST = 'https://eu.i.posthog.com';

const STAGES = ['start', 'tutorial', 'destination', 'gate', 'lost', 'offer', 'lodestone', 'arrived', 'endcard', 'contact'];

import { liveStats } from './core/resilience.js?v=a30ee4b';

// v12.1: the resilience marker's stage age + memory picture (core/resilience.js), flattened for PostHog
const memProps = (r) => { const m = (r && r.mem) || {}; return { since_stage_s: r && r.sinceStage != null ? r.sinceStage : null, tex_mb: m.tex != null ? m.tex : null, canvas_mb: m.cv != null ? m.cv : null, geo_mb: m.geo != null ? m.geo : null, heap_mb: m.heap != null ? m.heap : null, gl_contexts: m.gl != null ? m.gl : null, ld_mode: m.ld || null,
  crumbs: (r && r.crumbs) || null, last_quality: (r && r.quality) || null, last_errors: r && r.errs && r.errs.length ? r.errs.join(' | ').slice(0, 600) : null,
  ...flightProps(r) }; };
// v18: the flight recorder's fields (core/resilience.js), flattened
const flightProps = (r) => { const f = (r && r.fr) || {}, i = (r && r.ri) || {}, n = (x) => (x != null ? x : null); return { gap_max_ms: n(f.g), tick_max_ms: n(f.k), tick_sys: f.s || null, frames: n(f.n),
  long_tasks: r && r.lg && r.lg.length ? r.lg.join(' | ').slice(0, 400) : null, geometries: n(i.g), textures: n(i.t), programs: n(i.p), calls: n(i.c), tris: n(i.tr),
  dom_nodes: n(r && r.dom), phone: (r && r.ph) || null, was_standalone: !!(r && r.sa), page_up_s: n(r && r.up), draw_dist: n(r && r.dd), dist_scale: n(r && r.ds) }; };

export function setupAnalytics(ctx) {
  const q = new URLSearchParams(location.search);
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) || location.protocol === 'file:';
  const on = !q.has('notrack') && (q.has('track') || (!local && !q.has('test')));
  const queue = [];
  let ph = null, stage = -1, gateSent = false;
  const send = (ev, props, now) => {
    const p = Object.assign({ app: 'lost-in-namba' }, props || {});
    if (ph) { try { (window.posthog || ph).capture(ev, p, now ? { send_instantly: true } : undefined); } catch (e) { /* analytics never breaks the game */ } } else if (queue.length < 200) queue.push([ev, p, now]);
  };
  const reach = (name) => {
    const i = STAGES.indexOf(name);
    if (i > stage) { stage = i; if (ph) try { (window.posthog || ph).register({ stage: name }); } catch (e) { /* ignore */ } }
  };
  const api = { enabled: on, capture: send, reach, get stage() { return STAGES[stage] || null; } };
  ctx.analytics = api;
  if (!on) return api;

  // ---- super properties --------------------------------------------------------------------------------------
  const v = (() => { try { return new URL(import.meta.url).searchParams.get('v') || 'dev'; } catch (e) { return 'dev'; } })();
  const ref = (q.get('r') || q.get('ref') || q.get('utm_source') || '').slice(0, 64) || null;
  const gpu = (() => {
    try {
      const gl = ctx.engine.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 120);
    } catch (e) { return null; }
  })();
  const quality = () => { try { return ctx.engine.qualityName || q.get('quality') || null; } catch (e) { return null; } };

  // ---- load posthog-js: PostHog's standard snippet (a stub that queues calls, then array.js takes over) ------------
  /* eslint-disable */
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session identify reset get_distinct_id get_session_id set_config opt_in_capturing opt_out_capturing has_opted_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  /* eslint-enable */
  try {
    window.posthog.init(KEY, {
      api_host: HOST, persistence: 'memory', autocapture: false, capture_pageview: true, capture_pageleave: true,
      disable_session_recording: true, disable_surveys: true, person_profiles: 'identified_only', advanced_disable_feature_flags: true,
      opt_out_useragent_filter: q.has('track'),     // test runs only: headless Chrome counts as a bot and would be dropped
    });
    window.posthog.register({ app: 'lost-in-namba', test: q.has('track'), v, ref, gpu, quality: quality(), screen: `${screen.width}x${screen.height}`, input: (ctx.input && ctx.input.touch) ? 'touch' : 'kbm', orient: innerWidth > innerHeight ? 'land' : 'port',   // v11: mobile/tablet
      standalone: (() => { try { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; } })(), fps_cap: ctx.fpsCap != null ? ctx.fpsCap : null, dpr: devicePixelRatio || null, cores: navigator.hardwareConcurrency || null,   // v18
      stage: 'loaded' });
    ph = window.posthog;               // the stub until array.js arrives (it queues), then the real client
    for (const [ev, p, now] of queue.splice(0)) ph.capture(ev, p, now ? { send_instantly: true } : undefined);
  } catch (e) { console.warn('[analytics]', e.message); }
  // (blocked by an ad blocker or offline: the stub just keeps queueing; the game does not care)

  // ---- the story beats ---------------------------------------------------------------------------------------
  const E = ctx.events, t = () => Math.round((ctx.game && ctx.game.demo && ctx.game.demo.t) || 0);
  const started = () => { reach('start'); send('namba_start', { quality: quality() }); perfAt(45, 'play'); paWatch(); };
  if (ctx.started) started(); else E.on('game:start', started);
  // v11.1: the previous run died on screen (iOS memory kill / context loss) and this boot is the recovery
  try { const r = ctx.recovered; if (r && r.reason !== 'param') { (window.posthog || {}).register && window.posthog.register({ safe: r.safe || 1 }); send('namba_recovered', { last_stage: r.lastStage || null, reason: r.reason || null, ago_s: r.ago != null ? r.ago : null, safe: r.safe || 1, ...memProps(r) }, true); } } catch (e) { /* optional */ }     // (a test run can start before this module loads)
  // v12.1: the last run's tab went hidden and never came back (a background discard, or a kill announced as hidden)
  try { const h = ctx.lastRunHidden; if (h) send('namba_run_hidden', { last_stage: h.lastStage || null, ago_s: h.ago != null ? h.ago : null, ...memProps(h) }, true); } catch (e) { /* optional */ }
  // v14: JS errors (core/resilience.js), the ones before this module loaded first; at most 15 per page
  let errSent = 0;
  const sendErr = (e) => { if (e && errSent++ < 15) send('namba_error', { kind: e.kind, msg: e.msg, where: e.where, at_stage: e.stage, t: e.t }); };
  try { for (const e of ctx.errorLog || []) sendErr(e); } catch (e) { /* optional */ }
  E.on('app:error', sendErr);
  // v15: resumed runs (story.js resume) — and a super property, so the rest of a resumed run can be told apart
  E.on('story:resume', (e) => { try { window.posthog && window.posthog.register && window.posthog.register({ resumed: true }); } catch (err) { /* optional */ } reach('start'); send('namba_resume', { t: e && Math.round(e.t), level: e && e.lv, errand: e && e.err, lodestone: e && e.lode, dest: e && e.dest }, true); });
  E.on('tutorial:step', (e) => { if (e && e.done) { reach('tutorial'); send('namba_tutorial_step', { step: e.id, t: e.t, nudges: e.nudges }); } });
  E.on('tutorial:done', (e) => send('namba_tutorial_done', { t: e && e.t }));
  E.on('lodestone:stack3d', (e) => send('namba_stack3d', { ok: !!(e && e.ok), mode: e && e.mode, w: e && e.w, h: e && e.h }));   // v13: does the shared-renderer copy work on this device?
  E.on('nav:destination', (e) => { reach('destination'); send('namba_destination', { app: e.app, slot: e.slotId, place: e.name, suggested: !!e.suggested, via: e.via, t: t() }); });
  E.on('gate:tap', (e) => { if (e && e.player && !e.auto && !gateSent) { gateSent = true; reach('gate'); send('namba_gate_tap', { gate: e.gate, t: t() }); } });
  E.on('aya:answered', (e) => { if (e && !e.auto) send('namba_reply', { msg: e.msgId, reply: e.replyId, lost: !!e.lost, t: t() }); });   // v9: which chip each player picks
  E.on('story:where', (e) => { reach('lost'); send('namba_lost_prompt', { why: e && e.why, t: t() }); });
  E.on('demo:offer', (e) => { reach('offer'); send('namba_lodestone_offer', { why: e && e.why, t: t() }); });
  E.on('phone:upgrade', (e) => {
    if (e && e.stage === 'installing') send('namba_lodestone_install', { t: t() });
    if (e && e.stage === 'ready') { reach('lodestone'); send('namba_lodestone_ready', { t: t() }); }
  });
  E.on('demo:order', (e) => { if (e && e.errand) send('namba_coffee_ordered', { place: e.name, item: e.item, t: t() }); });
  E.on('demo:arrive', (e) => {
    reach('arrived');
    const s = (e && e.summary) || {}, b = s.before || {}, a = s.after || {};
    const n = (x) => (typeof x === 'number' && isFinite(x) ? Math.round(x * 10) / 10 : null);
    send('namba_arrived', {
      t: n(e && e.t), upgraded: !!(e && e.upgraded), coffee: !!(s.errand && s.errand.delivered),
      seconds_before: n(b.seconds), seconds_after: n(a.seconds),
      on_track_before: n(b.onTrackPct), on_track_after: n(a.onTrackPct), off_route_before_s: n(b.offRouteSec), off_route_after_s: n(a.offRouteSec),
      error_before_m: n(b.err), error_after_m: n(a.err), wrong_floor_before_pct: n(b.wrongPct), wrong_floor_after_pct: n(a.wrongPct),
      total_s: n(s.totalSeconds), total_m: n(s.totalMeters),
    });
    perfAt(0, 'arrived');
  });
  E.on('demo:end', () => { reach('endcard'); send('namba_endcard', { t: t() }); });
  E.on('demo:choice', (e) => send('namba_choice', { choice: e && e.choice }));
  E.on('game:pause', () => send('namba_pause', { t: t(), stage: STAGES[stage] || null }));
  E.on('game:restart', () => send('namba_restart', { t: t(), stage: STAGES[stage] || null }));
  // the contact cards (end card and pause menu): one delegated listener, capture phase (the cards stop propagation)
  addEventListener('click', (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest('a.e-link');
    if (!a) return;
    reach('contact');
    send('namba_contact', { kind: a.classList.contains('call') ? 'call' : 'agent', where: a.closest('.g-pause') ? 'pause' : 'endcard', t: t() });
  }, true);

  // ---- v18: the heartbeat and the long frames ----------------------------------------------------------------------
  // namba_beat every 30 s while playing (not on a hidden tab, not after the end card), at most 60 per page
  let beats = 0;
  const beat = () => {
    try {
      if (!ctx.started || document.hidden || stage >= STAGES.indexOf('endcard') || beats >= 60) return;
      const L = liveStats(ctx) || {}, f = L.fr || {}, i = L.ri || {}, md = ctx.memdiet && ctx.memdiet.stats, n = (x) => (x != null ? x : null);
      send('namba_beat', { t: t(), stage: STAGES[stage] || null, fps: ctx.engine.stats.fps != null ? Math.round(ctx.engine.stats.fps) : null, gap_max_ms: n(f.g), tick_max_ms: n(f.k), tick_sys: f.s || null,
        calls: n(i.c), tris: n(i.tr), geometries: n(i.g), textures: n(i.t), programs: n(i.p), crowd: ctx.crowd ? ctx.crowd.count : null, phone: L.ph || null, draw_dist: n(L.dd), dist_scale: n(L.ds),
        drs: ctx.engine.drs != null ? +ctx.engine.drs.toFixed(2) : null, diet_mb: md ? md.mb : null, diet_canvases: md ? md.canvases : null, dom_nodes: n(L.dom), page_up_s: n(L.up), n: ++beats }, true);
    } catch (e) { /* analytics never breaks the game */ }
  };
  setInterval(beat, 30000);
  let longSent = 0;
  E.on('app:longtask', (e) => { try { if (e && longSent++ < 10) send('namba_longtask', { ms: e.ms, sys: e.sys || null, t: e.t, at_stage: STAGES[stage] || null }); } catch (err) { /* optional */ } });

  // ---- v12: did the station PA actually speak on this device? (iOS dropped every line silently until v12) ----------
  // 'first': once the first PA line has an outcome (spoken / never started / error); 'summary': 90 s into play
  function paWatch() {
    const read = () => { try { const a = ctx.audio; return a && (a.paStats ? a.paStats() : a.announcer && a.announcer.stats && a.announcer.stats()); } catch (e) { return null; } };
    const props = (s, at) => ({ at, voices: s.voices, ja: s.ja || null, unlocked: !!s.unlocked, unlock_via: s.unlockVia || null, attempts: s.attempts, tried: s.tried,
      started: s.started, ended: s.ended, no_start: s.noStart, errors: (s.errors || []).slice(0, 6).join(',') || null, last_err: s.lastErr || null, state: s.state || null, t: t() });
    let firstSent = false;
    const iv = setInterval(() => {
      const s = read();
      if (s && !firstSent && (s.started > 0 || s.noStart > 0 || (s.errors && s.errors.length))) { firstSent = true; send('namba_pa', props(s, 'first')); clearInterval(iv); }
    }, 2000);
    setTimeout(() => { clearInterval(iv); const s = read(); if (s) send('namba_pa', props(s, 'summary')); }, 90000);
  }

  // ---- real frame rate from real machines (never measured before v7.4) ----------------------------------------
  function perfAt(delay, at) {
    setTimeout(() => {
      const P = ctx.perf;
      if (!P || !P.sample || document.hidden) return;
      P.sample(3).then((r) => r && send('namba_perf', {
        at, fps: r.fps != null ? Math.round(r.fps) : null, avg_ms: r.avgMs != null ? +r.avgMs.toFixed(1) : null,
        p95_ms: r.p95Ms != null ? +r.p95Ms.toFixed(1) : null, calls: r.calls, memdiet_mb: ctx.memdiet && ctx.memdiet.on ? ctx.memdiet.stats.mb : null, quality: r.quality, drs: r.drs, crowd: ctx.crowd && ctx.crowd.count, ...(() => { try { const m = ctx.memEstimate && ctx.memEstimate(); return m ? { tex_mb: Math.round(m.texMB), canvas_mb: Math.round(m.canvasMB), geo_mb: m.geoMB } : {}; } catch (e) { return {}; } })(),
      })).catch(() => { /* optional */ });
    }, delay * 1000);
  }
  return api;
}
