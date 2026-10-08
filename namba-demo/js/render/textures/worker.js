// Texture generation worker: builds procedural texture families off the main
// thread and transfers raw RGBA arrays back (see materials.js).
import { TEX } from './library.js?v=488c31e';
self.onmessage = (e) => {
  const { id, key, N } = e.data;
  try {
    const t0 = performance.now();
    const r = TEX[key].make(N);
    const bufs = [r.albedo.buffer, r.orm.buffer];
    if (r.normal) bufs.push(r.normal.buffer);
    self.postMessage({ id, key, N: r.N, M: r.M, albedo: r.albedo, orm: r.orm, normal: r.normal, ms: performance.now() - t0 }, bufs);
  } catch (err) {
    self.postMessage({ id, key, error: String(err && err.message || err) });
  }
};
