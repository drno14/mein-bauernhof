import * as THREE from 'three/webgpu';
import { SEA_LEVEL } from './world/terrain.js';

/*
 * Reiten: E = aufsitzen / absteigen, W/S = Schritt / zurück, A/D = lenken, Shift = Galopp.
 * Das Pferd gehört dem AnimalManager; hier wird nur gesteuert.
 */
const HORSE = { walk: 3.2, gallop: 10, turn: 1.9, camDist: 6, camHeight: 2.6 };

export class Riding {
  constructor({ terrain, animals, worldCollides }) {
    Object.assign(this, { terrain, animals, worldCollides });
    this.active = null;   // { horse, x, z, heading, speed, saddle }
    this.prompt = '';
  }

  /** Nächstes Pferd in Reichweite oder null. */
  nearest(pos, max = 3.2) {
    const h = this.animals.findRideable(pos, max);
    return h ?? null;
  }

  tryEnter(pos) {
    const n = this.nearest(pos);
    if (!n) return false;
    this.animals.setRidden(n.animal, true);
    const o = n.object3d;
    const box = new THREE.Box3().setFromObject(o, true);
    const saddle = (box.max.y - box.min.y) * 0.72;   // Rücken ≈ 72 % der Gesamthöhe inkl. Kopf
    this.active = { horse: n, x: o.position.x, z: o.position.z, heading: o.rotation.y, speed: 0, saddle };
    return true;
  }

  /** Absteigen: freien Platz neben dem Pferd suchen. Gibt {x,z} oder null zurück. */
  exit() {
    const a = this.active;
    if (!a) return null;
    const s = Math.sin(a.heading), c = Math.cos(a.heading);
    for (const [lx, lz] of [[1.6, 0], [-1.6, 0], [0, -2.4], [0, 2.4], [2.4, 1.2], [-2.4, 1.2]]) {
      const wx = a.x + lx * c + lz * s, wz = a.z - lx * s + lz * c;
      if (this.terrain.height(wx, wz) > SEA_LEVEL - 0.6 && !this.worldCollides(wx, wz, -Infinity, 0.35)) {
        this.animals.setRidden(a.horse.animal, false);
        a.horse.animal.play?.('idle');
        this.active = null;
        return { x: wx, z: wz };
      }
    }
    return null;
  }

  /** Reiten. input = { throttle, steer, boost }. Gibt die Sitzposition zurück. */
  drive(dt, input) {
    const a = this.active, o = a.horse.object3d, { terrain } = this;
    const target = input.throttle > 0 ? (input.boost ? HORSE.gallop : HORSE.walk) : input.throttle < 0 ? -1.5 : 0;
    a.speed += (target - a.speed) * (1 - Math.exp(-3 * dt));
    a.heading += input.steer * HORSE.turn * dt * (a.speed >= 0 ? 1 : -1);
    const s = Math.sin(a.heading), c = Math.cos(a.heading);
    const nx = a.x + s * a.speed * dt, nz = a.z + c * a.speed * dt;
    const h0 = terrain.height(a.x, a.z), h1 = terrain.height(nx, nz);
    const step = Math.hypot(nx - a.x, nz - a.z) || 1e-6;
    const ok = h1 > SEA_LEVEL - 0.8 && (h1 - h0) / step < 1.0 && !this.worldCollides(nx + s, nz + c, -Infinity, 0.6);
    if (ok) { a.x = nx; a.z = nz; } else a.speed *= 0.3;
    o.position.set(a.x, terrain.height(a.x, a.z), a.z);
    o.rotation.y = a.heading;
    const sp = Math.abs(a.speed), anim = sp > 5.5 ? 'run' : sp > 0.3 ? 'walk' : 'idle';
    a.horse.animal.play?.(anim, anim === 'run' ? sp / 9 : anim === 'walk' ? Math.max(sp / 2.5, 0.6) : 1);
    return { x: a.x, y: o.position.y + a.saddle, z: a.z, heading: a.heading, speed: a.speed, cfg: HORSE };
  }

  update(playerPos) {
    if (this.active) this.prompt = 'E – absteigen · W/S Schritt/zurück · A/D lenken · Shift Galopp';
    else this.prompt = this.nearest(playerPos) ? 'E – aufs Pferd steigen' : '';
  }
}
