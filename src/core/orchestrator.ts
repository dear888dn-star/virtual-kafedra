import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ZodType } from 'zod';
import type { Router } from '../providers/router';
import { BudgetExceededError, LimitExhaustedError, SensitiveRoutingError, type CallMeta } from '../providers/types';
import { Plan, Review, RunRequest, type PlanTask } from '../schemas';
import type { AgentState, PlanTaskInfo, ReviewInfo, RunSnapshot } from '../shared/events';
import type { AppConfig } from './config';
import { expectedCountFor, lintDeliverable } from './lint';
import type { EventBus } from './events';

export interface OrchestratorOptions {
  runsDir: string;
}

/** Foydalanuvchi ishni to'xtatdi. Holat saqlanadi, "Davom ettirish" mumkin. */
export class RunStoppedError extends Error {
  constructor() {
    super("Ish foydalanuvchi tomonidan to'xtatildi. Tayyor qismlar saqlandi, xohlasangiz davom ettirishingiz mumkin");
    this.name = 'RunStoppedError';
  }
}

/** Bitta ish uchun so'rovlar chegarasi tugadi: tokenlar behuda sarflanmasligi uchun to'xtaydi. */
export class RunLimitError extends Error {
  constructor(public readonly cap: number) {
    super(`Bitta ish uchun so'rovlar chegarasi (${cap} ta) tugadi. Ish saqlandi: davom ettirsangiz hisob yangidan boshlanadi (chegara config/kafedra.yaml: max_requests_per_run)`);
    this.name = 'RunLimitError';
  }
}

/** Model yaroqli JSON qaytara olmadi (tuzatish so'rovidan keyin ham). */
export class JsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonParseError';
  }
}

interface TaskState {
  /** pending: boshlanmagan yoki yozilmoqda; written: yozildi, tekshiruv kutilmoqda; done: qabul qilindi */
  status: 'pending' | 'written' | 'done';
  attempt: number;
  feedback: string;
  score?: number;
  warned?: boolean;
}

interface RunState {
  runId: string;
  request: RunRequest;
  createdAt: string;
  status: 'running' | 'finished' | 'failed';
  reason?: string;
  error?: string;
  tasks: Record<string, TaskState>;
}

export interface RunSummary {
  id: string;
  task: string;
  status: RunState['status'];
  reason?: string;
  createdAt: string;
  /** Tugamagan ishni davom ettirish mumkin */
  resumable: boolean;
}

const LANG_NAMES: Record<string, string> = {
  uz: "o'zbek tili (lotin)",
  ru: 'rus tili',
  en: 'ingliz tili',
  multi: "uch tilda: o'zbek (lotin), rus va ingliz",
};

const MAX_TOKENS = { plan: 2500, work: 4096, review: 1200, assemble: 700 } as const;
/** Bog'liq materialni so'rovga qo'shishda kesish chegarasi (bepul limitlarni tejash uchun) */
const DEP_CHAR_LIMIT = 8000;
/** Manba material nechta belgigacha so'rovga qo'shiladi */
const MATERIAL_CHAR_LIMIT = 10000;

function sourceBlock(req: RunRequest, limit: number): string {
  const m = req.material?.trim();
  if (!m) return '';
  return fence('manba_material', m.length > limit ? `${m.slice(0, limit)}\n[…qisqartirildi]` : m);
}

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'topshiriq';
}

/** Model javobidan JSON'ni ajratadi: ``` belgilari va atrofdagi matnni olib tashlaydi. */
export function extractJson(s: string): string {
  let t = s.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1]!.trim();
  if (t.startsWith('{') || t.startsWith('[')) return t;
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

