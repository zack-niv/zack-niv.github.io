// Synthesis worker: renders recipes off the main thread and transfers the
// sample data back. Module worker (imports recipes.js).
import { synthesize } from './recipes.js?v=517b401';

self.onmessage = (e) => {
  const { id, name, base } = e.data;
  try {
    const t0 = performance.now();
    const res = synthesize(name, base);
    const bufs = [];
    const channels = res.channels.map((c) => {
      // transfer distinct ArrayBuffers only
      if (bufs.includes(c.buffer) || c.byteOffset !== 0 || c.byteLength !== c.buffer.byteLength) c = c.slice();
      bufs.push(c.buffer);
      return c;
    });
    self.postMessage({ id, ok: true, channels, sampleRate: res.sampleRate, loop: res.loop, ms: performance.now() - t0 }, bufs);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
  }
};
