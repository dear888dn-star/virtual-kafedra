import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface DayUsage {
  day: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

type UsageFile = { providers: Record<string, DayUsage> };

/** Provayderning "bugungi kuni" kaliti (YYYY-MM-DD) berilgan vaqt zonasida. */
export function dayKey(ms: number, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

/** Kunlik hisoblagichlar. `path` berilsa state/usage.json ga saqlanadi va qayta ishga tushirganda tiklanadi. */
export class UsageStore {
  private data: UsageFile = { providers: {} };

  constructor(
    private path: string | null,
    private now: () => number = Date.now,
  ) {
    if (path && existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as UsageFile;
        if (parsed && typeof parsed.providers === 'object') this.data = parsed;
      } catch {
        // buzilgan fayl: noldan boshlaymiz (eski nusxa .bak sifatida qoladi)
        try {
          renameSync(path, `${path}.bak`);
        } catch {
          // e'tibor bermaymiz
        }
      }
    }
  }

  /** Bugungi hisob. Kun o'zgargan bo'lsa nolga qaytadi. */
  today(provider: string, timeZone = 'UTC'): DayUsage {
    const day = dayKey(this.now(), timeZone);
    const cur = this.data.providers[provider];
    if (cur && cur.day === day) return cur;
    const fresh: DayUsage = { day, requests: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0 };
    this.data.providers[provider] = fresh;
    return fresh;
  }

  record(provider: string, timeZone: string, usage: { inputTokens: number; outputTokens: number }, costUsd: number): DayUsage {
    const t = this.today(provider, timeZone);
    t.requests += 1;
    t.tokens_in += usage.inputTokens;
    t.tokens_out += usage.outputTokens;
    t.cost_usd = Math.round((t.cost_usd + costUsd) * 1e6) / 1e6;
    this.save();
    return t;
  }

  private save(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      renameSync(tmp, this.path);
    } catch {
      // saqlab bo'lmasa ham ish davom etadi (hisob xotirada qoladi)
    }
  }
}
