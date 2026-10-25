import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AgentInfo, AgentState, KafedraEvent } from '../src/shared/events';
import { buildCharacter, mat, poseCharacter, type CharacterRig } from './characters3d';
import type { BoardInfo, OfficeLike } from './office-api';

// 3D kafedra xonasi (three.js). Mantiq 2D versiyadagi bilan bir xil: yo'laklar, navbat, holatlar; faqat ko'rinish 3D.

interface Pt {
  x: number;
  y: number;
}
type Step = { kind: 'walk'; path: Pt[] } | { kind: 'wait'; ms: number } | { kind: 'carry'; on: boolean };

const CORRIDOR = 350;
const SIDE = 62;
const SPEED = 190;
/** Mantiqiy (2D) piksel → dunyo birligi */
const K = 50;
const wx = (x: number) => (x - 500) / K;
const wz = (y: number) => (y - 320) / K;

const STATE_LABEL: Record<AgentState, string> = {
  idle: "Bo'sh",
  thinking: "O'ylayapti",
  writing: 'Yozyapti',
  reviewing: 'Tekshiryapti',
  waiting_rate_limit: 'Limit kutilmoqda',
  done: 'Tayyor',
  error: 'Xato',
};

class Actor {
  pos: Pt;
  state: AgentState = 'idle';
  note = '';
  bubble: { text: string; until: number } | null = null;
  queue: Step[] = [];
  cur: Step | null = null;
  pathIdx = 0;
  waitLeft = 0;
  carrying = false;
  moving = false;
  phase = 0;
  heading = 0;
  rig: CharacterRig;
  tag: HTMLElement;
  float: HTMLElement;
  bubbleEl: HTMLElement;
  iconEl: HTMLElement;
  offset: number;

  constructor(
    readonly info: AgentInfo,
    readonly desk: Pt,
  ) {
    this.pos = { ...this.home };
    this.rig = buildCharacter(info);
    this.offset = (info.id.charCodeAt(info.id.length - 1) % 7) * 0.9;
    this.tag = document.createElement('div');
    this.float = document.createElement('div');
    this.bubbleEl = document.createElement('div');
    this.iconEl = document.createElement('div');
  }
  get home(): Pt {
    return { x: this.desk.x, y: this.desk.y - 14 };
  }
  get stand(): Pt {
    return { x: this.desk.x + SIDE, y: this.desk.y - 14 };
  }
}