function short(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Foydalanuvchi matnini teg ichiga joylaydi; teg yopib qo'yishga urinishni zararsizlantiradi. */
function fence(tag: string, text: string): string {
  const safe = text.replace(new RegExp(`</?\\s*${tag}[^>]*>`, 'gi'), '');
  return `<${tag}>\n${safe}\n</${tag}>`;
}

export class Orchestrator {
  private snapshot: RunSnapshot = {
    runId: null,
    status: 'idle',
    task: '',
    plan: [],
    deliverables: {},
    final: null,
    reviews: {},
  };
  private runDir: string | null = null;
  private state: RunState | null = null;
  private locks = new Map<string, Promise<unknown>>();
  private fatal: Error | null = null;
  /** Joriy ishda yuborilgan model so'rovlari soni va foydalanuvchi to'xtatganmi */
  private calls = 0;
  private cancelled = false;
  /** Joriy ishning tugashini kutish uchun (testlar) */
  done: Promise<void> = Promise.resolve();

  constructor(
    private cfg: AppConfig,
    private bus: EventBus,
    private router: Router,
    private opts: OrchestratorOptions,
  ) {}

  get status(): RunSnapshot['status'] {
    return this.snapshot.status;
  }

  getSnapshot(): RunSnapshot {
    return { ...this.snapshot, deliverables: { ...this.snapshot.deliverables }, reviews: { ...this.snapshot.reviews } };
  }

  // ---------- ishni boshlash va davom ettirish ----------

  /** Yangi ishni boshlaydi. run_started chiqarilgach qaytadi, qolgani fonda bajariladi. */
  start(req: RunRequest): string {
    if (this.snapshot.status === 'running') throw new Error('Boshqa topshiriq bajarilmoqda');
    this.assertSensitiveOk(req);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const runId = `${stamp}-${slugify(req.task)}`;
    this.runDir = join(this.opts.runsDir, runId);
    mkdirSync(join(this.runDir, 'deliverables'), { recursive: true });
    mkdirSync(join(this.runDir, 'reviews'), { recursive: true });
    writeFileSync(join(this.runDir, 'task.md'), req.task + '\n');
    this.state = { runId, request: req, createdAt: new Date().toISOString(), status: 'running', tasks: {} };
    this.saveState();
    this.bus.reset(join(this.runDir, 'events.jsonl'));
    this.begin(runId, req, false);
    this.done = this.execute(req, null).catch((e: unknown) => this.fail(e));
    return runId;
  }

  /** Tugamagan ishni qolgan joyidan davom ettiradi: qabul qilingan vazifalar qayta bajarilmaydi. */
  resume(runId: string): string {
    if (this.snapshot.status === 'running') throw new Error('Boshqa topshiriq bajarilmoqda');
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("Noto'g'ri ish id");
    const dir = join(this.opts.runsDir, runId);
    const st = this.loadState(dir);
    if (!st) throw new Error('Ish topilmadi yoki holat fayli yo\'q');
    if (st.status === 'finished') throw new Error('Bu ish allaqachon tugagan');
    this.assertSensitiveOk(st.request);
    this.runDir = dir;
    this.state = { ...st, status: 'running', reason: undefined, error: undefined };
    this.saveState();
    this.bus.reset(join(dir, 'events.jsonl'));
    this.begin(runId, st.request, true);
    this.done = this.execute(st.request, this.state).catch((e: unknown) => this.fail(e));
    return runId;
  }

  listRuns(limit = 10): RunSummary[] {
    if (!existsSync(this.opts.runsDir)) return [];
    const out: RunSummary[] = [];
    for (const name of readdirSync(this.opts.runsDir)) {
      const st = this.loadState(join(this.opts.runsDir, name));
      if (!st) continue;
      out.push({
        id: st.runId,
        task: short(st.request.task, 90),
        status: st.status,
        reason: st.reason,
        createdAt: st.createdAt,
        resumable: st.status !== 'finished' && existsSync(join(this.opts.runsDir, name, 'plan.json')),
      });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  /** Maxfiy ish boshlanishidan oldin: mos provayder bo'lmasa hech narsa yuborilmaydi. */
  private assertSensitiveOk(req: RunRequest): void {
    if (!req.sensitive) return;
    const missing = this.router.missingForSensitive();
    if (missing.length) throw new SensitiveRoutingError(missing);
  }

  private begin(runId: string, req: RunRequest, resumed: boolean): void {
    this.fatal = null;
    this.calls = 0;
    this.cancelled = false;
    this.snapshot = { runId, status: 'running', task: req.task, plan: [], deliverables: {}, final: null, reviews: {} };
    this.bus.emit({
      type: 'run_started',
      text: resumed ? 'Ish davom ettirilmoqda' : 'Topshiriq qabul qilindi',
      data: { run_id: runId, task: req.task, sensitive: req.sensitive, language: req.language, resumed },
    });
  }

  private loadState(dir: string): RunState | null {
    try {
      return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as RunState;
    } catch {
      return null;
    }
  }

  private saveState(): void {
    if (this.runDir && this.state) writeFileSync(join(this.runDir, 'state.json'), JSON.stringify(this.state, null, 2));
  }

  // ---------- yordamchilar ----------

  private agent(id: string) {
    const a = this.cfg.kafedra.agents.find((x) => x.id === id);
    if (!a) throw new Error(`Noma'lum agent: ${id}`);
    return a;
  }

  private emitState(agent: string, state: AgentState, text?: string, task_id?: string): void {
    this.bus.emit({ type: 'agent_state', agent, state, text, task_id });
  }

  /** Bir agent bir vaqtda bitta ish bajaradi. */
  private withAgent<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  }

  private system(agentId: string, req: RunRequest): string {
    const a = this.agent(agentId);
    const common = this.cfg.commonPrompt
      .replaceAll('{{kafedra}}', this.cfg.kafedra.kafedra.name)
      .replaceAll('{{audience}}', this.cfg.kafedra.kafedra.audience)
      .replaceAll('{{language}}', LANG_NAMES[req.language] ?? req.language);
    return `${common}\n\n${this.cfg.prompts[a.prompt] ?? ''}`;
  }

  private async call(
    agentId: string,
    req: RunRequest,
    userContent: string,
    meta: Omit<CallMeta, 'agentId'>,
    state: AgentState,
    task_id?: string,
  ): Promise<string> {
    // Tokenlarni himoya qilish: foydalanuvchi to'xtatgan bo'lsa yoki ish chegaradan oshsa yangi so'rov yuborilmaydi
    if (this.cancelled) throw new RunStoppedError();
    const cap = this.cfg.kafedra.limits.max_requests_per_run;
    if (this.calls >= cap) throw new RunLimitError(cap);
    this.calls++;
    const res = await this.router.complete(
      {
        system: this.system(agentId, req),
        messages: [{ role: 'user', content: userContent }],
        json: meta.purpose === 'plan' || meta.purpose === 'review',
        maxTokens: MAX_TOKENS[meta.purpose],
        temperature: meta.purpose === 'work' ? 0.7 : 0.2,
        meta: { ...meta, agentId },
      },
      { agent: agentId, role: this.agent(agentId).role, task_id, state, sensitive: req.sensitive },
    );
    return res.text;
  }

  /**
   * JSON'ni ajratadi va zod (+ ixtiyoriy `check`) bilan tekshiradi. Yaroqsiz bo'lsa xatoni ko'rsatib
   * modelga bir marta tuzatish topshirig'ini beradi; baribir bo'lmasa JsonParseError.
   */
  private async callJson<T>(
    schema: ZodType<T, any, any>,
    agentId: string,
    req: RunRequest,
    userContent: string,
    meta: Omit<CallMeta, 'agentId'>,
    state: AgentState,
    task_id?: string,
    check?: (v: T) => void,
  ): Promise<T> {
    let text = await this.call(agentId, req, userContent, meta, state, task_id);
    for (let tryNo = 0; ; tryNo++) {
      let problem: string;
      try {
        const v = schema.parse(JSON.parse(extractJson(text)));
        check?.(v);
        return v;
      } catch (e) {
        problem = e instanceof Error ? e.message.slice(0, 400) : String(e);
      }
      if (tryNo >= 1) throw new JsonParseError(`Model yaroqli JSON qaytarmadi: ${problem.slice(0, 200)}`);
      this.bus.emit({ type: 'agent_state', agent: agentId, task_id, state, text: 'JSONni tuzatyapman…' });
      text = await this.call(
        agentId,
        req,
        `${userContent}\n\nOldingi javobing yaroqsiz edi. Xato: ${problem}\nFaqat to'g'ri JSON qaytar (boshqa matn va \`\`\` belgilarisiz).\n\nOldingi javob:\n${text.slice(0, 3000)}`,
        meta,
        state,
        task_id,
      );
    }
  }

  private save(rel: string, content: string): void {
    if (this.runDir) writeFileSync(join(this.runDir, rel), content);
  }

  private validatePlan(tasks: PlanTask[]): void {
    const maxTasks = this.cfg.kafedra.limits.max_plan_tasks;
    if (tasks.length > maxTasks) {
      throw new Error(`Reja juda katta: ${tasks.length} ta vazifa, ko'pi bilan ${maxTasks} ta bo'lishi kerak. Faqat topshiriqqa zarur vazifalarni qoldiring`);
    }
    const ids = new Set(tasks.map((t) => t.id));
    if (ids.size !== tasks.length) throw new Error('Rejada vazifa id takrorlangan');
    const types = new Set(Object.keys(this.cfg.deliverables.deliverables));
    for (const t of tasks) {
      const a = this.cfg.kafedra.agents.find((x) => x.id === t.assignee);
      if (!a || a.role !== 'oqituvchi') {
        const valid = this.cfg.kafedra.agents.filter((x) => x.role === 'oqituvchi').map((x) => x.id).join(', ');
        throw new Error(`Vazifa ${t.id}: "${t.assignee}" o'qituvchi emas (mumkin: ${valid})`);
      }
      if (!types.has(t.deliverable_type)) {
        throw new Error(`Vazifa ${t.id}: noma'lum deliverable_type "${t.deliverable_type}" (mumkin: ${[...types].join(', ')})`);
      }
      for (const d of t.depends_on) {
        if (!ids.has(d)) throw new Error(`Vazifa ${t.id}: noma'lum bog'liqlik "${d}"`);
        if (d === t.id) throw new Error(`Vazifa ${t.id} o'ziga bog'liq`);
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error("Rejada bog'liqlik tsikli bor");
      visiting.add(id);
      for (const d of byId.get(id)!.depends_on) visit(d);
      visiting.delete(id);
      visited.add(id);
    };
    tasks.forEach((t) => visit(t.id));
  }

  // ---------- asosiy oqim ----------

  private async execute(req: RunRequest, resumeFrom: RunState | null): Promise<void> {
    const teachers = this.cfg.kafedra.agents.filter((a) => a.role === 'oqituvchi');
    const roster = teachers.map((a) => ({
      id: a.id,
      title: a.title,
      deliverable_type: a.deliverable_type ?? 'lecture',
    }));

    // 1) Reja (davom ettirishda saqlangan reja o'qiladi)
    let plan: Plan;
    if (resumeFrom) {
      plan = Plan.parse(JSON.parse(readFileSync(join(this.runDir!, 'plan.json'), 'utf8')));
      this.restore(plan, resumeFrom);
    } else {
      this.emitState('mudir', 'thinking', 'Topshiriqni tahlil qilyapman…');
      const rosterText = roster.map((r) => `- ${r.id}: ${r.title} (natija turi: ${r.deliverable_type})`).join('\n');
      const typesText = Object.entries(this.cfg.deliverables.deliverables)
        .map(([k, v]) => `- ${k}: ${v.title}`)
        .join('\n');
      plan = await this.callJson(
        Plan,
        'mudir',
        req,
        `${fence('topshiriq', req.task)}${req.material?.trim() ? `\n\nFoydalanuvchi manba material ham berdi (boshi):\n${sourceBlock(req, 1500)}` : ''}\n\nMavjud o'qituvchilar:\n${rosterText}\n\nNatija turlari:\n${typesText}\n\nCheklov: faqat topshiriqda aniq so'ralgan natijalar uchun vazifa ber, o'zingdan qo'shimcha vazifa o'ylab topma. Vazifalar soni ko'pi bilan ${this.cfg.kafedra.limits.max_plan_tasks} ta.\n\nReja tuz.`,
        { purpose: 'plan', roster },
        'thinking',
        undefined,
        (p) => this.validatePlan(p.tasks),
      );
      this.save('plan.json', JSON.stringify(plan, null, 2));
      for (const t of plan.tasks) this.state!.tasks[t.id] = { status: 'pending', attempt: 0, feedback: '' };
      this.saveState();
      const planInfo: PlanTaskInfo[] = plan.tasks;
      this.snapshot.plan = planInfo;
      this.bus.emit({
        type: 'plan_ready',
        agent: 'mudir',
        text: `Reja tayyor: ${plan.tasks.length} ta vazifa`,
        data: { tasks: planInfo },
      });
      // Taqsimot: mudir har bir o'qituvchiga papka olib boradi
      for (const t of plan.tasks) {
        this.bus.emit({
          type: 'handoff',
          agent: 'mudir',
          to: t.assignee,
          task_id: t.id,
          text: `${this.agent(t.assignee).name}, "${short(t.title, 40)}" sizga`,
        });
        this.bus.emit({ type: 'task_assigned', agent: 'mudir', to: t.assignee, task_id: t.id, text: t.title });
      }
    }
    this.emitState('mudir', 'idle', 'Natijalarni kutyapman');

    // 2) Bajarish (depends_on va concurrency bo'yicha)
    const pending = new Map(plan.tasks.filter((t) => this.state!.tasks[t.id]?.status !== 'done').map((t) => [t.id, t]));
    const finished = new Set(plan.tasks.filter((t) => this.state!.tasks[t.id]?.status === 'done').map((t) => t.id));
    const failed = new Set<string>();
    const running = new Map<string, Promise<void>>();
    const maxParallel = this.cfg.kafedra.limits.concurrency;

    const launch = (t: PlanTask) => {
      pending.delete(t.id);
      const p = this.runTask(t, req)
        .then(() => {
          finished.add(t.id);
        })
        .catch((e: unknown) => {
          // Limit/byudjet tugasa butun ish to'xtaydi; holat saqlangani uchun keyin davom ettiriladi
          if (
            e instanceof LimitExhaustedError ||
            e instanceof BudgetExceededError ||
            e instanceof SensitiveRoutingError ||
            e instanceof RunStoppedError ||
            e instanceof RunLimitError
          ) {
            this.fatal ??= e;
          }
          failed.add(t.id);
          this.emitState(t.assignee, 'error', `Xato: ${short((e as Error).message, 50)}`, t.id);
        })
        .finally(() => {
          running.delete(t.id);
        });
      running.set(t.id, p);
    };

    while (pending.size > 0 || running.size > 0) {
      if (this.fatal) {
        pending.clear();
        if (running.size > 0) await Promise.race(running.values());
        continue;
      }
      for (const t of [...pending.values()]) {
        if (t.depends_on.some((d) => failed.has(d))) {
          pending.delete(t.id);
          failed.add(t.id);
          this.emitState(t.assignee, 'error', "Bog'liq vazifa bajarilmadi", t.id);
          continue;
        }
        if (running.size >= maxParallel) break;
        if (t.depends_on.every((d) => finished.has(d))) launch(t);
      }
      if (running.size === 0 && pending.size > 0) throw new Error("Vazifalar bajarilmay qoldi (bog'liqlik)");
      if (running.size > 0) await Promise.race(running.values());
    }
    if (this.fatal) throw this.fatal;

    // 3) Yig'ish
    if (finished.size === 0) throw new Error('Birorta vazifa ham bajarilmadi');
    this.emitState('mudir', 'writing', "Yakuniy hujjatni yig'yapman…");
    // Xulosa modelsiz, ma'lumotlardan yig'iladi: aniq, takrorlanadigan va bitta so'rov tejaladi.
    const summary = this.buildSummary(plan.tasks, finished, failed);
    const sections = plan.tasks
      .filter((t) => this.snapshot.deliverables[t.id])
      .map((t) => `## ${t.title}\n\n${this.snapshot.deliverables[t.id]}`);
    const table =
      '| Vazifa | Mas\'ul | Baho | Holat |\n|---|---|---|---|\n' +
      plan.tasks
        .map((t) => {
          const st = this.state!.tasks[t.id];
          const status = failed.has(t.id) ? 'bajarilmadi' : st?.warned ? 'ogohlantirish bilan' : 'qabul qilindi';
          return `| ${t.id} | ${this.agent(t.assignee).name} | ${st?.score ?? '-'} | ${status} |`;
        })
        .join('\n');
    const warning = failed.size ? `\n\n> Diqqat: ${failed.size} ta vazifa bajarilmadi.\n` : '';
    const final = `# ${short(req.task, 100)}\n\n${summary.trim()}${warning}\n\n### Sifat nazorati\n\n${table}\n\n---\n\n${sections.join('\n\n---\n\n')}\n`;
    this.snapshot.final = final;
    this.save('final.md', final);

    this.emitState('mudir', 'done', 'Hammasi tayyor');
    this.snapshot.status = 'finished';
    this.state!.status = 'finished';
    this.saveState();
    this.bus.emit({
      type: 'run_finished',
      agent: 'mudir',
      text: failed.size ? `Tugadi (${failed.size} ta xato bilan)` : 'Topshiriq bajarildi',
      data: { run_id: this.snapshot.runId, failed: [...failed] },
    });
  }

  private recordReview(taskId: string, attempt: number, r: Review, unreviewed: boolean, lint: number): void {
    const list = (this.snapshot.reviews[taskId] ??= []);
    list[attempt] = { attempt, verdict: r.verdict, score: r.score, issues: r.issues, unreviewed, lint };
  }

  /**
   * Ishni to'xtatadi: yangi model so'rovi yuborilmaydi. Hozir javob kutilayotgan so'rov tugaguncha
   * kutiladi (uni uzib bo'lmaydi), keyin ish holati saqlanib to'xtaydi va "Davom ettirish" mumkin bo'ladi.
   */
  cancel(): boolean {
    if (this.snapshot.status !== 'running') return false;
    this.cancelled = true;
    this.bus.emit({ type: 'agent_state', agent: 'mudir', state: 'idle', text: "To'xtatilmoqda…" });
    return true;
  }

  /** Mudir xulosasi: nima tayyorlandi, o'rtacha baho, ogohlantirishlar va manba talab qiladigan joylar. */
  private buildSummary(tasks: PlanTask[], finished: Set<string>, failed: Set<string>): string {
    const done = tasks.filter((t) => finished.has(t.id));
    const titles = Object.fromEntries(Object.entries(this.cfg.deliverables.deliverables).map(([k, v]) => [k, v.title]));
    const kinds = [...new Set(done.map((t) => (titles[t.deliverable_type] ?? t.deliverable_type).toLowerCase()))];
    const scores = done.map((t) => this.state!.tasks[t.id]?.score).filter((x): x is number => typeof x === 'number' && x > 0);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;
    const warned = done.filter((t) => this.state!.tasks[t.id]?.warned).map((t) => t.id);
    const needSource = done
      .map((t) => ({ id: t.id, n: (this.snapshot.deliverables[t.id]?.match(/\[MANBA KERAK\]/g) ?? []).length }))
      .filter((x) => x.n > 0);
    const lines = [`Kafedra ${done.length} ta material tayyorladi: ${kinds.join(', ')}.`];
    if (avg) lines.push(`Uslubchining o'rtacha bahosi: ${avg}/10.`);
    lines.push(
      warned.length
        ? `Ogohlantirish bilan qabul qilingan ishlar (qo'lda ko'zdan kechiring): ${warned.join(', ')}.`
        : 'Hamma ish uslubchi tomonidan to\'liq qabul qilindi.',
    );
    lines.push(
      needSource.length
        ? `Manba talab qiladigan joylar [MANBA KERAK]: ${needSource.map((x) => `${x.id} (${x.n} ta)`).join(', ')}. Ishlatishdan oldin ularni manba bilan tekshiring.`
        : "[MANBA KERAK] belgilari yo'q, lekin aniq raqam va faktlarni baribir tekshirib ko'ring.",
    );
    if (failed.size) lines.push(`Bajarilmagan vazifalar: ${[...failed].join(', ')}.`);
    lines.push(`Jami model so'rovlari: ${this.calls} ta.`);
    return lines.join(' ');
  }

  /** Davom ettirishda UI va xotirani saqlangan holatdan tiklaydi. */
  private restore(plan: Plan, st: RunState): void {
    const planInfo: PlanTaskInfo[] = plan.tasks;
    this.snapshot.plan = planInfo;
    this.bus.emit({
      type: 'plan_ready',
      agent: 'mudir',
      text: `Reja tiklandi: ${plan.tasks.length} ta vazifa`,
      data: { tasks: planInfo, restored: true },
    });
    for (const t of plan.tasks) {
      const ts = st.tasks[t.id] ?? (st.tasks[t.id] = { status: 'pending', attempt: 0, feedback: '' });
      const file = join(this.runDir!, 'deliverables', `${t.id}.md`);
      if (existsSync(file)) this.snapshot.deliverables[t.id] = readFileSync(file, 'utf8');
      else if (ts.status !== 'pending') ts.status = 'pending';
      for (let a = 0; a <= 10; a++) {
        const rf = join(this.runDir!, 'reviews', `${t.id}-${a}.json`);
        if (!existsSync(rf)) break;
        try {
          const r = JSON.parse(readFileSync(rf, 'utf8')) as Review & { unreviewed?: boolean; lint?: number };
          this.recordReview(t.id, a, r, !!r.unreviewed, r.lint ?? 0);
        } catch {
          // buzilgan baho fayli: o'tkazib yuboramiz
        }
      }
      if (ts.status === 'done') {
        this.bus.emit({
          type: 'review_result',
          agent: 'uslubchi',
          to: t.assignee,
          task_id: t.id,
          text: 'Oldin qabul qilingan',
          data: { verdict: ts.warned ? 'revise' : 'approve', score: ts.score ?? 0, issues: [], attempt: ts.attempt, accepted: true, restored: true },
        });
        this.emitState(t.assignee, 'done', 'Tayyor', t.id);
      }
    }
  }

  /** Bitta vazifa: yozish → uslubchi tekshiruvi → (qayta ishlash). Holat har bosqichda saqlanadi. */
  private async runTask(t: PlanTask, req: RunRequest): Promise<void> {
    const maxRev = this.cfg.kafedra.limits.max_revisions;
    const ts = this.state!.tasks[t.id]!;
    const rubric = this.cfg.deliverables.deliverables[t.deliverable_type]?.rubric ?? [];
    const deps = t.depends_on
      .map((d) => ({ id: d, text: this.snapshot.deliverables[d] }))
      .filter((d): d is { id: string; text: string } => !!d.text)
      .map((d) => fence('material', d.text.length > DEP_CHAR_LIMIT ? `${d.text.slice(0, DEP_CHAR_LIMIT)}\n[…qisqartirildi]` : d.text))
      .join('\n\n');

    for (;;) {
      let text: string;
      if (ts.status === 'written' && this.snapshot.deliverables[t.id]) {
        text = this.snapshot.deliverables[t.id]!; // davom ettirish: yozilgan, tekshiruv kutilgan
      } else {
        const attempt = ts.attempt;
        text = await this.withAgent(t.assignee, async () => {
          this.emitState(t.assignee, 'writing', attempt ? "Izohlar bo'yicha tuzatyapman…" : 'Yozyapman…', t.id);
          const out = await this.call(
            t.assignee,
            req,
            [
              fence('topshiriq', req.task),
              sourceBlock(req, MATERIAL_CHAR_LIMIT),
              `Vazifa: ${t.title}\n${t.instructions}`,
              `Qabul mezonlari:\n${t.acceptance_criteria.map((c) => `- ${c}`).join('\n') || '-'}`,
              `Uslubchi rubrikasi:\n${rubric.map((c) => `- ${c}`).join('\n') || '-'}`,
              deps,
              ts.feedback ? `Uslubchi izohlari (hammasini hisobga ol):\n${ts.feedback}` : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
            { purpose: 'work', deliverableType: t.deliverable_type, taskTitle: t.title, attempt },
            'writing',
            t.id,
          );
          this.emitState(t.assignee, 'idle', 'Uslubchiga topshirdim', t.id);
          return out;
        });
        this.snapshot.deliverables[t.id] = text;
        this.save(`deliverables/${t.id}.md`, text);
        ts.status = 'written';
        this.saveState();
      }

      this.bus.emit({ type: 'handoff', agent: t.assignee, to: 'uslubchi', task_id: t.id, text: 'Tekshirib bering, iltimos' });

      const attempt = ts.attempt;
      let unreviewed = false;
      // Ob'ektiv format tekshiruvi: uslubchi yumshoq baholasa ham tuzilma buzilgan ish qaytariladi
      const lint = lintDeliverable(t.deliverable_type, text, { expectedCount: expectedCountFor(t.deliverable_type, t.instructions) });
      const lintText = lint.length
        ? `Avtomatik format tekshiruvi MUAMMOLARNI topdi:\n${lint.map((i) => `- ${i.place}: ${i.problem}`).join('\n')}`
        : "Avtomatik format tekshiruvi: muammo topilmadi (tuzilma, sonlar to'g'ri).";
      const modelReview = await this.withAgent('uslubchi', async () => {
        this.emitState('uslubchi', 'reviewing', `Tekshiryapman: ${short(t.title, 30)}`, t.id);
        try {
          return await this.callJson(
            Review,
            'uslubchi',
            req,
            [
              `Rubrika:\n${rubric.map((c) => `- ${c}`).join('\n') || '-'}`,
              `Qabul mezonlari:\n${t.acceptance_criteria.map((c) => `- ${c}`).join('\n') || '-'}`,
              `Vazifa: ${t.title}\n${t.instructions}`,
              lintText,
              fence('tekshiriladigan_matn', text),
            ].join('\n\n'),
            { purpose: 'review', deliverableType: t.deliverable_type, taskTitle: t.title, attempt },
            'reviewing',
            t.id,
          );
        } catch (e) {
          if (!(e instanceof JsonParseError)) throw e;
          // Uslubchi javobini o'qib bo'lmadi: ishni to'xtatmaymiz, ogohlantirish bilan qabul qilamiz
          unreviewed = true;
          return {
            verdict: 'revise' as const,
            score: 0,
            issues: [{ place: '-', problem: "Uslubchi javobi o'qilmadi, matnni qo'lda tekshiring", fix: '' }],
          };
        } finally {
          this.emitState('uslubchi', 'idle', undefined, t.id);
        }
      });
      // Format muammolari bor bo'lsa, "approve" ham qayta ishlashga aylanadi va izohlar birlashtiriladi
      let review = modelReview;
      if (lint.length) {
        const seen = new Set(lint.map((i) => i.problem));
        review = {
          verdict: modelReview.verdict === 'reject' ? 'reject' : 'revise',
          score: Math.min(modelReview.score || 6, 6),
          issues: [...lint, ...modelReview.issues.filter((i) => i.problem && !seen.has(i.problem))],
        };
      }
      this.save(`reviews/${t.id}-${attempt}.json`, JSON.stringify({ ...review, unreviewed, lint: lint.length }, null, 2));
      this.recordReview(t.id, attempt, review, unreviewed, lint.length);

      const approved = review.verdict === 'approve';
      // Uslubchi javobi o'qilmagan bo'lsa va format muammosi yo'q bo'lsa, ogohlantirish bilan qabul; muammo bo'lsa qayta ishlanadi
      const exhausted = !approved && ((unreviewed && lint.length === 0) || attempt >= maxRev);
      const accepted = approved || exhausted;
      this.bus.emit({
        type: 'review_result',
        agent: 'uslubchi',
        to: t.assignee,
        task_id: t.id,
        text: unreviewed && accepted
          ? "Tekshiruv o'qilmadi: ogohlantirish bilan qabul"
          : approved
            ? `Qabul: ${review.score}/10`
            : `${review.verdict === 'reject' ? 'Rad' : 'Qayta ishlang'}: ${review.score}/10`,
        data: { ...review, attempt, accepted, escalated: exhausted, unreviewed },
      });

      if (accepted) {
        if (exhausted && !unreviewed) {
          // Mudir hakam: qayta ishlash limiti tugadi, ogohlantirish bilan qabul qiladi
          this.emitState('mudir', 'thinking', 'Hakam sifatida qaror qabul qilyapman…', t.id);
          this.emitState('mudir', 'idle', `"${short(t.title, 30)}" ogohlantirish bilan qabul qilindi`, t.id);
        }
        ts.status = 'done';
        ts.score = review.score;
        ts.warned = !approved;
        this.saveState();
        this.emitState(t.assignee, 'done', approved ? 'Tayyor' : 'Ogohlantirish bilan qabul qilindi', t.id);
        return;
      }

      ts.feedback = review.issues.map((i) => `- ${i.place}: ${i.problem} → ${i.fix}`).join('\n');
      ts.attempt = attempt + 1;
      ts.status = 'pending';
      this.saveState();
      this.bus.emit({ type: 'handoff', agent: 'uslubchi', to: t.assignee, task_id: t.id, text: 'Izohlar bilan qaytaryapman' });
      this.bus.emit({
        type: 'revision_requested',
        agent: 'uslubchi',
        to: t.assignee,
        task_id: t.id,
        text: `${ts.attempt}-qayta ishlash so'raldi`,
        data: { issues: review.issues, attempt: ts.attempt },
      });
    }
  }

  private fail(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    const reason =
      e instanceof LimitExhaustedError
        ? 'limits_exhausted'
        : e instanceof BudgetExceededError
          ? 'budget'
          : e instanceof RunStoppedError
            ? 'stopped'
            : e instanceof RunLimitError
              ? 'run_limit'
              : e instanceof SensitiveRoutingError
            ? 'sensitive_routing'
            : e instanceof JsonParseError
              ? 'bad_json'
              : 'error';
    this.snapshot.status = 'failed';
    if (this.state) {
      this.state.status = 'failed';
      this.state.reason = reason;
      this.state.error = msg.slice(0, 500);
      this.saveState();
    }
    const resumable = !!this.runDir && existsSync(join(this.runDir, 'plan.json'));
    this.emitState('mudir', reason === 'limits_exhausted' ? 'waiting_rate_limit' : 'error', short(msg, 80));
    this.bus.emit({
      type: 'run_failed',
      agent: 'mudir',
      text:
        reason === 'limits_exhausted'
          ? 'Limit tugadi: ish saqlandi, keyinroq davom ettiring'
          : reason === 'stopped'
            ? resumable
              ? "To'xtatildi: tayyor qismlar saqlandi, davom ettirish mumkin"
              : "To'xtatildi"
            : reason === 'run_limit'
              ? "So'rovlar chegarasi tugadi: ish saqlandi (tokenlar himoyasi)"
              : reason === 'bad_json' && !resumable
            ? 'Model reja tuza olmadi (yaroqsiz JSON). Boshqa model yoki qayta urinib ko\'ring'
            : short(msg, 120),
      data: { error: msg, reason, resumable, run_id: this.snapshot.runId },
    });
  }
}
