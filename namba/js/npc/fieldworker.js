// Flow-field worker: reverse Dijkstra over the nav graph's incoming-edge CSR,
// with the crowd's own per-node penalties (wall clearance, paid areas) and
// cut edges (ticket-gate fences). Pure JS, no imports.
//
// Messages in:
//   { type: 'init', N, inStart, inSrc, inCost, penalty, paid, cut }
//   { type: 'field', id, goals: Int32Array, paidOk: bool }
// Messages out:
//   { type: 'field', id, dist: Uint16Array (decimetres, 65535 = unreachable), ms }
let G = null;

export function dijkstra(G, goals, paidOk) {
  const { N, inStart, inSrc, inCost, penalty, paid, cut } = G;
  const dist = G.scratch || (G.scratch = new Float32Array(N));
  dist.fill(Infinity);
  const heapN = G.heapN || (G.heapN = new Int32Array(N + 16));
  const heapD = G.heapD || (G.heapD = new Float32Array(N + 16));
  let hs = 0;
  const cap = heapN.length;
  const push = (v, d) => {
    let i = hs++;
    while (i > 0) { const p = (i - 1) >> 1; if (heapD[p] <= d) break; heapN[i] = heapN[p]; heapD[i] = heapD[p]; i = p; }
    heapN[i] = v; heapD[i] = d;
  };
  for (let k = 0; k < goals.length; k++) { const g = goals[k]; if (g >= 0 && g < N) { dist[g] = 0; push(g, 0); } }
  const PAID = 2.2;
  while (hs > 0) {
    const d0 = heapD[0], v = heapN[0];
    // pop
    const last = --hs; const ln = heapN[last], ld = heapD[last];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= hs) break;
      if (c + 1 < hs && heapD[c + 1] < heapD[c]) c++;
      if (heapD[c] >= ld) break;
      heapN[i] = heapN[c]; heapD[i] = heapD[c]; i = c;
    }
    heapN[i] = ln; heapD[i] = ld;
    if (d0 > dist[v]) continue;
    for (let e = inStart[v], e1 = inStart[v + 1]; e < e1; e++) {
      if (cut[e]) continue;
      const u = inSrc[e];
      let nd = d0 + inCost[e] + penalty[u];
      if (!paidOk && paid[u]) nd += PAID;
      if (nd < dist[u]) { dist[u] = nd; if (hs < cap) push(u, nd); }
    }
  }
  const out = new Uint16Array(N);
  for (let k = 0; k < N; k++) { const d = dist[k]; out[k] = d === Infinity ? 65535 : Math.min(65534, Math.round(d * 10)); }
  return out;
}

if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'init') { G = m; return; }
    if (m.type === 'field' && G) {
      const t = performance.now();
      const dist = dijkstra(G, m.goals, m.paidOk);
      self.postMessage({ type: 'field', id: m.id, dist, ms: performance.now() - t }, [dist.buffer]);
    }
  };
}
