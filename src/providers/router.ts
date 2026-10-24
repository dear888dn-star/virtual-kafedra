import type { EventBus } from '../core/events';
import type { AgentState } from '../shared/events';
import { RateLimiter, type Limits } from './limiter';
import {
  AuthError,
  BadRequestError,
  BudgetExceededError,
  LimitExhaustedError,
  RateLimitError,
  SensitiveRoutingError,
  TransientError,
  type CompleteRequest,
  type CompleteResult,
  type Provider,
} from './types';
import type { UsageStore } from './usage';

export interface ChainItem {
  provider: Provider;
  limits?: Limits;
  /** Rol bo'yicha model: mudir | uslubchi | oqituvchi | default */
  models?: Record<string, string>;
  /** Ma'lumot model o'qitishga ishlatiladimi. Faqat `false` maxfiy ishlarga yaroqli. */
  trainsOnData?: boolean | 'unknown';
  /** Haqiqiy provayderlar uchun true: modelsiz chaqirib bo'lmaydi */
  needsModel?: boolean;
  /** Kunlik hisoblagich qaysi vaqt zonasida nolga tushadi (Gemini: Pacific) */
  resetTz?: string;
  /** Narx: 1M token uchun USD */
  price?: { input_per_mtok: number; output_per_mtok: number };
  dailyBudgetUsd?: number;
}

export interface CallContext {
  agent: string;
  role: string;
  task_id?: string;
  sensitive?: boolean;
  /** Kutishdan keyin agentga qaytariladigan holat */
  state: AgentState;
}

export interface RouterOptions {
  chains: Record<string, ChainItem[]>;
  bus: EventBus;
  usage: UsageStore;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  /** 429/5xx/timeout bo'lsa shu provayderda necha marta qayta uriniladi */
  retries?: number;
  baseBackoffMs?: number;
  /** Shundan uzun kutishni kutmaymiz, keyingi provayderga o'tamiz */
  maxWaitMs?: number;
  /** Kutish vaqtini (UI uchun emas, haqiqiy sleep uchun) masshtablash; mock tezligi uchun */
  waitScale?: number;
}

interface Slot extends ChainItem {
  id: string;
  limiter: RateLimiter;
  dead: string | null;
}

const estTokens = (req: CompleteRequest): number =>
  Math.ceil((req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0)) / 4) + Math.min(req.maxTokens, 2000);

/**
 * Fallback zanjiri: har rol uchun tartiblangan provayderlar.
 * Siyosat: limiter ruxsat bermasa qisqa kutadi yoki o'tadi; 429/5xx/timeout bo'lsa eksponensial
 * kutish bilan retries marta qayta uradi (Retry-After bo'lsa unga rioya), so'ng keyingisiga o'tadi.
 * Hammasi tugasa LimitExhaustedError. Byudjet tugasa BudgetExceededError (to'xtab so'raladi).
 */
export class Router {
  private slots = new Map<string, Slot[]>();
  private now: () => number;
  private retries: number;
  private backoff: number;
  private maxWait: number;
  private scale: number;

  constructor(private o: RouterOptions) {
    this.now = o.now ?? Date.now;
    this.retries = o.retries ?? 2;
    this.backoff = o.baseBackoffMs ?? 1000;
    this.maxWait = o.maxWaitMs ?? 60_000;
    this.scale = o.waitScale ?? 1;
    // Bir xil provayder bir nechta rol zanjirida bo'lsa limiter umumiy bo'lishi kerak.
    const shared = new Map<Provider, Slot>();
    for (const [role, items] of Object.entries(o.chains)) {
      if (items.length === 0) throw new Error(`"${role}" uchun provayder zanjiri bo'sh`);
      this.slots.set(
        role,
        items.map((it) => {
          let s = shared.get(it.provider);
          if (!s) {
            s = {
              ...it,
              id: it.provider.id,
              dead: null,
              limiter: new RateLimiter(it.provider.id, it.limits ?? {}, o.usage, it.resetTz ?? 'UTC', this.now),
            };
            shared.set(it.provider, s);
          }
          return s;
        }),
      );
    }
  }

