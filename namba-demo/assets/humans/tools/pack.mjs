// =============================================================================
// Offline packer for the crowd's human models (run once, by hand, in Node 18+).
//
//   node pack.mjs <srcDir> <outDir>
//
// <srcDir>/men/*.gltf, <srcDir>/women/*.gltf are Quaternius "Ultimate Modular
// Men / Women" individual characters (CC0, see ../LICENSE.md). Each source has
// ~13 skinned primitives (one per material, flat shaded, ~15k vertices). We:
//   1. bake every primitive into the shared bind space and merge them into ONE
//      skinned geometry per character (one draw call),
//   2. replace materials by a per-vertex material index `_mat` (uint8) into a
//      small per-character table {name, colour, tint} stored in mesh extras;
//      `tint` says which crowd look colour replaces it (skin, hair, top, …),
//   3. weld vertices and recompute creased normals (≈3–4x fewer vertices),
//   4. quantise: normals int8, weights uint8, joints uint8,
//   5. build two simplified LODs (meshoptimizer, 30% / 11%) with the same skin,
//   6. keep only the clips the crowd uses (Walk, Idle, Idle_Neutral, Wave,
//      Interact, Run), dropping tracks that never move,
// and write humans_m.glb / humans_f.glb (one armature per file: every
// character of a gender shares the same rig).
// Requires: npm i three@0.186.0 meshoptimizer (in a scratch dir; not shipped).
// =============================================================================
import fs from 'fs';
import path from 'path';
globalThis.self = globalThis;
if (!globalThis.ProgressEvent) globalThis.ProgressEvent = class extends Event { constructor(t, o = {}) { super(t); Object.assign(this, o); } };
if (!globalThis.FileReader) globalThis.FileReader = class {
  _done(r) { this.result = r; this.onload && this.onload({ target: this }); this.onloadend && this.onloadend({ target: this }); }
  readAsArrayBuffer(b) { b.arrayBuffer().then(r => this._done(r)); }
  readAsDataURL(b) { b.arrayBuffer().then(r => this._done('data:' + (b.type || 'application/octet-stream') + ';base64,' + Buffer.from(r).toString('base64'))); }
};
const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
// GLTFExporter would re-expand our int8 normals to float (its unit-length check is stricter than int8
// precision): import a copy with that check disabled.
const expSrc = new URL(import.meta.resolve('three/examples/jsm/exporters/GLTFExporter.js'));
const expPatched = new URL('GLTFExporter.int8normals.js', expSrc);
fs.writeFileSync(expPatched, fs.readFileSync(expSrc, 'utf8').replace('isNormalizedNormalAttribute( normal ) {', 'isNormalizedNormalAttribute( normal ) {\n\t\tif ( normal.normalized ) return true;'));
const { GLTFExporter } = await import(expPatched.href);
const BGU = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
const { MeshoptSimplifier } = await import('meshoptimizer');
await MeshoptSimplifier.ready;

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) { console.log('usage: node pack.mjs <srcDir> <outDir>'); process.exit(1); }

// tint slots understood by js/npc/humans.js
const T = { KEEP: 0, SKIN: 1, HAIR: 2, TOP: 3, BOTTOM: 4, SHOES: 5, INNER: 6, ACC: 7, ACC2: 8 };
const SETS = {
  m: [['M_Suit', 'Suit'], ['M_Casual', 'Casual_2'], ['M_Hoodie', 'Casual_Hoodie'], ['M_Backpacker', 'Adventurer']],
  f: [['F_Suit', 'Suit'], ['F_Casual', 'Casual'], ['F_Dress', 'Formal'], ['F_Backpacker', 'Adventurer']],
};
const CLIPS = ['Walk', 'Idle', 'Idle_Neutral', 'Wave', 'Interact', 'Run'];

const loader = new GLTFLoader();
async function load(p) {
  const b = fs.readFileSync(p);
  return loader.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
}

