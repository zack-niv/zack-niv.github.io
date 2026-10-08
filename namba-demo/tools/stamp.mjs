// Cache-busting for a deployed copy: appends ?v=<stamp> to every relative .js/.css reference so a browser can never run a
// mix of old and new modules after a deploy (GitHub Pages caches each file ~10 min).
//   node tools/stamp.mjs <deployed namba-demo dir> <stamp>
// Rewrites in place: every '<./ or ../ path>.js|.css' string literal in js/**/*.js (static imports, dynamic import() path
// lists, new URL(...) for workers/preloads; consistent everywhere, so each module still loads exactly once), plus the
// js/ and css/ links in index.html. Run ONLY on the deploy copy, never on the working tree.
import fs from 'fs';
import path from 'path';

const [dir, stamp] = process.argv.slice(2);
if (!dir || !stamp || !/^[\w.-]+$/.test(stamp)) { console.error('usage: node tools/stamp.mjs <dir> <stamp>'); process.exit(2); }
const lit = /(['"`])((?:\.{1,2}\/|css\/)[^'"`\s?#]*?\.(?:js|css))\1/g;   // ./x.js, ../x.js, css/x.css (phone.css)
let files = 0, refs = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) {
      const s = fs.readFileSync(p, 'utf8');
      let n = 0;
      const out = s.replace(lit, (m, q, ref) => { n++; return `${q}${ref}?v=${stamp}${q}`; });
      if (n) { fs.writeFileSync(p, out); files++; refs += n; }
    }
  }
};
walk(path.join(dir, 'js'));
const ih = path.join(dir, 'index.html');
let html = fs.readFileSync(ih, 'utf8'), hn = 0;
html = html.replace(/((?:src|href)=")((?:js|css)\/[^"?#]+\.(?:js|css))"/g, (m, a, ref) => { hn++; return `${a}${ref}?v=${stamp}"`; });
fs.writeFileSync(ih, html);
console.log(`stamp ${stamp}: ${refs} refs in ${files} js files, ${hn} in index.html`);
