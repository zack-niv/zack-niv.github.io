// Lighting (baseline): global hemisphere + environment. The rendering work
// replaces this with zone-aware lighting, env maps, sun/shadows for outdoors.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export class Lighting {
  constructor(ctx) { this.ctx = ctx; }
  init() {
    const { engine } = this.ctx;
    const pm = new THREE.PMREMGenerator(engine.renderer);
    engine.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    engine.scene.environmentIntensity = 0.6;
    this.hemi = new THREE.HemisphereLight(0xfff8ee, 0x6a6258, 1.1);
    engine.scene.add(this.hemi);
  }
  update(dt) {}
}
