import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEA_LEVEL } from './world/terrain.js';
import { propMaterial } from './world/props.js';

/*
 * Der Hof: Münzen, Ställe, Tiere kaufen, Felder.
 *   B = Menü (bauen & kaufen)     F = einsammeln / säen / ernten
 * Ställe stehen vor dir, wenn du sie baust. Die Tiere darin liefern von allein (Eier, Wolle, Milch, Dünger);
 * F beim Stall verkauft alles. Felder: säen, warten, ernten.
 */

const STORE_KEY = 'bauernhof-v1';
const START_COINS = 150;

export const ANIMALS = {
  chick: { name: 'Huhn',  icon: '🐔', price: 30,  item: 'egg',  every: 25 },
  sheep: { name: 'Schaf', icon: '🐑', price: 80,  item: 'wool', every: 45 },
  cow:   { name: 'Kuh',   icon: '🐄', price: 150, item: 'milk', every: 40 },
  horse: { name: 'Pferd', icon: '🐴', price: 250, item: 'dung', every: 60 },
};
const ITEMS = {
  egg:  { icon: '🥚', name: 'Eier',   value: 4 },
  wool: { icon: '🧶', name: 'Wolle',  value: 14 },
  milk: { icon: '🥛', name: 'Milch',  value: 22 },
  dung: { icon: '🌱', name: 'Dünger', value: 20 },
};
const CROPS = {
  weizen:  { name: 'Weizen',  icon: '🌾', seed: 8,  time: 40,  value: 36 },
  karotte: { name: 'Karotte', icon: '🥕', seed: 16, time: 70,  value: 80 },
  kuerbis: { name: 'Kürbis',  icon: '🎃', seed: 30, time: 120, value: 190 },
};
// Stall-Arten: Platz, Tiere, Preis. Das Gestüt ist nur für Pferde, liefert mehr Dünger und bekommt Fohlen.
const PENS = {
  stall:   { name: 'Stall',         icon: '🏠', w: 12, d: 9,  cap: 6,  cost: 200, gate: 3.2, wall: 0xb8432f, roof: 0x6b2a1e, silo: true,
             info: '6 Tiere' },
  gross:   { name: 'Grosser Stall', icon: '🏚️', w: 18, d: 13, cap: 14, cost: 600, gate: 4,   wall: 0xb8432f, roof: 0x6b2a1e, silo: true,
             info: '14 Tiere, viel Platz' },
  gestuet: { name: 'Gestüt',        icon: '🐎', w: 20, d: 14, cap: 8,  cost: 700, gate: 4,   wall: 0x3f5f8a, roof: 0x2b3b52, silo: false,
             only: ['horse'], breed: 150, dungMul: 1.6, info: 'nur Pferde, 8 Plätze, Fohlen, mehr Dünger' },
};
// Hofladen: holt Waren aus den Ställen in der Nähe und verkauft sie mit Aufschlag an Kunden
const SHOP = { w: 5, d: 4, cost: 300, bonus: 1.3, every: 3, range: 70, tillCap: 3000 };
const FIELD = { size: 6, cost: 40, grid: 4 };
const COLLECT_MARGIN = 3.5;
const STORE_CAP = 20;

// ---------- Geometrie-Helfer (alles mit Vertexfarben → ein Material) ----------
function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
const merge = (parts) => mergeGeometries(parts, false);
const bx = (w, h, d, x, y, z, hex) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
function boxRot(w, h, d, x, y, z, ry, rx, hex) {
  _e.set(rx, ry, 0); _q.setFromEuler(_e);
  const g = new THREE.BoxGeometry(w, h, d).applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s));
  return paint(g, hex);
}

