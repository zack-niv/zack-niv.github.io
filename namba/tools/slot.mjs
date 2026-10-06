// Machine-wide semaphore for headless browser runs: many agents share 4 CPU
// cores, so at most SLOTS SwiftShader browsers render at once. Other callers wait.
import fs from 'fs';
const SLOTS = +(process.env.NAMBA_SLOTS || 4);
const dir = '/tmp/namba-slots';
fs.mkdirSync(dir, { recursive: true });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
export async function acquireSlot(label = '') {
  const t0 = Date.now(); let warned = false;
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const f = `${dir}/slot${i}.lock`;
      try {
        const pid = +fs.readFileSync(f, 'utf8').split(' ')[0];
        if (pid && !alive(pid)) fs.unlinkSync(f); // stale
      } catch {}
      try {
        fs.writeFileSync(f, `${process.pid} ${label}`, { flag: 'wx' });
        const release = () => { try { if (fs.readFileSync(f, 'utf8').startsWith(String(process.pid))) fs.unlinkSync(f); } catch {} };
        process.on('exit', release); process.on('SIGINT', () => { release(); process.exit(130); }); process.on('SIGTERM', () => { release(); process.exit(143); });
        if (warned) console.log(`[slot] acquired after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        return release;
      } catch {}
    }
    if (!warned) { console.log(`[slot] waiting for a free headless-browser slot (max ${SLOTS} concurrent)…`); warned = true; }
    await new Promise(r => setTimeout(r, 1500));
  }
}
