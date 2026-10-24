import type { AgentInfo, AgentState, KafedraEvent } from '../src/shared/events';

interface Pt {
  x: number;
  y: number;
}

type Step = { kind: 'walk'; path: Pt[] } | { kind: 'wait'; ms: number } | { kind: 'carry'; on: boolean };

interface Bubble {
  text: string;
  until: number;
}

const W = 1000;
const H = 640;
const CORRIDOR = 350;
const SIDE = 62;
const SPEED = 190;

const STATE_LABEL: Record<AgentState, string> = {
  idle: 'Bo\'sh',
  thinking: 'O\'ylayapti',
  writing: 'Yozyapti',
  reviewing: 'Tekshiryapti',
  waiting_rate_limit: 'Limit kutilmoqda',
  done: 'Tayyor',
  error: 'Xato',
};

class Char {
  pos: Pt;
  state: AgentState = 'idle';
  note = '';
  bubble: Bubble | null = null;
  queue: Step[] = [];
  cur: Step | null = null;
  pathIdx = 0;
  waitLeft = 0;
  carrying = false;
  phase = 0;
  moving = false;

  constructor(
    readonly info: AgentInfo,
    readonly desk: Pt,
  ) {
    this.pos = { ...this.home };
  }

  get home(): Pt {
    return { x: this.desk.x, y: this.desk.y - 14 };
  }
  get stand(): Pt {
    return { x: this.desk.x + SIDE, y: this.desk.y - 14 };
  }
}

interface Palette {
  floor: string;
  floor2: string;
  wall: string;
  desk: string;
  deskEdge: string;
  chair: string;
  text: string;
  textSoft: string;
  board: string;
  boardText: string;
  bubble: string;
  bubbleText: string;
  rug: string;
  screenOff: string;
  screenOn: string;
}

const LIGHT: Palette = {
  floor: '#ead9b8',
  floor2: '#e2cfa8',
  wall: '#8d6e4a',
  desk: '#b98a58',
  deskEdge: '#8d6636',
  chair: '#5b4a3a',
  text: '#2b2620',
  textSoft: '#6b5f4f',
  board: '#2f4a3d',
  boardText: '#f3efe3',
  bubble: '#fffdf6',
  bubbleText: '#2b2620',
  rug: '#c9a77a',
  screenOff: '#3a3f46',
  screenOn: '#8fe3ff',
};
const DARK: Palette = {
  floor: '#3a3226',
  floor2: '#342d22',
  wall: '#6a5238',
  desk: '#7d5d3a',
  deskEdge: '#5a4129',
  chair: '#2a2119',
  text: '#efe8da',
  textSoft: '#b4a78f',
  board: '#1f3329',
  boardText: '#e8e2d2',
  bubble: '#2f2921',
  bubbleText: '#efe8da',
  rug: '#4c3d2a',
  screenOff: '#1c2026',
  screenOn: '#58b9d6',
};

export interface BoardInfo {
  task: string;
  done: number;
  total: number;
}

export class Office {
  private ctx: CanvasRenderingContext2D;
  private chars = new Map<string, Char>();
  private scale = 1;
  private dpr = 1;
  private last = 0;
  private running = false;
  private board: BoardInfo = { task: '', done: 0, total: 0 };
  private hover: string | null = null;
  reduced = false;
  dark = false;