  /** Maxfiy ish uchun mos provayderi yo'q rollar (bo'sh ro'yxat = hammasi joyida). */
  missingForSensitive(): string[] {
    const roles = [...this.slots.keys()].filter((k) => k !== '*' || this.slots.size === 1);
    return roles.filter((r) => !this.slots.get(r)!.some((s) => s.trainsOnData === false));
  }

  /** UI uchun: har bir provayderning bugungi hisobi. */
  snapshot(): Record<string, { requests: number; limit: number | null; cost_usd: number }> {
    const out: Record<string, { requests: number; limit: number | null; cost_usd: number }> = {};
    for (const list of this.slots.values()) {
      for (const s of list) {
        const t = this.o.usage.today(s.id, s.resetTz ?? 'UTC');
        out[s.id] = { requests: t.requests, limit: s.limits?.rpd ?? null, cost_usd: t.cost_usd };
      }
    }
    return out;
  }

  private cost(s: Slot, u: { inputTokens: number; outputTokens: number }): number {
    if (!s.price) return 0;
    return (u.inputTokens * s.price.input_per_mtok + u.outputTokens * s.price.output_per_mtok) / 1e6;
  }

  private emitWait(ctx: CallContext, s: Slot, waitMs: number, why: string): void {
    this.o.bus.emit({
      type: 'agent_state',
      agent: ctx.agent,
      task_id: ctx.task_id,
      state: 'waiting_rate_limit',
      text: `${s.id} ${why}, ${Math.max(1, Math.round(waitMs / 1000))} soniyada qayta uriniladi`,
    });
  }

  private emitSwitch(ctx: CallContext, from: Slot, to: Slot | undefined, reason: string): void {
    this.o.bus.emit({
      type: 'provider_switch',
      agent: ctx.agent,
      task_id: ctx.task_id,
      text: to ? `${from.id} → ${to.id} (${reason})` : `${from.id}: ${reason}`,
      data: { from: from.id, to: to?.id ?? null, reason },
    });
  }

  private resume(ctx: CallContext): void {
    this.o.bus.emit({ type: 'agent_state', agent: ctx.agent, task_id: ctx.task_id, state: ctx.state });
  }