// classify a primitive: which part of the body it is
function partOf(mesh, siblings) {
  const bb = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
  const sib = siblings.map(s => s.material.name).join(',');
  if (bb.max.z < -0.02 || (bb.min.z < -0.17 && bb.max.y > 1.1 && bb.max.x - bb.min.x < 0.5 && !/Skin/.test(sib))) return 'pack';
  if (bb.min.y > 1.35 && bb.max.x - bb.min.x < 0.3 && /Eye|Brown/.test(sib) && bb.max.y > 1.7) return 'head';
  if (bb.min.y > 1.35 && bb.max.x - bb.min.x < 0.35 && bb.max.y > 1.75) return 'head';
  if (bb.max.y < 0.5 && bb.min.y < 0.05) return 'feet';
  if (bb.max.x - bb.min.x > 1.0 || (bb.max.y > 1.3 && bb.min.y > 0.9)) return 'body';
  if (bb.min.y > 0.9 && bb.max.y > 1.1) return 'body';
  return 'legs';
}

function slotFor(part, mat, verts, isLargest, all) {
  const n = mat.name;
  if (/^Skin/.test(n)) return n === 'Skin' ? T.SKIN : T.KEEP;
  if (/Eyebrow/.test(n)) return T.HAIR;
  if (verts <= 140) return T.KEEP;                       // eyes, tiny trims
  switch (part) {
    case 'head': return /Worker/.test(n) ? T.KEEP : T.HAIR;
    case 'feet': return /White|Black/.test(n) && all.some(o => o !== mat.name && !/White|Black|Skin/.test(o)) ? T.KEEP : T.SHOES;
    case 'legs': return isLargest ? T.BOTTOM : T.KEEP;
    case 'pack': return isLargest ? T.ACC : T.KEEP;
    case 'body':
      if (n === 'Tie') return T.ACC2;
      if (n === 'White' && !isLargest) return T.INNER;
      return isLargest ? T.TOP : T.KEEP;
  }
  return T.KEEP;
}

