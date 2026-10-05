// Lighting (baseline): global hemisphere + environment.
//
// CONTRACT for builders (architecture, shops, props, parks, transit…):
//   ctx.lighting.addLight({ level, x, y, z, color, intensity, range, kind, dir })
//     kind: 'panel' (ceiling troffer), 'down' (downlight), 'strip' (linear),
//           'sign' (back-lit sign / screen), 'spot', 'lamp'
//     Call during your init(). Lighting decides how to realise them (baked
//     vertex light, nearest-N real lights, light probes…). Returns an id.
//   ctx.lighting.addProbe({ level, x, y, z, radius, mood })   (optional hint)
// afterBuild(): runs once after every build system's init (bake passes).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export class Lighting {
  constructor(ctx) { this.ctx = ctx; this.lights = []; this.probes = []; }
  init() {
    const { engine } = this.ctx;
    const pm = new THREE.PMREMGenerator(engine.renderer);
    engine.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    engine.scene.environmentIntensity = 0.6;
    this.hemi = new THREE.HemisphereLight(0xfff8ee, 0x6a6258, 1.1);
    engine.scene.add(this.hemi);
  }
  addLight(l) { this.lights.push(l); return this.lights.length - 1; }
  addProbe(p) { this.probes.push(p); return this.probes.length - 1; }
  afterBuild() {}
  update(dt) {}
}
