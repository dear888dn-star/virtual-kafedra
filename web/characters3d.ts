import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AgentInfo, AgentState } from '../src/shared/events';

// 3D personajlar: hammasi universitet formasida (to'q ko'k pidjak, oq ko'ylak, nishon), rangi va aksessuari agentga xos.

const SKIN = [0xf3cfae, 0xe8b88f, 0xd9a073, 0xb97a52, 0x8d5a3b];
const HAIR_M = [0x1e1611, 0x3a2615, 0x14110f, 0x5b3a1e, 0x2a2a2e];
const HAIR_F = [0x2a1a12, 0x4a2a16, 0x15110f, 0x6a3b1b, 0x3b2a3d];
const NAVY = 0x16264a;
const NAVY_LIGHT = 0x22386b;
const GOLD = 0xe2b23c;

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: number, rough = 0.65, metal = 0): THREE.MeshStandardMaterial {
  const k = `${color}|${rough}|${metal}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    matCache.set(k, m);
  }
  return m;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

export interface CharacterRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legsStand: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  legsSit: THREE.Group;
  folder: THREE.Mesh;
  pen: THREE.Mesh;
  /** Bosh balandligi (belgilar va pufaklarni joylash uchun) */
  headTop: number;
  /** Hover uchun tanlanadigan meshlar */
  pickables: THREE.Object3D[];
}

/** Bitta personajni quradi. Yuz +Z tomonga qaragan. Lokal koordinata: oyoq tagi y=0. */
export function buildCharacter(a: AgentInfo): CharacterRig {
  const h = hash(a.id + a.name);
  const female = a.gender === 'female';
  const skin = mat(SKIN[h % SKIN.length]!, 0.8);
  const hairCol = (female ? HAIR_F : HAIR_M)[(h >>> 3) % 5]!;
  const hair = mat(hairCol, 0.55);
  const accent = new THREE.Color(a.color).getHex();
  const accentMat = mat(accent, 0.5);
  const navy = mat(NAVY, 0.7);
  const navyL = mat(NAVY_LIGHT, 0.7);
  const white = mat(0xf7f7f2, 0.6);
  const gold = mat(GOLD, 0.35, 0.6);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const pickables: THREE.Object3D[] = [];
  const add = <T extends THREE.Object3D>(parent: THREE.Object3D, o: T): T => {
    parent.add(o);
    if (o instanceof THREE.Mesh) pickables.push(o);
    return o;
  };

  // --- Torso: pidjak (forma)
  const torso = add(body, mesh(new RoundedBoxGeometry(0.56, 0.62, 0.34, 3, 0.09), navy, 0, 0.95, 0));
  // Oq ko'ylak va yoqa
  add(body, mesh(new THREE.BoxGeometry(0.2, 0.5, 0.02), white, 0, 0.98, 0.172));
  add(body, mesh(new THREE.BoxGeometry(0.22, 0.07, 0.04), white, 0, 1.24, 0.15));
  // Lapel
  for (const s of [-1, 1]) {
    const l = add(body, mesh(new THREE.BoxGeometry(0.07, 0.42, 0.02), navyL, s * 0.12, 1.0, 0.176));
    l.rotation.z = s * 0.14;
  }
  if (female) {
    // Ayollar uchun bo'yinbog' (agent rangida) va yubka
    add(body, mesh(new THREE.SphereGeometry(0.055, 12, 10), accentMat, -0.045, 1.2, 0.19));
    add(body, mesh(new THREE.SphereGeometry(0.055, 12, 10), accentMat, 0.045, 1.2, 0.19));
    add(body, mesh(new THREE.SphereGeometry(0.04, 10, 8), accentMat, 0, 1.2, 0.205));
    add(body, mesh(new THREE.CylinderGeometry(0.27, 0.34, 0.3, 24), navy, 0, 0.58, 0));
  } else {
    // Erkaklar uchun galstuk (agent rangida)
    const tie = add(body, mesh(new THREE.BoxGeometry(0.07, 0.36, 0.02), accentMat, 0, 1.03, 0.19));
    tie.rotation.x = -0.02;
    add(body, mesh(new THREE.BoxGeometry(0.09, 0.07, 0.03), accentMat, 0, 1.2, 0.19));
  }
  // Tugmalar va universitet nishoni (chap ko'krak)
  for (const y of [0.88, 0.76]) add(body, mesh(new THREE.SphereGeometry(0.02, 8, 8), gold, 0.0, y, 0.18));
  add(body, mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.015, 20), gold, -0.17, 1.08, 0.176)).rotation.x = Math.PI / 2;
  add(body, mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), navy, -0.17, 1.08, 0.18)).rotation.x = Math.PI / 2;
  // Lanyard va yorliq (agent rangida)
  const lan = add(body, mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 24, Math.PI), accentMat, 0, 1.2, 0.18));
  lan.rotation.z = Math.PI;
  add(body, mesh(new RoundedBoxGeometry(0.1, 0.13, 0.015, 2, 0.01), accentMat, 0.08, 0.88, 0.19));
  add(body, mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), white, 0.08, 0.9, 0.2));

  // --- Bo'yin va bosh
  add(body, mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 12), skin, 0, 1.3, 0));
  const head = new THREE.Group();
  head.position.set(0, 1.58, 0);
  body.add(head);
  const skull = add(head, mesh(new THREE.SphereGeometry(0.29, 32, 24), skin, 0, 0, 0));
  skull.scale.set(1, 1.04, 0.98);
  // Ko'zlar
  for (const s of [-1, 1]) {
    add(head, mesh(new THREE.SphereGeometry(0.052, 14, 12), white, s * 0.1, 0.02, 0.255)).scale.set(1, 1.15, 0.5);
    add(head, mesh(new THREE.SphereGeometry(0.034, 12, 10), mat(0x1a1410, 0.3), s * 0.1, 0.015, 0.275));
    add(head, mesh(new THREE.SphereGeometry(0.01, 6, 6), white, s * 0.1 + 0.01, 0.03, 0.302));
    const brow = add(head, mesh(new THREE.BoxGeometry(0.09, 0.016, 0.02), hair, s * 0.1, 0.1, 0.265));
    brow.rotation.z = s * -0.08;
    add(head, mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0xf0a496, 0.9), s * 0.165, -0.075, 0.235)).scale.set(1, 0.6, 0.25);
  }
  add(head, mesh(new THREE.SphereGeometry(0.03, 10, 8), skin, 0, -0.04, 0.29)).scale.set(1, 0.8, 0.7);
  const mouth = add(head, mesh(new THREE.TorusGeometry(0.05, 0.009, 6, 16, Math.PI), mat(0x8a3b3b, 0.6), 0, -0.1, 0.27));
  mouth.rotation.z = Math.PI;
  // Quloqlar
  for (const s of [-1, 1]) add(head, mesh(new THREE.SphereGeometry(0.06, 10, 8), skin, s * 0.285, -0.01, 0)).scale.set(0.5, 1, 0.8);

  // --- Soch
  // Soch: tepa qismi (peshona ochiq qoladi) va ensa tomoni
  const cap = add(head, mesh(new THREE.SphereGeometry(0.31, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.42), hair, 0, 0.045, -0.02));
  cap.rotation.x = -0.3;
  add(head, mesh(new THREE.SphereGeometry(0.295, 24, 18), hair, 0, -0.005, -0.08)).scale.set(1, 1, 0.95);
  if (female) {
    add(head, mesh(new THREE.CapsuleGeometry(0.2, 0.34, 8, 18), hair, 0, -0.14, -0.12)).scale.set(1.15, 1, 0.8);
    for (const s of [-1, 1]) add(head, mesh(new THREE.CapsuleGeometry(0.06, 0.25, 6, 12), hair, s * 0.27, -0.14, 0.02));
    if (a.role === 'mudir') add(head, mesh(new THREE.SphereGeometry(0.12, 16, 14), hair, 0, 0.3, -0.12)); // tugun
    else add(head, mesh(new THREE.BoxGeometry(0.3, 0.07, 0.07), hair, 0.05, 0.2, 0.25)).rotation.z = -0.25; // soch popugi
  } else {
    add(head, mesh(new THREE.BoxGeometry(0.34, 0.09, 0.08), hair, 0, 0.2, 0.24)).rotation.x = 0.1;
    for (const s of [-1, 1]) add(head, mesh(new THREE.BoxGeometry(0.05, 0.14, 0.18), hair, s * 0.28, 0.07, -0.03));
    if (a.role === 'mudir') {
      // Mo'ylov va oq soch tolalari (mudir tajribali)
      add(head, mesh(new THREE.BoxGeometry(0.12, 0.025, 0.03), hair, 0, -0.065, 0.285));
    }
  }
  // Ko'zoynak (mudir va uslubchi)
  if (a.role !== 'oqituvchi') {
    const frame = mat(0x20242b, 0.3, 0.3);
    for (const s of [-1, 1]) add(head, mesh(new THREE.TorusGeometry(0.075, 0.009, 8, 24), frame, s * 0.1, 0.02, 0.29));
    add(head, mesh(new THREE.BoxGeometry(0.06, 0.01, 0.01), frame, 0, 0.03, 0.295));
  }

  // --- Qo'llar (yelkadan osilgan; animatsiya uchun guruh)
  const mkArm = (side: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(side * 0.34, 1.19, 0);
    add(g, mesh(new THREE.SphereGeometry(0.095, 16, 12), navy, 0, 0, 0));
    add(g, mesh(new THREE.CapsuleGeometry(0.075, 0.34, 6, 14), navy, 0, -0.24, 0));
    add(g, mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.025, 14), white, 0, -0.47, 0)); // manjet
    add(g, mesh(new THREE.SphereGeometry(0.07, 14, 12), skin, 0, -0.53, 0));
    body.add(g);
    return g;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  // Papka (o'ng qo'lda) va qizil qalam
  const folder = mesh(new RoundedBoxGeometry(0.34, 0.04, 0.24, 2, 0.01), mat(0xe0b458, 0.6), 0.0, -0.58, 0.14);
  folder.visible = false;
  armR.add(folder);
  const pen = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 8), mat(0xd63a3a, 0.4), 0.0, -0.56, 0.1);
  pen.rotation.x = 1.0;
  pen.visible = false;
  armR.add(pen);

  // --- Oyoqlar (tik turganda): yurish animatsiyasi uchun
  const legsStand = new THREE.Group();
  root.add(legsStand);
  const pants = female ? mat(0x2a2f3d, 0.8) : navy;
  const mkLeg = (side: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(side * 0.12, 0.62, 0);
    if (female) {
      add(g, mesh(new THREE.CapsuleGeometry(0.065, 0.3, 6, 12), skin, 0, -0.27, 0));
    } else {
      add(g, mesh(new THREE.CapsuleGeometry(0.085, 0.36, 6, 12), pants, 0, -0.27, 0));
    }
    add(g, mesh(new RoundedBoxGeometry(0.17, 0.09, 0.3, 2, 0.03), mat(0x14161c, 0.5), 0, -0.56, 0.05));
    legsStand.add(g);
    return g;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  // --- Oyoqlar (o'tirganda): son oldinga, boldir pastga
  const legsSit = new THREE.Group();
  root.add(legsSit);
  for (const s of [-1, 1]) {
    add(legsSit, mesh(new RoundedBoxGeometry(0.17, 0.17, 0.5, 2, 0.06), female ? skin : pants, s * 0.12, 0.5, 0.26));
    add(legsSit, mesh(new RoundedBoxGeometry(0.15, 0.46, 0.15, 2, 0.05), female ? skin : pants, s * 0.12, 0.26, 0.5));
    add(legsSit, mesh(new RoundedBoxGeometry(0.17, 0.08, 0.28, 2, 0.03), mat(0x14161c, 0.5), s * 0.12, 0.04, 0.58));
  }
  if (female) add(legsSit, mesh(new RoundedBoxGeometry(0.5, 0.1, 0.52, 2, 0.04), navy, 0, 0.58, 0.2));

  void torso;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { root, body, head, armL, armR, legsStand, legL, legR, legsSit, folder, pen, headTop: 2.05, pickables };
}

export interface PoseInput {
  t: number;
  state: AgentState;
  seated: boolean;
  moving: boolean;
  carrying: boolean;
  phase: number;
  reduced: boolean;
  offset: number;
}

/** Holatga qarab tana, qo'l va oyoqlarni harakatlantiradi. */
export function poseCharacter(r: CharacterRig, p: PoseInput): void {
  const { t, state, seated, moving, reduced } = p;
  r.legsStand.visible = !seated;
  r.legsSit.visible = seated;
  r.body.position.y = seated ? -0.14 : 0;
  r.folder.visible = p.carrying;
  r.pen.visible = state === 'reviewing' && seated;

  // Nafas olish
  const breathe = reduced ? 0 : Math.sin(t * 2 + p.offset) * 0.008;
  r.body.position.y += breathe;
  r.head.rotation.set(0, 0, 0);
  r.armL.rotation.set(0, 0, 0);
  r.armR.rotation.set(0, 0, 0);
  r.legL.rotation.x = 0;
  r.legR.rotation.x = 0;

  if (moving && !reduced) {
    const s = Math.sin(p.phase);
    r.legL.rotation.x = s * 0.7;
    r.legR.rotation.x = -s * 0.7;
    r.armL.rotation.x = -s * 0.6;
    r.armR.rotation.x = p.carrying ? -0.9 : s * 0.6;
    r.body.position.y += Math.abs(Math.sin(p.phase)) * 0.05;
    r.head.rotation.z = Math.sin(p.phase * 0.5) * 0.04;
    return;
  }
  if (p.carrying) r.armR.rotation.x = -0.9;

  if (!seated) return;
  switch (state) {
    case 'writing': {
      const k = reduced ? 0 : Math.sin(t * 14);
      r.armL.rotation.x = -1.15 + k * 0.05;
      r.armR.rotation.x = -1.15 - k * 0.07;
      r.head.rotation.x = 0.18;
      break;
    }
    case 'reviewing': {
      const k = reduced ? 0 : Math.sin(t * 5);
      r.armL.rotation.x = -0.9;
      r.armR.rotation.x = -1.2 + k * 0.18;
      r.armR.rotation.z = -0.15;
      r.head.rotation.x = 0.22;
      r.head.rotation.y = reduced ? 0 : Math.sin(t * 1.5) * 0.12;
      break;
    }
    case 'thinking': {
      r.armR.rotation.x = -2.3; // qo'l iyakka
      r.armR.rotation.z = 0.35;
      r.armL.rotation.x = -0.5;
      r.head.rotation.z = reduced ? 0.08 : Math.sin(t * 1.2) * 0.1;
      r.head.rotation.x = -0.08;
      break;
    }
    case 'waiting_rate_limit': {
      r.armL.rotation.x = -0.5;
      r.armR.rotation.x = -0.5;
      r.head.rotation.x = 0.1;
      r.head.rotation.z = reduced ? 0 : Math.sin(t * 0.8) * 0.12;
      break;
    }
    case 'done': {
      r.armR.rotation.x = reduced ? -0.4 : -2.5 + Math.sin(t * 6) * 0.25;
      r.armR.rotation.z = 0.2;
      r.head.rotation.x = -0.05;
      break;
    }
    case 'error': {
      r.armL.rotation.x = -0.7;
      r.armR.rotation.x = -0.7;
      r.head.rotation.y = reduced ? 0 : Math.sin(t * 9) * 0.25;
      break;
    }
    default:
      r.armL.rotation.x = -0.35;
      r.armR.rotation.x = -0.35;
  }
}