/** Scheune (lokal: Vorderseite +Z, Ursprung am Boden in der Mitte), samt Silo. */
function barnGeometry(bw, def) {
  const bd = 3.4, wh = 2.8, rise = 1.7;
  const wall = def.wall, trim = 0xf3ece0, roofC = def.roof, wood = 0x5a3820;
  const parts = [
    bx(bw, wh + 1.5, bd, 0, wh / 2 - 0.75, 0, wall),                     // Wände + Fundament
    bx(bw + 0.05, 0.14, bd + 0.05, 0, 0.07, 0, trim),                     // Sockel
  ];
  for (const sx of [-1, 1]) parts.push(bx(0.16, wh, bd + 0.06, sx * bw / 2, wh / 2, 0, trim));
  // Giebel (Dreiecke an den Schmalseiten)
  const tri = new THREE.Shape(); tri.moveTo(-bd / 2, 0); tri.lineTo(bd / 2, 0); tri.lineTo(0, rise); tri.closePath();
  const gable = new THREE.ExtrudeGeometry(tri, { depth: bw, bevelEnabled: false });
  gable.rotateY(Math.PI / 2).translate(-bw / 2, wh, 0);
  parts.push(paint(gable, wall));
  // Dach (etwas überstehend)
  const rs = new THREE.Shape(); rs.moveTo(-bd / 2 - 0.45, -0.08); rs.lineTo(bd / 2 + 0.45, -0.08); rs.lineTo(bd / 2 + 0.45, 0.04); rs.lineTo(0.05, rise + 0.14);
  rs.lineTo(-0.05, rise + 0.14); rs.lineTo(-bd / 2 - 0.45, 0.04); rs.closePath();
  const roof = new THREE.ExtrudeGeometry(rs, { depth: bw + 0.7, bevelEnabled: false });
  roof.rotateY(Math.PI / 2).translate(-bw / 2 - 0.35, wh - 0.02, 0);
  parts.push(paint(roof, roofC));
  // Doppeltor mit weissen Kreuzen
  const dz = bd / 2 + 0.03, dw = 1.9, dh = 2.2;
  for (const sx of [-1, 1]) {
    parts.push(bx(dw / 2 - 0.04, dh, 0.08, sx * dw / 4, dh / 2, dz, wood));
    parts.push(boxRot(0.1, Math.hypot(dw / 2, dh) - 0.2, 0.05, sx * dw / 4, dh / 2, dz + 0.05, 0, 0, trim).applyMatrix4(
      new THREE.Matrix4().makeRotationZ(0)));
  }
  parts.push(bx(dw + 0.2, 0.12, 0.1, 0, dh + 0.06, dz + 0.02, trim));
  parts.push(bx(0.12, dh + 0.1, 0.1, -dw / 2 - 0.04, dh / 2, dz + 0.02, trim), bx(0.12, dh + 0.1, 0.1, dw / 2 + 0.04, dh / 2, dz + 0.02, trim));
  // Kreuze als zwei Latten pro Torflügel (Diagonalen)
  for (const sx of [-1, 1]) for (const sg of [-1, 1]) {
    const L = Math.hypot(dw / 2, dh) - 0.1, ang = Math.atan2(dh, dw / 2) * sg;
    const g = new THREE.BoxGeometry(L, 0.09, 0.05).rotateZ(ang).translate(sx * dw / 4, dh / 2, dz + 0.06);
    parts.push(paint(g, trim));
  }
  // Fenster und Heuluke
  for (const sx of [-1, 1]) {
    parts.push(bx(0.9, 0.8, 0.06, sx * (bw / 2 - 1.1), 1.7, dz, trim), bx(0.7, 0.6, 0.08, sx * (bw / 2 - 1.1), 1.7, dz + 0.01, 0x35546e));
  }
  parts.push(bx(1.0, 0.9, 0.06, 0, wh + 0.55, dz - 0.02, wood), bx(1.1, 0.1, 0.08, 0, wh + 1.05, dz, trim));
  // Silo
  const sx = bw / 2 + 1.5;
  if (def.silo) {
  parts.push(paint(new THREE.CylinderGeometry(0.95, 0.95, 5.0, 14).translate(sx, 2.0, -0.2), 0xc9ccd0));
  parts.push(paint(new THREE.ConeGeometry(1.05, 0.9, 14).translate(sx, 5.0, -0.2), 0x8d939a));
  for (const y of [0.9, 2.2, 3.5]) parts.push(paint(new THREE.CylinderGeometry(0.98, 0.98, 0.1, 14).translate(sx, y, -0.2), 0x9aa0a6));
  }
  return { geo: merge(parts), bd, siloX: sx };
}

// ---------- Pflanzen: eine zusammengesetzte Geometrie je Sorte, Höhe 1 = reif ----------
const CROP_GEO = {};
function cropGeo(kind) {
  if (CROP_GEO[kind]) return CROP_GEO[kind];
  const P = [];
  if (kind === 'weizen') {
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05, r = 0.1 + (i % 2) * 0.07, x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.8 + (i % 3) * 0.08;
      P.push(paint(new THREE.CylinderGeometry(0.012, 0.018, h, 5).translate(x, h / 2, z), 0xb7c545));
      P.push(paint(new THREE.ConeGeometry(0.05, 0.26, 6).translate(x, h + 0.1, z), 0xe3b93c));
    }
  } else if (kind === 'karotte') {
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05, g = new THREE.ConeGeometry(0.045, 0.5, 5).translate(0, 0.25, 0).rotateZ(0.35).rotateY(a).translate(0, 0.1, 0);
      P.push(paint(g, i % 2 ? 0x4f9a3a : 0x5fae44));
    }
    P.push(paint(new THREE.ConeGeometry(0.09, 0.28, 7).rotateX(Math.PI).translate(0, 0.08, 0), 0xef8a1c));
  } else {
    P.push(paint(new THREE.SphereGeometry(0.34, 9, 7).scale(1, 0.75, 1).translate(0, 0.26, 0), 0xe9821b));
    P.push(paint(new THREE.CylinderGeometry(0.04, 0.06, 0.14, 5).translate(0, 0.54, 0), 0x4f7a2a));
    P.push(paint(new THREE.BoxGeometry(0.5, 0.03, 0.34).rotateZ(0.3).translate(0.42, 0.32, 0.12), 0x4f9a3a));
    P.push(paint(new THREE.BoxGeometry(0.4, 0.03, 0.3).rotateZ(-0.3).rotateY(2).translate(-0.35, 0.3, -0.25), 0x5aa83a));
  }
  return (CROP_GEO[kind] = merge(P));
}

const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });

export class Hof {
  constructor({ scene, terrain, animals, player, getYaw, blocked }) {
    Object.assign(this, { scene, terrain, animals, player, getYaw, blocked });
    this.pens = []; this.fields = []; this.shops = []; this.free = [];
    this.coins = START_COINS;
    this.crop = 'weizen';
    this.open = false;
    this.prompt = '';
    this.pp = new THREE.Vector3();
    this.time = 0;
    animals.penBrain = (a, dt) => this.penBrain(a, dt);
    this._buildUi();
    this._load();
    addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Escape' && this.open) this.toggle(false);
      else if (e.code === 'KeyB') this.toggle();
      else if (e.code === 'KeyF' && !this.open) this.act();
    });
  }

  // ---------- Speichern ----------
  _load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { /* neu anfangen */ }
    this.saved = d;
    if (d) { this.coins = d.coins ?? START_COINS; this.crop = CROPS[d.crop] ? d.crop : 'weizen'; }
  }
  _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        coins: this.coins, crop: this.crop,
        pens: this.pens.map((p) => ({ kind: p.kind, x: p.x, z: p.z, yaw: p.yaw, animals: p.rec.animals, store: p.rec.store, acc: p.rec.acc })),
        shops: this.shops.map((q) => ({ x: q.x, z: q.z, yaw: q.yaw, till: q.till })),
        fields: this.fields.map((f) => ({ x: f.x, z: f.z, yaw: f.yaw, crop: f.crop, t: f.t })),
        free: this.free.filter((e) => !e.a.dead).map((e) => ({ type: e.type, x: e.a.root.position.x, z: e.a.root.position.z })),
      }));
    } catch { /* ignorieren */ }
  }

  /** Nach dem Laden der Welt aufrufen: gespeicherten Hof aufbauen oder den Start-Stall hinstellen. */
  init() {
    const d = this.saved;
    if (d?.pens) {
      for (const r of d.pens) this._makePen(r);
      for (const r of d.fields ?? []) this._makeField(r);
      for (const r of d.shops ?? []) this._makeShop(r);
      for (const r of d.free ?? []) this._spawnFree(r.type, r.x, r.z);
    } else {
      const spot = this._findSpot();
      this._makePen({ kind: 'stall', x: spot.x, z: spot.z, yaw: spot.yaw, animals: ['chick', 'chick', 'sheep', 'horse'], store: {}, acc: {} });
      this._save();
    }
    this._renderCoins();
  }

  /** Freier Platz in der Nähe des Starts (Tor zeigt zum Spielstart). */
  _findSpot() {
    for (const [x, z] of [[0, -18], [14, -14], [-14, -14], [0, 19], [18, 2], [-18, 2], [10, 20], [-10, 20]]) {
      const yaw = Math.atan2(-x, -z) + 0;   // Tor (+Z lokal) zeigt zum Ursprung
      if (this._canPlacePen(x, z, yaw, PENS.stall)) return { x, z, yaw };
    }
    return { x: 0, z: -18, yaw: 0 };
  }

  // ---------- Koordinaten ----------
  _local(o, lx, lz) { const c = Math.cos(o.yaw), s = Math.sin(o.yaw); return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c }; }
  _toLocal(o, x, z) { const dx = x - o.x, dz = z - o.z, c = Math.cos(o.yaw), s = Math.sin(o.yaw); return { lx: dx * c - dz * s, lz: dx * s + dz * c }; }
  _h(x, z) { return this.terrain.height(x, z); }

  _groundMesh(o, w, d, nx, nz, colorFn, lift = 0.1) {
    const pos = [], col = [], idx = [], c = new THREE.Color();
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const w2 = this._local(o, (i / nx - 0.5) * w, (j / nz - 0.5) * d);
      pos.push(w2.x, this._h(w2.x, w2.z) + lift, w2.z);
      c.set(colorFn(i, j)); col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, e = a + nx + 1, f = e + 1;
      idx.push(a, e, b, b, e, f);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, groundMat); m.receiveShadow = true; return m;
  }

  _label() {
    const el = document.createElement('div');
    el.className = 'npc-label talking'; el.innerHTML = '<b></b><span></span>';
    document.getElementById('labels')?.appendChild(el);
    return el;
  }

  // ---------- Ställe ----------
  _makePen(rec) {
    const def = PENS[rec.kind] ?? PENS.stall;
    const pen = { kind: PENS[rec.kind] ? rec.kind : 'stall', def, x: rec.x, z: rec.z, yaw: rec.yaw, w: def.w, d: def.d, breedT: 0, rec: { animals: [...rec.animals], store: { ...(rec.store ?? {}) }, acc: { ...(rec.acc ?? {}) } },
      obs: [], list: [], group: new THREE.Group(), restockT: 2 };
    const hw = def.w / 2, hd = def.d / 2, G = def.gate;
    const g = pen.group;

    // Boden im Stall (folgt dem Gelände)
    g.add(this._groundMesh(pen, def.w, def.d, def.w, def.d, (i, j) => ((i + j) % 2 ? 0xcdb98a : 0xc4b07f)));

    // Zaun: Pfosten alle ~2 m, zwei Latten; vorne ein Tor
    const fence = [], ring = [];
    const side = (ax, az, bx2, bz2) => {
      const L = Math.hypot(bx2 - ax, bz2 - az), n = Math.max(1, Math.round(L / 2));
      for (let i = 0; i < n; i++) ring.push([ax + (bx2 - ax) * i / n, az + (bz2 - az) * i / n, ax + (bx2 - ax) * (i + 1) / n, az + (bz2 - az) * (i + 1) / n]);
    };
    side(-hw, -hd, hw, -hd); side(hw, -hd, hw, hd); side(hw, hd, G / 2, hd); side(-G / 2, hd, -hw, hd); side(-hw, hd, -hw, -hd);
    const post = (lx, lz) => { const w = this._local(pen, lx, lz); fence.push(bx(0.16, 1.3, 0.16, w.x, this._h(w.x, w.z) + 0.55, w.z, 0x8a5a2c)); };
    for (const [ax, az, bx2, bz2] of ring) {
      post(ax, az); post(bx2, bz2);
      const A = this._local(pen, ax, az), B = this._local(pen, bx2, bz2);
      const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz), ya = this._h(A.x, A.z), yb = this._h(B.x, B.z), phi = Math.atan2(dx, dz);
      for (const yy of [0.45, 0.95]) fence.push(boxRot(0.07, 0.1, L, (A.x + B.x) / 2, (ya + yb) / 2 + yy, (A.z + B.z) / 2, phi, -Math.atan2(yb - ya, L), 0xa8743f));
      pen.obs.push({ type: 'obb', x: (A.x + B.x) / 2, z: (A.z + B.z) / 2, cos: Math.cos(phi), sin: Math.sin(phi), hw: 0.12, hd: L / 2 + 0.08, top: 1.3 });
    }
    post(G / 2, hd); post(-G / 2, hd);
    // Futtertrog & Heuballen
    const tr = this._local(pen, hw - 2.2, 0.5);
    fence.push(bx(1.8, 0.4, 0.6, tr.x, this._h(tr.x, tr.z) + 0.2, tr.z, 0x7a5230).applyMatrix4(new THREE.Matrix4().makeRotationY(0)));
    const hb = this._local(pen, -hw + 1.5, 0.8);
    fence.push(paint(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 12).rotateZ(Math.PI / 2).translate(hb.x, this._h(hb.x, hb.z) + 0.45, hb.z), 0xe6c34a));
    const fm = new THREE.Mesh(merge(fence), propMaterial); fm.castShadow = true; fm.receiveShadow = true; g.add(fm);

    // Scheune hinten, Silo daneben
    const bw = def.w - 5;
    const { geo, bd, siloX } = barnGeometry(bw, def);
    const bp = this._local(pen, -1.2, -hd + bd / 2 + 0.6);
    geo.rotateY(pen.yaw).translate(bp.x, this._h(bp.x, bp.z), bp.z);
    const barn = new THREE.Mesh(geo, propMaterial); barn.castShadow = true; barn.receiveShadow = true; g.add(barn);
    pen.obs.push({ type: 'obb', x: bp.x, z: bp.z, cos: Math.cos(pen.yaw), sin: Math.sin(pen.yaw), hw: bw / 2, hd: bd / 2, top: 8 });
    if (def.silo) {
      const sp = this._local(pen, -1.2 + siloX, -hd + bd / 2 + 0.4);
      pen.obs.push({ type: 'circle', x: sp.x, z: sp.z, r: 1.0, top: 8 });
    }

    // Sammelkiste und Schild vor dem Tor
    const crate = this._local(pen, G / 2 + 0.9, hd + 0.8);
    pen.labelPos = crate;
    const cm = new THREE.Mesh(merge([bx(0.9, 0.55, 0.6, 0, 0.28, 0, 0x6a4020), bx(0.95, 0.06, 0.65, 0, 0.58, 0, 0x8a5a2c)]).rotateY(pen.yaw).translate(crate.x, this._h(crate.x, crate.z), crate.z), propMaterial);
    cm.castShadow = true; g.add(cm);

    pen.label = this._label();
    this.scene.add(g);
    this.pens.push(pen);
    for (const t of pen.rec.animals) this._spawnInPen(pen, t);
    return pen;
  }

  _spawnInPen(pen, type, entry = null) {
    const lx = (Math.random() - 0.5) * (pen.w - 4), lz = (Math.random() - 0.5) * (pen.d - 4);
    const w = this._local(pen, lx, lz);
    const a = this.animals.spawnAt(type, w.x, w.z);
    if (!a) return null;
    a.pen = pen; a.startPet = true;
    a.herd = { x: w.x, z: w.z, r: 2, panicUntil: 0 };
    const e = entry ?? { type, a };
    e.a = a; e.wasRidden = false;
    if (!entry) pen.list.push(e); else pen.list.push(e);
    return a;
  }

  _spawnFree(type, x, z) {
    const a = this.animals.spawnAt(type, x, z);
    if (!a) return;
    a.pet = true; a.owned = true;
    this.free.push({ type, a });
  }

  /** Verhalten der Stalltiere: gemächlich im Zaun herumlaufen. */
  penBrain(a, dt) {
    const pen = a.pen;
    a.penT = (a.penT ?? Math.random() * 3) - dt;
    const p = a.root.position;
    if (!a.penTarget || (a.penT <= 0 && !a.penMoving)) {
      a.penTarget = this._local(pen, (Math.random() - 0.5) * (pen.w - 4), (Math.random() - 0.5) * (pen.d - 4));
      a.penMoving = true; a.penT = 12;
    }
    const dx = a.penTarget.x - p.x, dz = a.penTarget.z - p.z;
    if (a.penMoving && (Math.hypot(dx, dz) < 0.7 || a.penT <= 0)) { a.penMoving = false; a.penT = 2 + Math.random() * 6; }
    if (!a.penMoving) { if (a.penT <= 0) a.penTarget = null; return { want: 0 }; }
    return { desired: Math.atan2(dx, dz), want: a.sp.walk };
  }

  *obstacles(x, z) {
    for (const pen of this.pens) {
      if (Math.abs(pen.x - x) > 25 || Math.abs(pen.z - z) > 25) continue;
      yield* pen.obs;
    }
    for (const q of this.shops) {
      if (Math.abs(q.x - x) > 25 || Math.abs(q.z - z) > 25) continue;
      yield* q.obs;
    }
  }

  // ---------- Felder ----------
  _makeField(rec) {
    const f = { x: rec.x, z: rec.z, yaw: rec.yaw, crop: rec.crop ?? null, t: rec.t ?? 0, group: new THREE.Group(), plants: [], shown: null };
    const S = FIELD.size;
    f.group.add(this._groundMesh(f, S, S, 12, 12, (i) => (i % 2 ? 0x6b4a2b : 0x5a3d22), 0.08));
    f.label = this._label();
    this.scene.add(f.group);
    this.fields.push(f);
    this._showCrop(f);
    return f;
  }

  _showCrop(f) {
    for (const m of f.plants) f.group.remove(m);
    f.plants = []; f.shown = f.crop;
    if (!f.crop) return;
    const geo = cropGeo(f.crop), G = FIELD.grid, S = FIELD.size, step = S / G;
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const w = this._local(f, (i + 0.5) * step - S / 2, (j + 0.5) * step - S / 2);
      const m = new THREE.Mesh(geo, propMaterial);
      m.position.set(w.x, this._h(w.x, w.z) + 0.05, w.z); m.rotation.y = (i * 7 + j * 3) % 6;
      m.castShadow = true; m.receiveShadow = true;
      f.group.add(m); f.plants.push(m);
    }
  }

  _growth(f) { return f.crop ? Math.min(1, f.t / CROPS[f.crop].time) : 0; }

  // ---------- Bauen ----------
  _terrainOk(o, w, d) {
    let lo = Infinity, hi = -Infinity;
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      const p = this._local(o, ix * (w / 2 + 0.5), iz * (d / 2 + 0.5));
      const h = this._h(p.x, p.z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      if (h < SEA_LEVEL + 0.4) return 'Hier ist es zu nass.';
    }
    return hi - lo > 2.5 ? 'Hier ist es zu steil.' : null;
  }
  _spacingOk(x, z, r) {
    return !this.pens.some((q) => Math.hypot(q.x - x, q.z - z) < Math.max(q.w, q.d) / 2 + r + 2)
      && !this.fields.some((q) => Math.hypot(q.x - x, q.z - z) < r + FIELD.size / 2 + 1)
      && !this.shops.some((q) => Math.hypot(q.x - x, q.z - z) < r + 4);
  }
  _canPlacePen(x, z, yaw, def) {
    const o = { x, z, yaw };
    if (this._terrainOk(o, def.w, def.d)) return false;
    for (let ix = -2; ix <= 2; ix++) for (let iz = -2; iz <= 2; iz++) {
      const p = this._local(o, ix * (def.w / 4 + 0.3), iz * (def.d / 4 + 0.3));
      if (this.blocked?.(p.x, p.z)) return false;
    }
    return this._spacingOk(x, z, Math.max(def.w, def.d) / 2);
  }

  buildPen(kind = 'stall') {
    const def = PENS[kind];
    if (this.coins < def.cost) return this.toast(`Dir fehlen noch Münzen für: ${def.name}.`);
    const p = this.player.position, yaw = this.getYaw(), dist = 3 + def.d / 2 + 1;
    const x = p.x + Math.sin(yaw) * dist, z = p.z + Math.cos(yaw) * dist, hy = yaw + Math.PI;
    const err = this._terrainOk({ x, z, yaw: hy }, def.w, def.d);
    if (err) return this.toast(err);
    if (!this._canPlacePen(x, z, hy, def)) return this.toast('Hier ist etwas im Weg oder schon etwas gebaut. Such dir mehr Platz.');
    this.coins -= def.cost;
    this._makePen({ kind, x, z, yaw: hy, animals: [], store: {}, acc: {} });
    this._done(`${def.icon} ${def.name} gebaut! Kaufe jetzt Tiere dafür.`);
  }

  // ---------- Hofladen ----------
  _makeShop(rec) {
    const q = { x: rec.x, z: rec.z, yaw: rec.yaw, till: rec.till ?? 0, acc: 0, group: new THREE.Group(), obs: [] };
    const P = [], stripe = [0xd9453a, 0xf5efe3];
    // Boden (Holzbretter), Tresen, Pfosten, gestreifte Markise, Kisten mit Obst und Gemüse, Schild
    P.push(bx(5, 0.12, 4, 0, 0.06, 0, 0xb08a5a));
    P.push(bx(4.2, 1.0, 0.9, 0, 0.55, -0.9, 0x7a5230), bx(4.4, 0.1, 1.1, 0, 1.08, -0.9, 0xc9a26b));
    for (const sx of [-2.1, 2.1]) for (const sz of [-1.8, 1.6]) P.push(bx(0.14, 2.9, 0.14, sx, 1.5, sz, 0x6a4020));
    for (let i = 0; i < 10; i++) P.push(boxRot(0.5, 0.06, 4.0, -2.25 + i * 0.5, 3.0 - i * 0.0, -0.1, 0, 0.18, stripe[i % 2]));
    P.push(bx(2.6, 0.5, 0.1, 0, 3.25, 1.8, 0x3f2a18), bx(2.4, 0.34, 0.12, 0, 3.25, 1.8, 0xf3ece0));
    const crate = (x, z, hex, r) => {
      P.push(bx(0.8, 0.35, 0.6, x, 0.3, z, 0x8a5a2c));
      for (let k = 0; k < 6; k++) P.push(paint(new THREE.SphereGeometry(r, 7, 6).translate(x - 0.25 + (k % 3) * 0.25, 0.55, z - 0.12 + Math.floor(k / 3) * 0.24), hex));
    };
    crate(-1.4, 0.7, 0xd9453a, 0.11); crate(-0.4, 0.8, 0xef8a1c, 0.12); crate(0.7, 0.7, 0x6fae3f, 0.12); crate(1.7, 0.8, 0xf2d04a, 0.1);
    P.push(bx(0.9, 0.9, 0.9, 1.6, 0.5, -1.5, 0xe6c34a));   // Heuballen-Kiste hinter dem Tresen
    const geo = merge(P).rotateY(q.yaw).translate(q.x, this._h(q.x, q.z), q.z);
    const m = new THREE.Mesh(geo, propMaterial); m.castShadow = true; m.receiveShadow = true; q.group.add(m);
    q.obs.push({ type: 'obb', x: this._local(q, 0, -0.9).x, z: this._local(q, 0, -0.9).z, cos: Math.cos(q.yaw), sin: Math.sin(q.yaw), hw: 2.2, hd: 0.55, top: 3 });
    q.label = this._label();
    this.scene.add(q.group);
    this.shops.push(q);
    return q;
  }

  buildShop() {
    if (this.coins < SHOP.cost) return this.toast('Dir fehlen noch Münzen für einen Hofladen.');
    const p = this.player.position, yaw = this.getYaw(), dist = SHOP.d / 2 + 3;
    const x = p.x + Math.sin(yaw) * dist, z = p.z + Math.cos(yaw) * dist, hy = yaw + Math.PI;
    const o = { x, z, yaw: hy };
    const err = this._terrainOk(o, SHOP.w, SHOP.d);
    if (err) return this.toast(err);
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      const q = this._local(o, ix * SHOP.w / 2, iz * SHOP.d / 2);
      if (this.blocked?.(q.x, q.z)) return this.toast('Hier ist etwas im Weg.');
    }
    if (!this._spacingOk(x, z, 3)) return this.toast('Hier ist schon etwas gebaut.');
    this.coins -= SHOP.cost;
    this._makeShop({ x, z, yaw: hy, till: 0 });
    this._done('🧺 Hofladen eröffnet! Er holt Waren aus den Ställen in der Nähe und verkauft sie teurer. F leert die Kasse.');
  }

  buildField() {
    if (this.coins < FIELD.cost) return this.toast('Dir fehlen noch Münzen für ein Feld.');
    const p = this.player.position, yaw = this.getYaw(), dist = FIELD.size / 2 + 2.5;
    const x = p.x + Math.sin(yaw) * dist, z = p.z + Math.cos(yaw) * dist;
    const o = { x, z, yaw };
    const err = this._terrainOk(o, FIELD.size, FIELD.size);
    if (err) return this.toast(err);
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      const q = this._local(o, ix * FIELD.size / 2, iz * FIELD.size / 2);
      if (this.blocked?.(q.x, q.z)) return this.toast('Hier ist etwas im Weg.');
    }
    if (this.fields.some((q) => Math.hypot(q.x - x, q.z - z) < FIELD.size + 0.5) || this.pens.some((q) => Math.hypot(q.x - x, q.z - z) < 11)) return this.toast('Hier ist schon etwas gebaut.');
    this.coins -= FIELD.cost;
    this._makeField({ x, z, yaw, crop: null, t: 0 });
    this._done('Feld angelegt! Stell dich darauf und drücke F zum Säen.');
  }

  buyAnimal(type) {
    const T = ANIMALS[type];
    const p = this.player.position;
    let best = null, bd = Infinity;
    for (const pen of this.pens) {
      if (pen.rec.animals.length >= pen.def.cap || (pen.def.only && !pen.def.only.includes(type))) continue;
      const d = Math.hypot(pen.x - p.x, pen.z - p.z);
      if (d < bd) { bd = d; best = pen; }
    }
    if (!this.pens.length) return this.toast('Du brauchst zuerst einen Stall.');
    if (!best) return this.toast(type === 'horse' ? 'Kein Stall mit freiem Platz – ein Gestüt hat extra Platz für Pferde.' : 'Alle Ställe sind voll. Baue einen neuen oder grösseren!');
    if (this.coins < T.price) return this.toast('Dir fehlen noch Münzen.');
    this.coins -= T.price;
    best.rec.animals.push(type);
    this._spawnInPen(best, type);
    this._done(`${T.icon} ${T.name} gekauft – ${best.rec.animals.length}/${best.def.cap} im ${best.def.name}.`);
  }

  _done(msg) { this.toast(msg); this._save(); this._renderCoins(); this.render(); }

  // ---------- Aktion (F) ----------
  _near() {
    const pl = this.player.position;
    let best = null, bd = Infinity;
    for (const f of this.fields) {
      const { lx, lz } = this._toLocal(f, pl.x, pl.z), m = FIELD.size / 2 + 1.5;
      if (Math.abs(lx) > m || Math.abs(lz) > m) continue;
      const d = Math.hypot(lx, lz); if (d < bd) { bd = d; best = { kind: 'field', o: f }; }
    }
    for (const pen of this.pens) {
      const { lx, lz } = this._toLocal(pen, pl.x, pl.z);
      if (Math.abs(lx) > pen.w / 2 + COLLECT_MARGIN || Math.abs(lz) > pen.d / 2 + COLLECT_MARGIN) continue;
      const d = Math.hypot(lx, lz); if (d < bd) { bd = d; best = { kind: 'pen', o: pen }; }
    }
    for (const q of this.shops) {
      const { lx, lz } = this._toLocal(q, pl.x, pl.z);
      if (Math.abs(lx) > SHOP.w / 2 + 3 || Math.abs(lz) > SHOP.d / 2 + 3) continue;
      const d = Math.hypot(lx, lz); if (d < bd) { bd = d; best = { kind: 'shop', o: q }; }
    }
    return best;
  }

  act() {
    const n = this._near();
    if (!n) return;
    if (n.kind === 'shop') {
      const q = n.o;
      if (q.till <= 0) return this.toast('Die Kasse ist leer – der Laden verkauft die Waren aus den Ställen in der Nähe.');
      this.coins += q.till; const t = q.till; q.till = 0;
      return this._done(`🧺 Kasse geleert: +${t} 🪙`);
    }
    if (n.kind === 'pen') {
      const pen = n.o, st = pen.rec.store;
      let sum = 0, txt = [];
      for (const [k, c] of Object.entries(st)) if (c > 0) { sum += c * ITEMS[k].value; txt.push(`${ITEMS[k].icon}×${c}`); }
      if (sum <= 0) return this.toast('Noch nichts da – die Tiere arbeiten daran.');
      pen.rec.store = {};
      this.coins += sum;
      this._done(`+${sum} 🪙  (${txt.join(' ')})`);
    } else {
      const f = n.o;
      if (!f.crop) {
        const C = CROPS[this.crop];
        if (this.coins < C.seed) return this.toast('Dir fehlen die Münzen für das Saatgut.');
        this.coins -= C.seed; f.crop = this.crop; f.t = 0; this._showCrop(f);
        this._done(`${C.icon} ${C.name} gesät.`);
      } else if (this._growth(f) >= 1) {
        const C = CROPS[f.crop];
        this.coins += C.value; f.crop = null; f.t = 0; this._showCrop(f);
        this._done(`+${C.value} 🪙  ${C.icon} ${C.name} geerntet!`);
      } else this.toast(`${CROPS[f.crop].icon} wächst noch … ${Math.round(this._growth(f) * 100)} %`);
    }
  }

  // ---------- pro Bild ----------
  update(dt, playerPos, camera) {
    this.time += dt;
    const w = innerWidth, h = innerHeight;
    let prompt = '';
    const near = this._near();
    for (const pen of this.pens) {
      // Erträge
      const counts = {};
      for (const t of pen.rec.animals) counts[t] = (counts[t] ?? 0) + 1;
      for (const [t, n] of Object.entries(counts)) {
        const T = ANIMALS[t];
        pen.rec.acc[t] = (pen.rec.acc[t] ?? 0) + dt * n * (T.item === 'dung' && pen.def.dungMul ? pen.def.dungMul : 1);
        if (pen.rec.acc[t] >= T.every) {
          const k = Math.floor(pen.rec.acc[t] / T.every); pen.rec.acc[t] -= k * T.every;
          pen.rec.store[T.item] = Math.min(STORE_CAP * n, (pen.rec.store[T.item] ?? 0) + k);
        }
      }
      // Gestüt: aus zwei Pferden wird irgendwann ein Fohlen
      if (pen.def.breed) {
        if ((counts.horse ?? 0) >= 2 && pen.rec.animals.length < pen.def.cap) {
          pen.breedT += dt;
          if (pen.breedT >= pen.def.breed) {
            pen.breedT = 0; pen.rec.animals.push('horse'); this._spawnInPen(pen, 'horse');
            this.toast('🐴 Im Gestüt ist ein Fohlen geboren!'); this._save();
          }
        } else pen.breedT = 0;
      }
      // Tiere: im Zaun halten; Reiter/Absteigen behandeln
      for (let i = pen.list.length - 1; i >= 0; i--) {
        const e = pen.list[i], a = e.a;
        if (a.dead || !this.animals.liveIds.has(a.id)) { pen.list.splice(i, 1); const k = pen.rec.animals.indexOf(e.type); if (k >= 0) pen.rec.animals.splice(k, 1); continue; }
        const { lx, lz } = this._toLocal(pen, a.root.position.x, a.root.position.z);
        const mx = pen.w / 2 - 0.5, mz = pen.d / 2 - 0.5;
        if (a.ridden) { e.wasRidden = true; continue; }
        if (e.wasRidden) {
          e.wasRidden = false;
          if (Math.abs(lx) > mx + 0.6 || Math.abs(lz) > mz + 0.6) {   // draussen abgestiegen: Tier gehört weiter dir, läuft aber frei
            pen.list.splice(i, 1);
            const k = pen.rec.animals.indexOf(e.type); if (k >= 0) pen.rec.animals.splice(k, 1);
            a.pen = null; a.pet = true; a.owned = true; this.free.push({ type: e.type, a });
            a.herd = { x: a.root.position.x, z: a.root.position.z, r: 8, panicUntil: 0 };
            this.toast(`${ANIMALS[e.type].icon} ${ANIMALS[e.type].name} bleibt hier draussen. Du kannst es jederzeit wieder reiten.`);
            this._save(); this.render();
            continue;
          }
        }
        if (Math.abs(lx) > mx || Math.abs(lz) > mz) {
          const q = this._local(pen, Math.max(-mx, Math.min(mx, lx)), Math.max(-mz, Math.min(mz, lz)));
          a.root.position.x = q.x; a.root.position.z = q.z;
        }
      }
      this._labelAt(pen.label, pen.labelPos, 1.5, playerPos, camera, w, h, () => {
        const items = Object.entries(pen.rec.store).filter(([, c]) => c > 0).map(([k, c]) => `${ITEMS[k].icon}${c}`).join(' ') || '–';
        return [`${pen.def.name} · ${pen.rec.animals.length}/${pen.def.cap} Tiere`, items];
      });
    }
    for (const q of this.shops) {
      q.acc += dt;
      if (q.acc >= SHOP.every) {
        q.acc = 0;
        if (q.till < SHOP.tillCap) {
          // eine Ware aus dem nächsten Stall mit Vorrat nehmen und mit Aufschlag verkaufen
          let src = null, sd = SHOP.range;
          for (const pen of this.pens) {
            const d = Math.hypot(pen.x - q.x, pen.z - q.z);
            if (d < sd && Object.values(pen.rec.store).some((c) => c > 0)) { sd = d; src = pen; }
          }
          if (src) {
            const k = Object.keys(src.rec.store).filter((i) => src.rec.store[i] > 0).sort((a, b) => ITEMS[b].value - ITEMS[a].value)[0];
            src.rec.store[k]--; q.till += Math.round(ITEMS[k].value * SHOP.bonus);
          }
        }
      }
      this._labelAt(q.label, this._local(q, 0, 1.2), 3.4, playerPos, camera, w, h, () => ['Hofladen', `🪙 ${q.till}`]);
    }
    for (const f of this.fields) {
      if (f.crop) {
        f.t = Math.min(f.t + dt, CROPS[f.crop].time);
        const p = this._growth(f), sy = 0.12 + 0.88 * p, sxz = 0.4 + 0.6 * p, ripe = p >= 1;
        for (let i = 0; i < f.plants.length; i++) {
          const m = f.plants[i];
          m.scale.set(sxz, sy, sxz);
          m.rotation.z = ripe ? Math.sin(this.time * 2 + i) * 0.04 : 0;
        }
      }
      const c = this._local(f, 0, 0);
      this._labelAt(f.label, { x: c.x, z: c.z }, 1.6, playerPos, camera, w, h, () => {
        if (!f.crop) return ['Feld', 'frei zum Säen'];
        const C = CROPS[f.crop], p = this._growth(f);
        return [`${C.icon} ${C.name}`, p >= 1 ? '✨ reif!' : `${Math.round(p * 100)} %`];
      });
    }
    if (near?.kind === 'pen') {
      const tot = Object.entries(near.o.rec.store).reduce((s, [k, c]) => s + c * ITEMS[k].value, 0);
      prompt = tot > 0 ? `F – einsammeln und verkaufen (+${tot} 🪙)` : 'Stall – hier ist noch nichts zum Einsammeln';
    } else if (near?.kind === 'shop') {
      prompt = near.o.till > 0 ? `F – Kasse leeren (+${near.o.till} 🪙)` : 'Hofladen – die Kasse füllt sich, wenn Kunden Waren aus den Ställen kaufen';
    } else if (near?.kind === 'field') {
      const f = near.o;
      prompt = !f.crop ? `F – ${CROPS[this.crop].icon} ${CROPS[this.crop].name} säen (${CROPS[this.crop].seed} 🪙)` : this._growth(f) >= 1 ? 'F – ernten' : '';
    }
    this.prompt = prompt;
    this._saveT = (this._saveT ?? 0) + dt;
    if (this._saveT > 8) { this._saveT = 0; this._save(); }
  }

  _labelAt(el, pos, lift, playerPos, camera, w, h, text) {
    const dist = Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z);
    if (dist > 28) { el.style.display = 'none'; return; }
    const v = this.pp.set(pos.x, this._h(pos.x, pos.z) + lift, pos.z).project(camera);
    if (v.z > 1) { el.style.display = 'none'; return; }
    const [a, b] = text();
    el.style.display = 'block';
    el.style.transform = `translate(-50%, -100%) translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
    el.querySelector('b').textContent = a;
    el.querySelector('span').textContent = b;
  }

  // ---------- Oberfläche ----------
  _buildUi() {
    this.coinEl = document.getElementById('coins');
    this.toastEl = document.getElementById('toast');
    this.el = document.createElement('div');
    this.el.id = 'hof-panel';
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b || b.disabled) return;
      const [kind, arg] = b.dataset.a.split(':');
      if (kind === 'pen') this.buildPen(arg);
      else if (kind === 'shop') this.buildShop();
      else if (kind === 'field') this.buildField();
      else if (kind === 'buy') this.buyAnimal(arg);
      else if (kind === 'crop') { this.crop = arg; this._save(); this.render(); }
      else if (kind === 'close') this.toggle(false);
    });
  }

  toast(text) {
    this.toastEl.textContent = text; this.toastEl.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => this.toastEl.classList.remove('show'), 3800);
  }
  _renderCoins() {
    if (this.coinEl) this.coinEl.textContent = `🪙 ${this.coins}`;
  }

  toggle(on = !this.open) {
    this.open = on;
    this.el.style.display = on ? 'block' : 'none';
    if (on) { if (document.pointerLockElement) document.exitPointerLock?.(); this.render(); }
  }

  render() {
    this._renderCoins();
    if (!this.open) return;
    const btn = (a, label, cost, ok, sel = false) =>
      `<button data-a="${a}" class="${sel ? 'sel' : ''}" ${ok ? '' : 'disabled'}>${label}<small>${cost}</small></button>`;
    let h = `<h3>🌾 Mein Hof <span>🪙 ${this.coins}</span></h3>`;
    h += `<h4>Bauen</h4><div class="g">`;
    for (const [k, D] of Object.entries(PENS)) h += btn(`pen:${k}`, `${D.icon} ${D.name}`, `${D.cost} 🪙 · ${D.info}`, this.coins >= D.cost);
    h += btn('shop:', '🧺 Hofladen', `${SHOP.cost} 🪙 · verkauft ×${SHOP.bonus}`, this.coins >= SHOP.cost);
    h += btn('field:', '🟫 Feld', `${FIELD.cost} 🪙`, this.coins >= FIELD.cost);
    h += `</div><p class="n">Gebaut wird direkt vor dir – Platz lassen! Du hast ${this.pens.length} Stall/Ställe, ${this.shops.length} Hofladen und ${this.fields.length} Feld(er).</p>`;
    h += `<h4>Tiere kaufen</h4><div class="g">`;
    for (const [k, T] of Object.entries(ANIMALS)) {
      const it = ITEMS[T.item];
      h += btn(`buy:${k}`, `${T.icon} ${T.name}`, `${T.price} 🪙 · ${it.icon} ${it.value}/${T.every}s`, this.coins >= T.price);
    }
    h += `</div><p class="n">Das Tier kommt in den nächsten Stall mit freiem Platz.</p>`;
    h += `<h4>Saatgut (für F auf dem Feld)</h4><div class="g">`;
    for (const [k, C] of Object.entries(CROPS)) h += btn(`crop:${k}`, `${C.icon} ${C.name}`, `Saat ${C.seed} · Ernte ${C.value} · ${C.time}s`, true, this.crop === k);
    h += `</div><button class="x" data-a="close:">Schliessen (B / Esc)</button>`;
    this.el.innerHTML = h;
  }
}