  async complete(req: CompleteRequest, ctx: CallContext): Promise<CompleteResult> {
    const full = this.slots.get(ctx.role) ?? this.slots.get('*');
    if (!full) throw new Error(`"${ctx.role}" roli uchun provayder zanjiri yo'q`);
    // Maxfiy topshiriq: faqat ma'lumotni o'qitmaydigan (trains_on_data: false) provayderlar. Jimgina boshqasiga o'tilmaydi.
    const chain = ctx.sensitive ? full.filter((s) => s.trainsOnData === false) : full;
    if (chain.length === 0) throw new SensitiveRoutingError([ctx.role]);
    const reasons: string[] = [];
    let soonest: number | null = null;
    const noteRetry = (ms: number) => {
      const at = this.now() + ms;
      soonest = soonest === null ? at : Math.min(soonest, at);
    };

    for (let i = 0; i < chain.length; i++) {
      const s = chain[i]!;
      const next = chain.slice(i + 1).find((x) => !x.dead);
      if (s.dead) {
        reasons.push(`${s.id}: ${s.dead}`);
        continue;
      }
      const model = s.models?.[ctx.role] ?? s.models?.default;
      if (!model && s.needsModel) {
        s.dead = 'model tanlanmagan';
        reasons.push(`${s.id}: model tanlanmagan`);
        continue;
      }

      // Byudjet: pullik provayder kunlik chegaradan oshsa to'xtaymiz
      if (s.dailyBudgetUsd !== undefined) {
        const spent = this.o.usage.today(s.id, s.resetTz ?? 'UTC').cost_usd;
        if (spent >= s.dailyBudgetUsd) {
          throw new BudgetExceededError(
            `${s.id}: kunlik byudjet tugadi ($${spent.toFixed(4)} / $${s.dailyBudgetUsd}). Davom etish uchun byudjetni oshiring yoki ertaga urinib ko'ring.`,
            s.id,
          );
        }
      }

      // Limiter: qisqa kutamiz yoki keyingisiga o'tamiz
      let avail = s.limiter.check(estTokens(req));
      if (!avail.ok) {
        const why = { rpm: "daqiqalik limit", tpm: 'token limiti', rpd: 'kunlik limit', cooldown: 'sovish' }[avail.reason];
        // Bir nechta agent bir vaqtda kutayotgan bo'lishi mumkin: uyg'ongach boshqasi joyni egallagan bo'lsa, yana kutamiz
        for (let spins = 0; spins < 8 && !avail.ok; spins++) {
          const reason = avail.reason;
          if (reason === 'rpd' || avail.waitMs > this.maxWait || (next && avail.waitMs > 10_000)) break;
          this.emitWait(ctx, s, avail.waitMs, why);
          await this.o.sleep(Math.round(avail.waitMs * this.scale));
          this.resume(ctx);
          avail = s.limiter.check(estTokens(req));
        }
        if (!avail.ok) {
          reasons.push(`${s.id}: ${why}`);
          noteRetry(avail.waitMs);
          if (next) this.emitSwitch(ctx, s, next, why);
          continue;
        }
      }

      for (let attempt = 0; ; attempt++) {
        s.limiter.reserve();
        try {
          const res = await s.provider.complete({ ...req, model });
          const cost = this.cost(s, res.usage);
          const day = this.o.usage.record(s.id, s.resetTz ?? 'UTC', res.usage, cost);
          s.limiter.addTokens(res.usage.inputTokens + res.usage.outputTokens);
          this.o.bus.emit({
            type: 'usage_update',
            agent: ctx.agent,
            task_id: ctx.task_id,
            data: {
              provider: res.provider,
              model: res.model,
              input_tokens: res.usage.inputTokens,
              output_tokens: res.usage.outputTokens,
              requests_today: day.requests,
              limit_per_day: s.limits?.rpd ?? null,
              cost_usd_today: day.cost_usd,
            },
          });
          return res;
        } catch (e) {
          const retryable = e instanceof RateLimitError || e instanceof TransientError;
          if (retryable) {
            const hint = e instanceof RateLimitError ? e.retryAfterMs : null;
            const wait = hint ?? this.backoff * 2 ** attempt;
            // Kunlik kvota tugagan bo'lsa qayta urinishdan foyda yo'q: hisobni eslab qolamiz va keyingisiga o'tamiz
            const dailyOut = e instanceof RateLimitError && e.daily;
            if (dailyOut && s.limits?.rpd) this.o.usage.markExhausted(s.id, s.resetTz ?? 'UTC', s.limits.rpd);
            if (!dailyOut && attempt < this.retries && wait <= this.maxWait) {
              this.emitWait(ctx, s, wait, e instanceof RateLimitError ? 'limiti' : 'javob bermadi');
              await this.o.sleep(Math.round(wait * this.scale));
              this.resume(ctx);
              continue;
            }
            // Qayta urinishlar tugadi: provayderni sovitib, keyingisiga o'tamiz
            const cool = hint ?? this.backoff * 2 ** attempt;
            if (e instanceof RateLimitError) s.limiter.coolDown(Math.min(cool, 24 * 3_600_000));
            const reason = dailyOut ? 'kunlik kvota tugadi' : e instanceof RateLimitError ? 'limit (429)' : 'xato/timeout';
            reasons.push(`${s.id}: ${reason}`);
            noteRetry(cool);
            if (next) this.emitSwitch(ctx, s, next, reason);
            break;
          }
          if (e instanceof AuthError || e instanceof BadRequestError) {
            // Kalit yoki so'rov shu provayderga mos emas: sessiya davomida o'tkazib yuboramiz
            s.dead = e instanceof AuthError ? 'kalit rad etildi' : "so'rov rad etildi";
            reasons.push(`${s.id}: ${s.dead}`);
            if (next) this.emitSwitch(ctx, s, next, s.dead);
            break;
          }
          throw e;
        }
      }
    }
    const when = soonest ? ` Eng erta qayta urinish: ${new Date(soonest).toISOString().slice(11, 19)} UTC.` : '';
    throw new LimitExhaustedError(`Barcha provayderlar limitda yoki ishlamayapti (${reasons.join('; ')}).${when}`, soonest);
  }
}