async function buildSet(gender) {
  const list = SETS[gender];
  const dir = path.join(srcDir, gender === 'm' ? 'men' : 'women');
  let armature = null, bones = null, boneInverses = null, clips = null;
  const out = new THREE.Group(); out.name = 'humans_' + gender;
  const meshes = [];
  for (const [vname, file] of list) {
    const g = await load(path.join(dir, file + '.gltf'));
    g.scene.updateMatrixWorld(true);
    const prims = []; g.scene.traverse(o => { if (o.isSkinnedMesh) prims.push(o); });
    const sk = prims[0].skeleton;
    if (!armature) {
      armature = g.scene.getObjectByName('CharacterArmature') || g.scene.children[0];
      bones = sk.bones; boneInverses = sk.boneInverses;
      clips = g.animations.filter(c => CLIPS.includes(c.name)).map(c => optimiseClip(c));
    } else {
      // every character of a gender must share the rig (same bind pose)
      let maxd = 0;
      for (let i = 0; i < sk.boneInverses.length; i++) for (let k = 0; k < 16; k++) maxd = Math.max(maxd, Math.abs(sk.boneInverses[i].elements[k] - boneInverses[i].elements[k]));
      if (maxd > 2e-3) console.warn(`  ! ${vname}: bind pose differs from the shared rig by ${maxd.toFixed(4)}`);
      if (sk.bones.map(b => b.name).join() !== bones.map(b => b.name).join()) throw new Error(vname + ': different bone list');
    }
    // group primitives by their source mesh (siblings share a parent / name stem)
    const groups = new Map();
    for (const p of prims) { const stem = p.name.replace(/_\d+$/, ''); if (!groups.has(stem)) groups.set(stem, []); groups.get(stem).push(p); }
    const mats = []; const matIdx = new Map();
    const geos = [];
    for (const [, sib] of groups) {
      // props held in a hand in the T-pose (the Suit character carries a pistol): not for a station crowd
      const hb = new THREE.Box3(); for (const s of sib) hb.union(new THREE.Box3().setFromBufferAttribute(s.geometry.attributes.position));
      if (!sib.some(s => /^Skin/.test(s.material.name)) && (hb.max.x < -0.55 || hb.min.x > 0.55)) { console.log(`  ${vname}: dropped hand prop ${sib.map(s => s.material.name).join('+')}`); continue; }
      const part = partOf(sib[0], sib);
      const counts = sib.map(s => /^Skin/.test(s.material.name) || /White/.test(s.material.name) && sib.length > 2 ? 0 : s.geometry.attributes.position.count);
      const big = counts.indexOf(Math.max(...counts));
      for (let i = 0; i < sib.length; i++) {
        const p = sib[i], m = p.material;
        const tint = slotFor(part, m, p.geometry.attributes.position.count, i === big, sib.map(s => s.material.name));
        const key = m.name + '|' + tint;
        if (!matIdx.has(key)) { matIdx.set(key, mats.length); mats.push({ name: m.name, part, color: '#' + m.color.getHexString(THREE.SRGBColorSpace), tint }); }
        const geo = new THREE.BufferGeometry();
        const src = p.geometry;
        geo.setAttribute('position', src.attributes.position.clone());
        geo.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(src.attributes.skinIndex.array), 4));
        geo.setAttribute('skinWeight', new THREE.BufferAttribute(Float32Array.from(src.attributes.skinWeight.array), 4));
        geo.setIndex(src.index ? src.index.clone() : null);
        geo.applyMatrix4(p.bindMatrix);
        const n = geo.attributes.position.count;
        geo.setAttribute('mat', new THREE.BufferAttribute(new Float32Array(n).fill(matIdx.get(key)), 1));
        geos.push(geo);
      }
    }
    let merged = BGU.mergeGeometries(geos.map(g => g.index ? g : g), false);
    const v0 = merged.attributes.position.count;
    merged = BGU.mergeVertices(merged, 1e-4);
    merged = BGU.toCreasedNormals(merged, THREE.MathUtils.degToRad(42));
    merged = BGU.mergeVertices(merged, 1e-4);
    const v1 = merged.attributes.position.count;
    const geo = quantise(merged);
    const lod = simplify(geo, 0.3, 0.02, ['Permissive']), lod2 = simplify(geo, 0.1, 0.05, ['Permissive', 'Prune']);
    // material table -> extras
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ name: vname }));
    mesh.name = vname;
    mesh.userData = { mats, tris: geo.index.count / 3 };
    const lodMesh = new THREE.SkinnedMesh(lod, mesh.material);
    lodMesh.name = vname + '_lod';
    lodMesh.userData = { mats, tris: lod.index.count / 3 };
    const lod2Mesh = new THREE.SkinnedMesh(lod2, mesh.material);
    lod2Mesh.name = vname + '_lod2';
    lod2Mesh.userData = { mats, tris: lod2.index.count / 3 };
    meshes.push(mesh, lodMesh, lod2Mesh);
    console.log(`  ${vname.padEnd(14)} verts ${v0} -> ${v1}, tris ${geo.index.count / 3}, lod tris ${lod.index.count / 3}/${lod2.index.count / 3}; mats: ${mats.map(m => `${m.name}/${m.part}:${Object.keys(T)[m.tint]}`).join(' ')}`);
  }
  // one armature, all meshes bound to it
  const arm = armature;
  arm.removeFromParent();
  for (const ch of arm.children.slice()) if (!ch.isBone) arm.remove(ch);
  out.add(arm);
  arm.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones, boneInverses);
  for (const m of meshes) { out.add(m); m.bind(skeleton, new THREE.Matrix4()); }
  return { scene: out, clips };
}