  constructor(
    private canvas: HTMLCanvasElement,
    agents: AgentInfo[],
    private tooltip: HTMLElement,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas qo\'llab-quvvatlanmaydi');
    this.ctx = ctx;
    this.layout(agents);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mouseleave', () => {
      this.hover = null;
      this.tooltip.hidden = true;
    });
    this.resize();
  }

  // ---------- joylashuv ----------

  private layout(agents: AgentInfo[]): void {
    const teachers = agents.filter((a) => a.role === 'oqituvchi');
    const mudir = agents.find((a) => a.role === 'mudir');
    const uslubchi = agents.find((a) => a.role === 'uslubchi');
    if (mudir) this.chars.set(mudir.id, new Char(mudir, { x: 150, y: 120 }));
    if (uslubchi) this.chars.set(uslubchi.id, new Char(uslubchi, { x: 500, y: 270 }));
    const cols = Math.max(1, Math.min(teachers.length, 5));
    const rows = Math.ceil(teachers.length / cols);
    const span = 880 / cols;
    teachers.forEach((a, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const y = rows === 1 ? 480 : 420 + r * 125;
      this.chars.set(a.id, new Char(a, { x: 60 + span * (c + 0.5), y }));
    });
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const cssW = parent ? parent.clientWidth : W;
    this.dpr = window.devicePixelRatio || 1;
    this.scale = cssW / W;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round((cssW * H) / W * this.dpr);
    this.wake();
  }

  // ---------- tashqi API ----------

  setBoard(b: BoardInfo): void {
    this.board = b;
    this.wake();
  }

  setReduced(v: boolean): void {
    this.reduced = v;
    if (v) {
      for (const c of this.chars.values()) {
        c.queue = [];
        c.cur = null;
        c.moving = false;
        c.carrying = false;
        c.pos = { ...c.home };
      }
    }
    this.wake();
  }

  setDark(v: boolean): void {
    this.dark = v;
    this.wake();
  }

  resetAll(): void {
    for (const c of this.chars.values()) {
      c.state = 'idle';
      c.note = '';
      c.bubble = null;
    }
    this.wake();
  }

  handle(e: KafedraEvent): void {
    const say = (id: string | undefined, text: string | undefined, ms = 4500) => {
      const c = id ? this.chars.get(id) : undefined;
      if (c && text) c.bubble = { text, until: performance.now() + ms };
    };
    switch (e.type) {
      case 'run_started':
        this.resetAll();
        break;
      case 'agent_state': {
        const c = e.agent ? this.chars.get(e.agent) : undefined;
        if (c && e.state) {
          c.state = e.state;
          c.note = e.text ?? '';
          if (e.text) say(e.agent, e.text);
        }
        break;
      }
      case 'handoff': {
        const from = e.agent ? this.chars.get(e.agent) : undefined;
        const to = e.to ? this.chars.get(e.to) : undefined;
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

  // ---------- harakat ----------

  private enqueueHandoff(from: Char, to: Char): void {
    if (this.reduced) {
      from.queue.push({ kind: 'wait', ms: 600 });
      return;
    }
    from.queue.push(
      { kind: 'carry', on: true },
      { kind: 'walk', path: [] }, // yo'l bajarilish vaqtida hisoblanadi
      { kind: 'wait', ms: 800 },
      { kind: 'carry', on: false },
      { kind: 'walk', path: [] },
    );
    // Ikkita bo'sh yo'lni ketma-ket belgilash uchun maqsadni yozib qo'yamiz
    this.targets.set(from.queue[from.queue.length - 4] as Step, to.stand);
    this.targets.set(from.queue[from.queue.length - 1] as Step, from.stand);
  }

  private targets = new Map<Step, Pt>();

  private buildPath(c: Char, target: Pt, goHome: boolean): Pt[] {
    const pts: Pt[] = [];
    let cur = { ...c.pos };
    const atHome = Math.hypot(cur.x - c.home.x, cur.y - c.home.y) < 2;
    if (atHome) {
      cur = { x: c.stand.x, y: c.stand.y };
      pts.push(cur);
    }
    pts.push({ x: cur.x, y: CORRIDOR });
    pts.push({ x: target.x, y: CORRIDOR });
    pts.push(target);
    if (goHome) pts.push({ ...c.home });
    return pts;
  }

  private update(dt: number, now: number): void {
    for (const c of this.chars.values()) {
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
    for (const c of this.chars.values()) {
      if (c.cur || c.queue.length > 0 || c.bubble) return true;
      if (!this.reduced && ['thinking', 'writing', 'reviewing', 'waiting_rate_limit'].includes(c.state)) {
        return true;
      }
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
    this.update(dt, now);
    this.draw(now);
    if (this.isAnimated()) {
      requestAnimationFrame(this.tick);
    } else {
      this.running = false;
    }
  };

  // ---------- chizish ----------

  private pal(): Palette {
    return this.dark ? DARK : LIGHT;
  }

  private draw(now: number): void {
    const { ctx } = this;
    const p = this.pal();
    const k = this.scale * this.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.drawRoom(p, now);
    const seated: Char[] = [];
    const walking: Char[] = [];
    for (const c of this.chars.values()) (c.moving || c.carrying ? walking : seated).push(c);
    for (const c of this.chars.values()) this.drawChair(c, p);
    for (const c of seated) this.drawPerson(c, p, now, true);
    for (const c of this.chars.values()) this.drawDesk(c, p, now);
    for (const c of walking) this.drawPerson(c, p, now, false);
    for (const c of this.chars.values()) this.drawOverlay(c, p, now);
  }

  private drawRoom(p: Palette, now: number): void {
    const { ctx } = this;
    // pol (shaxmat taxta)
    for (let y = 0; y < H; y += 40) {
      for (let x = 0; x < W; x += 40) {
        ctx.fillStyle = ((x + y) / 40) % 2 === 0 ? p.floor : p.floor2;
        ctx.fillRect(x, y, 40, 40);
      }
    }
    // gilam (koridor)
    ctx.fillStyle = p.rug;
    ctx.fillRect(60, CORRIDOR - 14, 880, 28);
    // mudir kabineti devori
    ctx.fillStyle = p.wall;
    ctx.fillRect(18, 18, 316, 6);
    ctx.fillRect(18, 18, 6, 188);
    ctx.fillRect(328, 18, 6, 188);
    ctx.fillRect(18, 200, 162, 6);
    ctx.fillRect(252, 200, 82, 6);
    ctx.fillStyle = p.textSoft;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('MUDIR KABINETI', 30, 38);

    this.drawBoard(p);
    this.drawTea(p, now);
  }

  private drawBoard(p: Palette): void {
    const { ctx } = this;
    ctx.fillStyle = p.deskEdge;
    ctx.fillRect(366, 18, 290, 108);
    ctx.fillStyle = p.board;
    ctx.fillRect(372, 24, 278, 96);
    ctx.fillStyle = p.boardText;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('JORIY TOPSHIRIQ', 382, 42);
    ctx.font = '13px system-ui, sans-serif';
    const lines = wrap(ctx, this.board.task || 'Topshiriq kutilmoqda…', 258, 2);
    lines.forEach((l, i) => ctx.fillText(l, 382, 62 + i * 16));
    // progress
    const bx = 382;
    const by = 100;
    const bw = 258;
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(bx, by, bw, 8);
    if (this.board.total > 0) {
      ctx.fillStyle = '#7fd69a';
      ctx.fillRect(bx, by, (bw * this.board.done) / this.board.total, 8);
      ctx.fillStyle = p.boardText;
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(`${this.board.done}/${this.board.total}`, bx + bw - 24, by - 3);
    }
  }

  private drawTea(p: Palette, now: number): void {
    const { ctx } = this;
    ctx.fillStyle = p.textSoft;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CHOY BURCHAGI', 790, 38);
    // stol
    ctx.fillStyle = p.desk;
    ctx.beginPath();
    ctx.ellipse(870, 110, 56, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.deskEdge;
    ctx.lineWidth = 3;
    ctx.stroke();
    // choynak va piyolalar
    ctx.fillStyle = '#e9e4d8';
    ctx.fillRect(858, 94, 20, 14);
    ctx.fillRect(852, 98, 6, 4);
    ctx.fillRect(840, 108, 10, 8);
    ctx.fillRect(892, 110, 10, 8);
    // bug'
    if (!this.reduced) {
      const t = now / 600;
      ctx.strokeStyle = this.dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.25)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        const x = 868 + i * 8;
        ctx.moveTo(x, 90);
        ctx.quadraticCurveTo(x + Math.sin(t + i) * 4, 82, x, 74);
        ctx.stroke();
      }
    }
    // o'simlik
    ctx.fillStyle = '#7a4f2d';
    ctx.fillRect(950, 130, 20, 22);
    ctx.fillStyle = '#3f8a52';
    ctx.fillRect(944, 100, 12, 30);
    ctx.fillRect(956, 92, 12, 38);
    ctx.fillRect(966, 104, 10, 26);
  }

  private drawChair(c: Char, p: Palette): void {
    const { ctx } = this;
    ctx.fillStyle = p.chair;
    ctx.fillRect(c.desk.x - 11, c.desk.y - 20, 22, 14);
  }

  private drawDesk(c: Char, p: Palette, now: number): void {
    const { ctx } = this;
    const { x, y } = c.desk;
    ctx.fillStyle = p.deskEdge;
    ctx.fillRect(x - 46, y - 8, 92, 36);
    ctx.fillStyle = p.desk;
    ctx.fillRect(x - 44, y - 8, 88, 32);
    // monitor
    const on = c.state === 'writing' || c.state === 'thinking' || c.state === 'reviewing';
    ctx.fillStyle = '#222';
    ctx.fillRect(x + 14, y - 20, 28, 20);
    const glow = on && !this.reduced ? 0.75 + 0.25 * Math.sin(now / 160) : on ? 1 : 0;
    ctx.fillStyle = on ? p.screenOn : p.screenOff;
    ctx.globalAlpha = on ? glow : 1;
    ctx.fillRect(x + 16, y - 18, 24, 16);
    ctx.globalAlpha = 1;
    if (on) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      const t = Math.floor(now / 200);
      for (let i = 0; i < 3; i++) ctx.fillRect(x + 18, y - 16 + i * 4, 8 + ((t + i * 3) % 12), 2);
    }
    // klaviatura va qog'oz
    ctx.fillStyle = '#d9d6cf';
    ctx.fillRect(x - 12, y + 4, 24, 8);
    ctx.fillStyle = '#fbf9f2';
    ctx.fillRect(x - 40, y + 2, 16, 12);
    // ism yorlig'i
    ctx.textAlign = 'center';
    ctx.fillStyle = p.text;
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(c.info.name, x, y + 42);
    ctx.fillStyle = p.textSoft;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(c.info.title, x, y + 55);
  }

  private drawPerson(c: Char, p: Palette, now: number, seated: boolean): void {
    const { ctx } = this;
    const fx = Math.round(c.pos.x);
    let fy = Math.round(c.pos.y);
    const writing = seated && (c.state === 'writing' || c.state === 'reviewing') && !this.reduced;
    const bob = writing ? Math.round(Math.sin(now / 90)) : 0;
    const swing = c.moving ? Math.round(Math.sin(c.phase) * 3) : 0;
    if (c.moving) fy += Math.round(Math.abs(Math.sin(c.phase)) * -1);
    // soya
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(fx - 8, fy - 1, 16, 3);
    // oyoqlar
    ctx.fillStyle = '#34394a';
    ctx.fillRect(fx - 5, fy - 9 + (swing > 0 ? -2 : 0), 4, 9);
    ctx.fillRect(fx + 1, fy - 9 + (swing < 0 ? -2 : 0), 4, 9);
    // tana
    ctx.fillStyle = c.info.color;
    ctx.fillRect(fx - 7, fy - 24, 14, 16);
    // yoqa (rol belgisi)
    ctx.fillStyle = c.info.role === 'mudir' ? '#e8c34a' : c.info.role === 'uslubchi' ? '#d94a4a' : '#f3efe3';
    ctx.fillRect(fx - 2, fy - 24, 4, 7);
    // qo'llar
    ctx.fillStyle = c.info.color;
    ctx.fillRect(fx - 10, fy - 23 + (c.moving ? swing : 0), 3, 11);
    ctx.fillRect(fx + 7, fy - 23 + (c.moving ? -swing : 0) + bob, 3, 11);
    // bosh
    ctx.fillStyle = '#f0c9a0';
    ctx.fillRect(fx - 5, fy - 34, 10, 10);
    ctx.fillStyle = skinHair(c.info.id);
    ctx.fillRect(fx - 6, fy - 36, 12, 5);
    ctx.fillStyle = '#222';
    ctx.fillRect(fx - 3, fy - 30, 2, 2);
    ctx.fillRect(fx + 1, fy - 30, 2, 2);
    // papka
    if (c.carrying) {
      ctx.fillStyle = '#e0b458';
      ctx.fillRect(fx + 6, fy - 20, 13, 10);
      ctx.fillStyle = '#c4953a';
      ctx.fillRect(fx + 6, fy - 22, 6, 3);
    }
    // qizil qalam
    if (seated && c.state === 'reviewing') {
      ctx.strokeStyle = '#d63a3a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(fx + 10, fy - 12 + bob);
      ctx.lineTo(fx + 20, fy - 24 + bob);
      ctx.stroke();
    }
  }

  private drawOverlay(c: Char, p: Palette, now: number): void {
    const { ctx } = this;
    const fx = c.pos.x;
    const top = c.pos.y - 40;
    const ix = fx;
    const iy = top - 10;
    switch (c.state) {
      case 'thinking': {
        const n = this.reduced ? 3 : 1 + (Math.floor(now / 350) % 3);
        this.pill(ix - 16, iy - 10, 32, 16, p);
        ctx.fillStyle = p.bubbleText;
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = i < n ? 1 : 0.25;
          ctx.fillRect(ix - 10 + i * 8, iy - 3, 4, 4);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'waiting_rate_limit': {
        ctx.fillStyle = p.bubble;
        ctx.strokeStyle = '#b5702a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ix, iy - 4, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        const a = this.reduced ? 0 : now / 400;
        ctx.beginPath();
        ctx.moveTo(ix, iy - 4);
        ctx.lineTo(ix + Math.sin(a) * 7, iy - 4 - Math.cos(a) * 7);
        ctx.moveTo(ix, iy - 4);
        ctx.lineTo(ix + 4, iy - 4);
        ctx.stroke();
        break;
      }
      case 'done':
        ctx.fillStyle = '#2f9a55';
        ctx.beginPath();
        ctx.arc(ix, iy - 4, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(ix - 4, iy - 4);
        ctx.lineTo(ix - 1, iy - 1);
        ctx.lineTo(ix + 5, iy - 8);
        ctx.stroke();
        break;
      case 'error':
        ctx.fillStyle = '#c93a3a';
        ctx.beginPath();
        ctx.arc(ix, iy - 4, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(ix - 4, iy - 8);
        ctx.lineTo(ix + 4, iy);
        ctx.moveTo(ix + 4, iy - 8);
        ctx.lineTo(ix - 4, iy);
        ctx.stroke();
        break;
      default:
        break;
    }
    if (c.bubble) this.drawBubble(c, c.bubble.text, p);
  }

  private pill(x: number, y: number, w: number, h: number, p: Palette): void {
    const { ctx } = this;
    ctx.fillStyle = p.bubble;
    ctx.strokeStyle = p.textSoft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();
  }

  private drawBubble(c: Char, text: string, p: Palette): void {
    const { ctx } = this;
    ctx.font = '12px system-ui, sans-serif';
    const lines = wrap(ctx, text, 170, 2);
    const w = Math.min(190, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14);
    const h = lines.length * 15 + 8;
    let x = c.pos.x - w / 2;
    x = Math.max(4, Math.min(W - w - 4, x));
    const y = Math.max(4, c.pos.y - 78 - h + 14);
    ctx.fillStyle = p.bubble;
    ctx.strokeStyle = p.textSoft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = p.bubbleText;
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, x + 7, y + 16 + i * 15));
  }

  // ---------- sichqoncha ----------

  private onMove(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    let hit: Char | null = null;
    for (const c of this.chars.values()) {
      const nearPerson = Math.abs(x - c.pos.x) < 18 && y > c.pos.y - 52 && y < c.pos.y + 4;
      const nearDesk = Math.abs(x - c.desk.x) < 48 && y > c.desk.y - 22 && y < c.desk.y + 58;
      if (nearPerson || nearDesk) hit = c;
    }
    if (!hit) {
      this.hover = null;
      this.tooltip.hidden = true;
      return;
    }
    this.hover = hit.info.id;
    this.tooltip.hidden = false;
    this.tooltip.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = `${hit.info.name} · ${hit.info.title}`;
    const st = document.createElement('div');
    st.textContent = STATE_LABEL[hit.state] + (hit.note ? `: ${hit.note}` : '');
    this.tooltip.append(title, st);
    const wrap = this.canvas.parentElement!.getBoundingClientRect();
    this.tooltip.style.left = `${Math.min(e.clientX - wrap.left + 12, wrap.width - 250)}px`;
    this.tooltip.style.top = `${e.clientY - wrap.top + 14}px`;
  }
}

function skinHair(id: string): string {
  const colors = ['#2b1d14', '#4a2f1b', '#1c1c1c', '#7a4a21', '#5a5a5a'];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return colors[h % colors.length] ?? '#222';
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxW || !line) {
      line = test;
    } else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) {
        line = words.slice(i).join(' ');
        break;
      }
    }
  }
  lines.push(line);
  return lines.slice(0, maxLines).map((l, i, arr) => {
    if (i === arr.length - 1) {
      let t = l;
      while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -2) + '…';
      return t;
    }
    return l;
  });
}
