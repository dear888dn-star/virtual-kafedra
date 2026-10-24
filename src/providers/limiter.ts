import type { UsageStore } from './usage';

export interface Limits {
  rpm?: number;
  rpd?: number;
  tpm?: number;
}

export type Availability =
  | { ok: true }
  | { ok: false; reason: 'rpm' | 'tpm' | 'cooldown'; waitMs: number }
  | { ok: false; reason: 'rpd'; waitMs: number };

const MINUTE = 60_000;

/**
 * Bitta provayder uchun: daqiqalik sirpanuvchi oyna (so'rov va token) + kunlik hisoblagich
 * (UsageStore orqali, qayta ishga tushirganda saqlanadi) + 429 dan keyingi sovish vaqti.
 */
export class RateLimiter {
  private stamps: number[] = [];
  private tokenStamps: { t: number; n: number }[] = [];
  private cooldownUntil = 0;

  constructor(
    private id: string,
    private limits: Limits,
    private usage: UsageStore,
    private timeZone: string,
    private now: () => number,
  ) {}

  private prune(t: number): void {
    this.stamps = this.stamps.filter((s) => t - s < MINUTE);
    this.tokenStamps = this.tokenStamps.filter((s) => t - s.t < MINUTE);
  }

  /** Chaqiruvdan oldin tekshiradi. `estTokens` — taxminiy kirish tokenlari. */
  check(estTokens = 0): Availability {
    const t = this.now();
    if (t < this.cooldownUntil) return { ok: false, reason: 'cooldown', waitMs: this.cooldownUntil - t };
    if (this.limits.rpd !== undefined && this.usage.today(this.id, this.timeZone).requests >= this.limits.rpd) {
      return { ok: false, reason: 'rpd', waitMs: msUntilNextDay(t, this.timeZone) };
    }
    this.prune(t);
    if (this.limits.rpm !== undefined && this.stamps.length >= this.limits.rpm) {
      return { ok: false, reason: 'rpm', waitMs: Math.max(1, MINUTE - (t - this.stamps[0]!)) };
    }
    if (this.limits.tpm !== undefined) {
      const used = this.tokenStamps.reduce((n, s) => n + s.n, 0);
      if (used + estTokens > this.limits.tpm && this.tokenStamps.length > 0) {
        return { ok: false, reason: 'tpm', waitMs: Math.max(1, MINUTE - (t - this.tokenStamps[0]!.t)) };
      }
    }
    return { ok: true };
  }

  /** Chaqiruv jo'natilishidan oldin so'rovni hisoblaydi. */
  reserve(): void {
    this.stamps.push(this.now());
  }

  addTokens(n: number): void {
    this.tokenStamps.push({ t: this.now(), n });
  }

  /** 429 dan keyin provayderni vaqtincha o'tkazib yuborish. */
  coolDown(ms: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + ms);
  }
}

/** Provayder kuni tugashigacha qolgan vaqt (taxminiy: 1 daqiqalik qadam bilan qidiradi). */
export function msUntilNextDay(t: number, timeZone: string): number {
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const today = fmt(t);
  let lo = t;
  let hi = t + 25 * 3_600_000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (fmt(mid) === today) lo = mid;
    else hi = mid;
  }
  return hi - t;
}
