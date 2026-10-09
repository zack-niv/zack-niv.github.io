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
//   namba_contact {kind: agent|call, where: endcard|pause} · namba_pause · namba_restart · namba_perf {fps, p95Ms, …}
// =============================================================================
const KEY = 'phc_yJA7mFjotHz8F3fe8xfArsxYokMgEkQxqc373mRE9ZoQ';    // project API key (Zack's experiments org, EU): public by design (client-side)
const HOST = 'https://eu.i.posthog.com';

const STAGES = ['start', 'tutorial', 'destination', 'gate', 'lost', 'offer', 'lodestone', 'arrived', 'endcard', 'contact'];

export function setupAnalytics(ctx) {
  const q = new URLSearchParams(location.search);
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) || location.protocol === 'file:';
  const on = !q.has('notrack') && (q.has('track') || (!local && !q.has('test')));
  const queue = [];
  let ph = null, stage = -1, gateSent = false;
  const send = (ev, props) => {
    const p = Object.assign({ app: 'lost-in-namba' }, props || {});
    if (ph) { try { (window.posthog || ph).capture(ev, p); } catch (e) { /* analytics never breaks the game */ } } else if (queue.length < 200) queue.push([ev, p]);
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
    window.posthog.register({ app: 'lost-in-namba', test: q.has('track'), v, ref, gpu, quality: quality(), screen: `${screen.width}x${screen.height}`, stage: 'loaded' });
    ph = window.posthog;               // the stub until array.js arrives (it queues), then the real client
    for (const [ev, p] of queue.splice(0)) ph.capture(ev, p);
  } catch (e) { console.warn('[analytics]', e.message); }
  // (blocked by an ad blocker or offline: the stub just keeps queueing; the game does not care)

  // ---- the story beats ---------------------------------------------------------------------------------------
  const E = ctx.events, t = () => Math.round((ctx.game && ctx.game.demo && ctx.game.demo.t) || 0);
  const started = () => { reach('start'); send('namba_start', { quality: quality() }); perfAt(45, 'play'); };
  if (ctx.started) started(); else E.on('game:start', started);     // (a test run can start before this module loads)
  E.on('tutorial:step', (e) => { if (e && e.done) { reach('tutorial'); send('namba_tutorial_step', { step: e.id, t: e.t, nudges: e.nudges }); } });
  E.on('tutorial:done', (e) => send('namba_tutorial_done', { t: e && e.t }));
  E.on('nav:destination', (e) => { reach('destination'); send('namba_destination', { app: e.app, slot: e.slotId, place: e.name, suggested: !!e.suggested, via: e.via, t: t() }); });
  E.on('gate:tap', (e) => { if (e && e.player && !e.auto && !gateSent) { gateSent = true; reach('gate'); send('namba_gate_tap', { gate: e.gate, t: t() }); } });
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

  // ---- real frame rate from real machines (never measured before v7.4) ----------------------------------------
  function perfAt(delay, at) {
    setTimeout(() => {
      const P = ctx.perf;
      if (!P || !P.sample || document.hidden) return;
      P.sample(3).then((r) => r && send('namba_perf', {
        at, fps: r.fps != null ? Math.round(r.fps) : null, avg_ms: r.avgMs != null ? +r.avgMs.toFixed(1) : null,
        p95_ms: r.p95Ms != null ? +r.p95Ms.toFixed(1) : null, calls: r.calls, quality: r.quality, drs: r.drs, crowd: ctx.crowd && ctx.crowd.count,
      })).catch(() => { /* optional */ });
    }, delay * 1000);
  }
  return api;
}