function boardTexture(info: BoardInfo, dark: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 360;
  const g = c.getContext('2d')!;
  g.fillStyle = dark ? '#16241d' : '#2f4a3d';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(255,255,255,.07)';
  for (let i = 0; i < 8; i++) g.fillRect(0, i * 46 + 10, c.width, 2);
  g.fillStyle = '#f3efe3';
  g.font = '700 30px Segoe UI, system-ui, sans-serif';
  g.fillText('JORIY TOPSHIRIQ', 48, 70);
  g.font = '40px Segoe UI, system-ui, sans-serif';
  const words = (info.task || 'Topshiriq kutilmoqda…').split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > 920 && line) {
      lines.push(line);
      line = w;
    } else line = test;
    if (lines.length === 2) break;
  }
  if (lines.length < 3) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => {
    const isLast = i === 2 || (i === lines.length - 1 && words.join(' ').length > lines.join(' ').length);
    g.fillText(isLast && i === 2 ? `${l.slice(0, 40)}…` : l, 48, 140 + i * 52);
  });
  g.fillStyle = 'rgba(255,255,255,.2)';
  g.fillRect(48, 310, 928, 22);
  if (info.total > 0) {
    g.fillStyle = '#7fd69a';
    g.fillRect(48, 310, (928 * info.done) / info.total, 22);
    g.fillStyle = '#f3efe3';
    g.font = '700 26px Segoe UI, system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(`${info.done}/${info.total}`, 976, 296);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const cols = ['#d9b98a', '#d2b080', '#dcbf92', '#cfa978'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = cols[i % cols.length]!;
    g.fillRect(0, i * 64, 512, 64);
    g.fillStyle = 'rgba(70,40,10,.12)';
    g.fillRect(0, i * 64, 512, 2);
    for (let j = 0; j < 3; j++) g.fillRect(((i * 97 + j * 173) % 512), i * 64, 2, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Office3D implements OfficeLike {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1.56, 0.1, 100);
  private actors = new Map<string, Actor>();
  private overlay: HTMLElement;
  private wrap: HTMLElement;
  private raycaster = new THREE.Raycaster();
  private pickMap = new Map<THREE.Object3D, Actor>();
  private screens = new Map<string, THREE.MeshBasicMaterial>();
  private hemi = new THREE.HemisphereLight(0xffffff, 0xcdb89a, 0.9);
  private sun = new THREE.DirectionalLight(0xffffff, 1.5);
  private floorMat!: THREE.MeshStandardMaterial;
  private boardMesh!: THREE.Mesh;
  private steam: THREE.Mesh[] = [];
  private board: BoardInfo = { task: '', done: 0, total: 0 };
  private running = false;
  private last = 0;
  private time = 0;
  reduced = false;
  dark = false;
  private roomLabels: { el: HTMLElement; pos: THREE.Vector3 }[] = [];
  private w = 1000;
  private h = 640;

  constructor(
    private canvas: HTMLCanvasElement,
    agents: AgentInfo[],
    private tooltip: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'default' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.wrap = canvas.parentElement ?? document.body;
    this.overlay = document.createElement('div');
    this.overlay.className = 'o3-overlay';
    this.wrap.append(this.overlay);

    this.buildScene(agents);
    new ResizeObserver(() => this.resize()).observe(this.wrap);
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerleave', () => (this.tooltip.hidden = true));
    this.setDark(false);
    this.resize();
  }

  // ---------- sahna ----------

  private buildScene(agents: AgentInfo[]): void {
    const s = this.scene;
    s.add(this.hemi);
    this.sun.position.set(-7, 14, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 40;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.radius = 4;
    s.add(this.sun);

    // Taglik (diorama) va pol
    const slab = new THREE.Mesh(new RoundedBoxGeometry(21.2, 0.5, 13.9, 3, 0.12), mat(0x7a5a3b, 0.8));
    slab.position.y = -0.27;
    slab.receiveShadow = true;
    s.add(slab);
    this.floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.75 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20.6, 13.4), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    // Gilam (yo'lak)
    const rug = new THREE.Mesh(new RoundedBoxGeometry(17.8, 0.03, 1.5, 2, 0.01), mat(0x9b4a3c, 0.95));
    rug.position.set(0, 0.02, wz(CORRIDOR));
    rug.receiveShadow = true;
    s.add(rug);
    const rugTrim = new THREE.Mesh(new RoundedBoxGeometry(17.5, 0.035, 1.2, 2, 0.01), mat(0xc9a05a, 0.9));
    rugTrim.position.set(0, 0.025, wz(CORRIDOR));
    s.add(rugTrim);

    // Orqa devor va doska
    const back = new THREE.Mesh(new THREE.BoxGeometry(20.6, 3.6, 0.3), mat(0xe8dcc6, 0.9));
    back.position.set(0, 1.8, -6.85);
    back.receiveShadow = true;
    s.add(back);
    const base = new THREE.Mesh(new THREE.BoxGeometry(20.6, 0.35, 0.34), mat(0x8d6e4a, 0.7));
    base.position.set(0, 0.17, -6.82);
    s.add(base);
    const frame = new THREE.Mesh(new RoundedBoxGeometry(6.2, 2.3, 0.16, 2, 0.04), mat(0x8d6636, 0.6));
    frame.position.set(0.2, 2.1, -6.62);
    frame.castShadow = true;
    s.add(frame);
    this.boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 2.0), new THREE.MeshBasicMaterial({ map: boardTexture(this.board, false) }));
    this.boardMesh.position.set(0.2, 2.1, -6.53);
    s.add(this.boardMesh);
    // Soat va diplomlar
    const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 32), mat(0xfafafa, 0.5));
    clock.rotation.x = Math.PI / 2;
    clock.position.set(5.6, 2.5, -6.65);
    s.add(clock);
    for (const [hx, hy, rot] of [[0, 0.3, 0.2], [0, 0.17, -1.2]] as const) {
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.03, hy, 0.02), mat(0x222222, 0.4));
      hand.position.set(5.6 + Math.sin(rot) * hy * 0.5 + hx, 2.5 + Math.cos(rot) * hy * 0.5, -6.6);
      hand.rotation.z = -rot;
      s.add(hand);
    }
    for (const [fx, col] of [[7.2, 0x2f6f8f], [8.3, 0x3f7d4e]] as const) {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.05, 0.06), mat(0x6b4a2b, 0.6));
      fr.position.set(fx, 2.4, -6.68);
      s.add(fr);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.84), mat(col, 0.7));
      pic.position.set(fx, 2.4, -6.64);
      s.add(pic);
    }

    // Mudir kabineti devorlari (past, oyna kabi); eshik joyi bo'sh
    const wallMat = mat(0xc9b08a, 0.7);
    const wallH = 1.5;
    const addWall = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const m = new THREE.Mesh(new RoundedBoxGeometry(len, wallH, 0.14, 2, 0.03), wallMat);
      m.position.set((x1 + x2) / 2, wallH / 2, (z1 + z2) / 2);
      m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      m.castShadow = true;
      m.receiveShadow = true;
      s.add(m);
      const cap = new THREE.Mesh(new RoundedBoxGeometry(len, 0.06, 0.2, 2, 0.02), mat(0x8d6e4a, 0.6));
      cap.position.set(m.position.x, wallH + 0.03, m.position.z);
      cap.rotation.y = m.rotation.y;
      s.add(cap);
    };
    const cx1 = wx(24), cx2 = wx(330), cz2 = wz(203);
    addWall(cx2, wz(24), cx2, cz2); // o'ng devor
    addWall(wx(180), cz2, cx1, cz2); // pastki chap
    addWall(cx2, cz2, wx(252), cz2); // pastki o'ng (eshik oralig'i)
    addWall(cx1, wz(24), cx1, cz2); // chap devor

    // Choy burchagi
    this.buildTea(wx(870), wz(108));
    // Kitob javoni (mudir kabineti)
    this.buildShelf(wx(260), -6.45);
    this.buildShelf(wx(70) + 0.2, -6.45);
    // O'simliklar
    this.buildPlant(wx(960), wz(140));
    this.buildPlant(wx(40), wz(600));
    this.buildPlant(wx(965), wz(600));

    // Xona yozuvlari
    this.addRoomLabel('MUDIR KABINETI', wx(110), 0, wz(60));
    this.addRoomLabel('CHOY BURCHAGI', wx(870), 0, wz(150));

    // Agentlar
    const teachers = agents.filter((a) => a.role === 'oqituvchi');
    const mudir = agents.find((a) => a.role === 'mudir');
    const uslubchi = agents.find((a) => a.role === 'uslubchi');
    if (mudir) this.addActor(mudir, { x: 150, y: 120 });
    if (uslubchi) this.addActor(uslubchi, { x: 500, y: 270 });
    const cols = Math.max(1, Math.min(teachers.length, 5));
    const rows = Math.ceil(teachers.length / cols);
    const span = 880 / cols;
    teachers.forEach((a, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const y = rows === 1 ? 480 : 420 + r * 125;
      this.addActor(a, { x: 60 + span * (c + 0.5), y });
    });
  }

  private addRoomLabel(text: string, x: number, y: number, z: number): void {
    const el = document.createElement('div');
    el.className = 'o3-room';
    el.textContent = text;
    this.overlay.append(el);
    this.roomLabels.push({ el, pos: new THREE.Vector3(x, y, z) });
  }

  private buildTea(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.1, 40), mat(0xb98a58, 0.5));
    top.position.y = 0.78;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, 0.75, 16), mat(0x8d6636, 0.6));
    leg.position.y = 0.4;
    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), mat(0xf1ece0, 0.3));
    pot.position.set(0.1, 1.0, 0);
    pot.scale.y = 0.85;
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(0x2f6f8f, 0.4));
    lid.position.set(0.1, 1.2, 0);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.22, 10), mat(0xf1ece0, 0.3));
    spout.position.set(-0.17, 1.05, 0);
    spout.rotation.z = 0.8;
    g.add(top, leg, pot, lid, spout);
    for (const [cx, cz] of [[-0.6, 0.35], [0.7, -0.35], [0.5, 0.5]] as const) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.12, 16), mat(0x2f6f8f, 0.4));
      cup.position.set(cx, 0.89, cz);
      g.add(cup);
    }
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
      st.position.set(0.1 + i * 0.03, 1.3 + i * 0.2, 0);
      st.userData.base = 1.3 + i * 0.25;
      g.add(st);
      this.steam.push(st);
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && !this.steam.includes(o)) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.scene.add(g);
  }

  private buildShelf(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const w = 1.9;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, 0.5), mat(0x7a5a3b, 0.7)));
    g.children[0]!.position.y = 1.2;
    const cols = [0xb33a3a, 0x2f6f8f, 0x3f7d4e, 0xe0b458, 0x6a4fb0, 0xe8e0d0, 0xa3453f];
    for (let sh = 0; sh < 4; sh++) {
      const y = 0.45 + sh * 0.6;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.06, 0.52), mat(0x5a4129, 0.7));
      plank.position.set(0, y, 0.02);
      g.add(plank);
      let bx = -w / 2 + 0.15;
      let i = sh;
      while (bx < w / 2 - 0.2) {
        const bw = 0.08 + ((i * 7) % 5) * 0.025;
        const bh = 0.38 + ((i * 3) % 4) * 0.04;
        const book = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.34), mat(cols[i % cols.length]!, 0.6));
        book.position.set(bx + bw / 2, y + 0.03 + bh / 2, 0.08);
        g.add(book);
        bx += bw + 0.012;
        i++;
      }
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.scene.add(g);
  }

  private buildPlant(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.5, 20), mat(0xa65a3a, 0.7));
    pot.position.y = 0.25;
    g.add(pot);
    const leafMat = mat(0x3f8a52, 0.7);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), i % 2 ? leafMat : mat(0x2f7a46, 0.7));
      leaf.scale.set(0.5, 1.7, 0.3);
      leaf.position.set(Math.cos(a) * 0.22, 0.95 + (i % 3) * 0.12, Math.sin(a) * 0.22);
      leaf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
      g.add(leaf);
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.scene.add(g);
  }

  private addActor(info: AgentInfo, desk: Pt): void {
    const a = new Actor(info, desk);
    // Stol
    const dg = new THREE.Group();
    dg.position.set(wx(desk.x), 0, wz(desk.y + 14));
    const top = new RoundedBoxGeometry(1.9, 0.09, 0.95, 3, 0.03);
    const t = new THREE.Mesh(top, mat(0xb98a58, 0.45));
    t.position.y = 0.76;
    dg.add(t);
    for (const [lx, lz] of [[-0.85, -0.38], [0.85, -0.38], [-0.85, 0.38], [0.85, 0.38]] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.72, 10), mat(0x5a4129, 0.6));
      leg.position.set(lx, 0.36, lz);
      dg.add(leg);
    }
    const drawer = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.5, 0.8, 2, 0.03), mat(0x8d6636, 0.6));
    drawer.position.set(0.55, 0.45, 0);
    dg.add(drawer);
    // Noutbuk: asos + qopqoq (orqasi kameraga qaragan) + ekran nuri stol ustida
    const lap = new THREE.Group();
    lap.position.set(0.0, 0.81, 0.08);
    lap.add(new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.03, 0.42, 2, 0.01), mat(0xb9bec6, 0.35, 0.6)));
    const lid = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.42, 0.025, 2, 0.01), mat(0xc4c9d1, 0.35, 0.6));
    lid.position.set(0, 0.22, 0.2);
    lid.rotation.x = 0.12;
    lap.add(lid);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), mat(0xe9edf2, 0.3));
    logo.position.set(0, 0.23, 0.2155);
    logo.rotation.x = 0.12;
    lap.add(logo);
    dg.add(lap);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, 0.812, -0.28);
    dg.add(glow);
    this.screens.set(info.id, glowMat);
    // Qog'ozlar va krujka
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.44), mat(0xfbf9f2, 0.8));
    paper.position.set(-0.62, 0.815, 0.0);
    paper.rotation.y = 0.2;
    dg.add(paper);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 14), mat(new THREE.Color(info.color).getHex(), 0.4));
    mug.position.set(0.7, 0.86, 0.15);
    dg.add(mug);
    dg.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== glow) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.scene.add(dg);
    // Stul
    const chair = new THREE.Group();
    chair.position.set(wx(desk.x), 0, wz(desk.y - 14) - 0.08);
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.1, 0.6, 3, 0.04), mat(0x2b3552, 0.7));
    seat.position.y = 0.45;
    const backrest = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.66, 0.1, 3, 0.04), mat(0x2b3552, 0.7));
    backrest.position.set(0, 0.85, -0.3);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.4, 10), mat(0x30343d, 0.4, 0.5));
    stem.position.y = 0.22;
    const baseS = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 5), mat(0x30343d, 0.4, 0.5));
    baseS.position.y = 0.03;
    chair.add(seat, backrest, stem, baseS);
    chair.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.scene.add(chair);

    a.rig.root.scale.setScalar(1.45);
    this.scene.add(a.rig.root);
    for (const p of a.rig.pickables) this.pickMap.set(p, a);
    this.pickMap.set(top as unknown as THREE.Object3D, a);
    t.userData.actor = a;
    this.pickMap.set(t, a);
    this.actors.set(info.id, a);

    // DOM yorlig'i va belgilar
    a.tag.className = 'o3-tag';
    const nm = document.createElement('b');
    nm.textContent = info.name;
    const tt = document.createElement('span');
    tt.textContent = info.title;
    a.tag.append(nm, tt);
    a.float.className = 'o3-float';
    a.bubbleEl.className = 'o3-bubble';
    a.iconEl.className = 'o3-icon';
    a.float.append(a.bubbleEl, a.iconEl);
    this.overlay.append(a.tag, a.float);
  }

  // ---------- tashqi API ----------

  setBoard(b: BoardInfo): void {
    if (b.task === this.board.task && b.done === this.board.done && b.total === this.board.total) return;
    this.board = b;
    this.refreshBoard();
    this.wake();
  }

  private refreshBoard(): void {
    const old = (this.boardMesh.material as THREE.MeshBasicMaterial).map;
    (this.boardMesh.material as THREE.MeshBasicMaterial).map = boardTexture(this.board, this.dark);
    (this.boardMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
    old?.dispose();
  }

  setReduced(v: boolean): void {
    this.reduced = v;
    if (v) {
      for (const a of this.actors.values()) {
        a.queue = [];
        a.cur = null;
        a.moving = false;
        a.carrying = false;
        a.pos = { ...a.home };
      }
    }
    this.wake();
  }

  setDark(v: boolean): void {
    this.dark = v;
    this.scene.background = new THREE.Color(v ? 0x0e1320 : 0xf0e8d8);
    this.hemi.color.set(v ? 0x8aa0d8 : 0xffffff);
    this.hemi.groundColor.set(v ? 0x2a2230 : 0xcdb89a);
    this.hemi.intensity = v ? 0.55 : 0.95;
    this.sun.color.set(v ? 0xa9bcff : 0xfff3df);
    this.sun.intensity = v ? 0.9 : 1.3;
    this.floorMat.color.set(v ? 0x7a7488 : 0xffffff);
    this.overlay.classList.toggle('dark', v);
    if (this.boardMesh) this.refreshBoard();
    this.wake();
  }

  resetAll(): void {
    for (const a of this.actors.values()) {
      a.state = 'idle';
      a.note = '';
      a.bubble = null;
    }
    this.wake();
  }

  handle(e: KafedraEvent): void {
    const say = (id: string | undefined, text: string | undefined, ms = 4500) => {
      const a = id ? this.actors.get(id) : undefined;
      if (a && text) a.bubble = { text, until: performance.now() + ms };
    };
    switch (e.type) {
      case 'run_started':
        this.resetAll();
        break;
      case 'agent_state': {
        const a = e.agent ? this.actors.get(e.agent) : undefined;
        if (a && e.state) {
          a.state = e.state;
          a.note = e.text ?? '';
          if (e.text) say(e.agent, e.text);
        }
        break;
      }
      case 'handoff': {
        const from = e.agent ? this.actors.get(e.agent) : undefined;
        const to = e.to ? this.actors.get(e.to) : undefined;
        if (from && to) {
          say(e.agent, e.text);
          this.enqueueHandoff(from, to);
        }
        break;
      }
      case 'plan_ready':
      case 'review_result':
      case 'revision_requested':
      case 'run_finished':
      case 'run_failed':
        say(e.agent, e.text);
        break;
      case 'provider_switch':
        say(e.agent, `Provayder: ${e.text ?? ''}`);
        break;
      default:
        break;
    }
    this.wake();
  }

  // ---------- harakat mantiqi (2D bilan bir xil) ----------

  private targets = new Map<Step, Pt>();

  private enqueueHandoff(from: Actor, to: Actor): void {
    if (this.reduced) {
      from.queue.push({ kind: 'wait', ms: 600 });
      return;
    }
    from.queue.push({ kind: 'carry', on: true }, { kind: 'walk', path: [] }, { kind: 'wait', ms: 800 }, { kind: 'carry', on: false }, { kind: 'walk', path: [] });
    this.targets.set(from.queue[from.queue.length - 4] as Step, to.stand);
    this.targets.set(from.queue[from.queue.length - 1] as Step, from.stand);
  }

  private buildPath(c: Actor, target: Pt, goHome: boolean): Pt[] {
    const pts: Pt[] = [];
    let cur = { ...c.pos };
    const atHome = Math.hypot(cur.x - c.home.x, cur.y - c.home.y) < 2;
    if (atHome) {
      cur = { ...c.stand };
      pts.push(cur);
    }
    pts.push({ x: cur.x, y: CORRIDOR });
    pts.push({ x: target.x, y: CORRIDOR });
    pts.push(target);
    if (goHome) pts.push({ ...c.home });
    return pts;
  }

  private update(dt: number, now: number): void {
    for (const c of this.actors.values()) {
      if (c.bubble && c.bubble.until < now) c.bubble = null;
      if (!c.cur && c.queue.length > 0) {
        c.cur = c.queue.shift() ?? null;
        c.pathIdx = 0;
        if (c.cur?.kind === 'walk') {
          const target = this.targets.get(c.cur);
          const goHome = target !== undefined && target.x === c.stand.x && target.y === c.stand.y;
          c.cur.path = this.buildPath(c, target ?? c.stand, goHome);
          this.targets.delete(c.cur);
        } else if (c.cur?.kind === 'wait') {
          c.waitLeft = c.cur.ms;
        }
      }
      const s = c.cur;
      c.moving = false;
      if (!s) continue;
      if (s.kind === 'carry') {
        c.carrying = s.on;
        c.cur = null;
      } else if (s.kind === 'wait') {
        c.waitLeft -= dt * 1000;
        if (c.waitLeft <= 0) c.cur = null;
      } else {
        const tgt = s.path[c.pathIdx];
        if (!tgt) {
          c.cur = null;
          continue;
        }
        const dx = tgt.x - c.pos.x;
        const dy = tgt.y - c.pos.y;
        const dist = Math.hypot(dx, dy);
        const step = SPEED * dt;
        c.moving = true;
        c.phase += dt * 10;
        if (dist > 0.5) c.heading = Math.atan2(dx, dy);
        if (dist <= step) {
          c.pos = { ...tgt };
          c.pathIdx++;
        } else {
          c.pos = { x: c.pos.x + (dx / dist) * step, y: c.pos.y + (dy / dist) * step };
        }
      }
    }
  }

  private isAnimated(): boolean {
    for (const c of this.actors.values()) {
      if (c.cur || c.queue.length > 0 || c.bubble) return true;
      if (!this.reduced && ['thinking', 'writing', 'reviewing', 'waiting_rate_limit', 'done'].includes(c.state)) return true;
    }
    return false;
  }

  wake(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.update(dt, now);
    this.render(now);
    if (this.isAnimated()) requestAnimationFrame(this.tick);
    else this.running = false;
  };

  resize(): void {
    const w = this.wrap.clientWidth || 1000;
    const h = this.wrap.clientHeight || Math.round((w * 640) / 1000);
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Xona kengligi sig'ishi uchun kamerani aspektga qarab uzoqlashtiramiz
    const k = Math.max(1, 1.56 / aspect);
    this.camera.position.set(0, 17.2 * k, 14.6 * k + 1);
    this.camera.lookAt(0, 0.4, 0.5);
    this.camera.updateProjectionMatrix();
    this.wake();
  }

  // ---------- chizish ----------

  private render(now: number): void {
    const t = this.time;
    for (const c of this.actors.values()) {
      const seated = !c.moving && !c.carrying && Math.hypot(c.pos.x - c.home.x, c.pos.y - c.home.y) < 2 && !c.cur;
      const r = c.rig;
      r.root.position.set(wx(c.pos.x), seated ? 0 : 0, wz(c.pos.y));
      // Yo'nalish: o'tirganda kameraga, yurganda harakat tomoniga
      const targetRot = seated ? 0 : c.heading;
      let d = targetRot - r.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.root.rotation.y += d * Math.min(1, 0.25 + (this.reduced ? 1 : 0));
      poseCharacter(r, { t, state: c.state, seated, moving: c.moving, carrying: c.carrying, phase: c.phase, reduced: this.reduced, offset: c.offset });
      // Ekran nuri
      const glow = this.screens.get(c.info.id);
      if (glow) glow.opacity = ['writing', 'thinking', 'reviewing'].includes(c.state) ? (this.reduced ? 0.45 : 0.35 + 0.15 * Math.sin(t * 6)) : 0;
    }
    for (const [i, st] of this.steam.entries()) {
      if (this.reduced) {
        st.visible = false;
        continue;
      }
      const base = (st.userData.base as number) ?? 1.3;
      const k = (t * 0.35 + i * 0.33) % 1;
      st.position.y = base + k * 0.5;
      st.scale.setScalar(0.6 + k * 0.9);
      (st.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - k);
    }
    this.renderer.render(this.scene, this.camera);
    this.layoutOverlay(now);
  }

  private project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h, visible: v.z < 1 };
  }

  private layoutOverlay(now: number): void {
    for (const r of this.roomLabels) {
      const p = this.project(r.pos.x, r.pos.y, r.pos.z);
      r.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
    for (const a of this.actors.values()) {
      const tp = this.project(wx(a.desk.x), 0, wz(a.desk.y + 14) + 0.85);
      a.tag.style.transform = `translate(${tp.x}px, ${tp.y}px) translate(-50%, 0)`;
      const hp = this.project(wx(a.pos.x), a.rig.headTop * 1.45 + 0.1, wz(a.pos.y));
      a.float.style.transform = `translate(${hp.x}px, ${hp.y}px) translate(-50%, -100%)`;
      const text = a.bubble && a.bubble.until > now ? a.bubble.text : '';
      if (a.bubbleEl.textContent !== text) a.bubbleEl.textContent = text;
      a.bubbleEl.hidden = !text;
      const st = a.state;
      const icon = st === 'done' ? '✓' : st === 'error' ? '✕' : st === 'waiting_rate_limit' ? '⏳' : st === 'thinking' ? '…' : '';
      if (a.iconEl.dataset.s !== st) {
        a.iconEl.dataset.s = st;
        a.iconEl.textContent = icon;
      }
      a.iconEl.hidden = !icon;
    }
  }

  // ---------- sichqoncha ----------

  private onMove(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.pickMap.keys()], false);
    const hit = hits[0] ? this.pickMap.get(hits[0].object) : undefined;
    if (!hit) {
      this.tooltip.hidden = true;
      this.canvas.style.cursor = '';
      return;
    }
    this.canvas.style.cursor = 'pointer';
    this.tooltip.hidden = false;
    this.tooltip.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = `${hit.info.name} · ${hit.info.title}`;
    const st = document.createElement('div');
    st.textContent = STATE_LABEL[hit.state] + (hit.note ? `: ${hit.note}` : '');
    this.tooltip.append(title, st);
    const wr = this.wrap.getBoundingClientRect();
    this.tooltip.style.left = `${Math.min(e.clientX - wr.left + 12, wr.width - 250)}px`;
    this.tooltip.style.top = `${e.clientY - wr.top + 14}px`;
  }
}