// int8 normals, uint8 joints, uint8-normalised weights (sum fixed to 255), uint8 material index
function quantise(g) {
  const n = g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position);
  const N = g.attributes.normal, nq = new Int8Array(n * 3);
  for (let i = 0; i < n; i++) { nq[i * 3] = Math.round(N.getX(i) * 127); nq[i * 3 + 1] = Math.round(N.getY(i) * 127); nq[i * 3 + 2] = Math.round(N.getZ(i) * 127); }
  out.setAttribute('normal', new THREE.BufferAttribute(nq, 3, true));
  const J = g.attributes.skinIndex, W = g.attributes.skinWeight;
  const jq = new Uint8Array(n * 4), wq = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const w = [W.getX(i), W.getY(i), W.getZ(i), W.getW(i)], j = [J.getX(i), J.getY(i), J.getZ(i), J.getW(i)];
    const s = w.reduce((a, b) => a + b, 0) || 1;
    const q = w.map(x => Math.round(x / s * 255));
    let d = 255 - q.reduce((a, b) => a + b, 0);
    q[q.indexOf(Math.max(...q))] += d;
    for (let k = 0; k < 4; k++) { wq[i * 4 + k] = q[k]; jq[i * 4 + k] = q[k] ? j[k] : 0; }
  }
  out.setAttribute('skinIndex', new THREE.BufferAttribute(jq, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(wq, 4, true));
  const M = g.attributes.mat, mq = new Uint8Array(n);
  for (let i = 0; i < n; i++) mq[i] = Math.round(M.getX(i));
  out.setAttribute('mat', new THREE.BufferAttribute(mq, 1));
  const idx = g.index.array;
  out.setIndex(new THREE.BufferAttribute(n < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx), 1));
  return out;
}

// simplified LOD (compacted vertex set). Crease splits (same position + material, different normal) are welded
// first so the simplifier does not treat every crease as a seam; LOD normals are the averaged crease normals.
function simplify(g, ratio, err = 0.05, flags = []) {
  const n = g.attributes.position.count, P = g.attributes.position.array, M = g.attributes.mat.array, N = g.attributes.normal;
  const key = new Map(), canon = new Int32Array(n), nsum = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)},${M[i]}`;
    let c = key.get(k); if (c === undefined) { c = i; key.set(k, i); }
    canon[i] = c;
    nsum[c * 3] += N.getX(i); nsum[c * 3 + 1] += N.getY(i); nsum[c * 3 + 2] += N.getZ(i);
  }
  const idx = Uint32Array.from(g.index.array, i => canon[i]);
  const target = Math.floor(idx.length * ratio / 3) * 3;
  const [res] = MeshoptSimplifier.simplify(idx, P, 3, target, err, flags);
  const map = new Int32Array(n).fill(-1); let nv = 0;
  for (const i of res) if (map[i] < 0) map[i] = nv++;
  const out = new THREE.BufferGeometry();
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k], arr = new a.array.constructor(nv * a.itemSize);
    for (let i = 0; i < n; i++) if (map[i] >= 0) for (let c = 0; c < a.itemSize; c++) arr[map[i] * a.itemSize + c] = a.array[i * a.itemSize + c];
    if (k === 'normal') for (let i = 0; i < n; i++) if (map[i] >= 0) {
      const x = nsum[i * 3], y = nsum[i * 3 + 1], z = nsum[i * 3 + 2], l = Math.hypot(x, y, z) || 1;
      arr[map[i] * 3] = Math.round(x / l * 127); arr[map[i] * 3 + 1] = Math.round(y / l * 127); arr[map[i] * 3 + 2] = Math.round(z / l * 127);
    }
    out.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(Uint16Array.from(res, i => map[i]), 1));
  return out;
}

// drop tracks whose value never changes; round times
function optimiseClip(c) {
  const tracks = [];
  for (const t of c.tracks) {
    const v = t.values, s = t.getValueSize();
    let moving = false;
    for (let i = s; i < v.length && !moving; i++) if (Math.abs(v[i] - v[i % s]) > 1e-4) moving = true;
    if (moving) tracks.push(t);
    else { const k = t.clone(); k.times = new Float32Array([0]); k.values = v.slice(0, s); tracks.push(k); }
  }
  return new THREE.AnimationClip(c.name, c.duration, tracks);
}

fs.mkdirSync(outDir, { recursive: true });
for (const gender of ['m', 'f']) {
  console.log('== ' + gender);
  const { scene, clips } = await buildSet(gender);
  const exp = new GLTFExporter();
  const glb = await exp.parseAsync(scene, { binary: true, animations: clips, onlyVisible: false });
  const file = path.join(outDir, `humans_${gender}.glb`);
  fs.writeFileSync(file, Buffer.from(glb));
  console.log(`  -> ${file} ${(glb.byteLength / 1024).toFixed(0)} KB, clips ${clips.map(c => c.name + ':' + c.duration.toFixed(2)).join(' ')}`);
}
