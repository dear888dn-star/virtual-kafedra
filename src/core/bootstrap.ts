import { join } from 'node:path';
import { MockProvider } from '../providers/mock';
import { OpenAICompatProvider } from '../providers/openai-compat';
import { Router, type ChainItem } from '../providers/router';
import { UsageStore } from '../providers/usage';
import type { ProviderCfg } from '../schemas';
import { loadConfig, ROOT, type AppConfig } from './config';
import { EventBus } from './events';
import { Orchestrator } from './orchestrator';

export interface App {
  cfg: AppConfig;
  bus: EventBus;
  orchestrator: Orchestrator;
  router: Router;
  mock: boolean;
  /** Foydalanuvchiga ko'rsatiladigan tushunarli ogohlantirishlar (kalit yo'q va h.k.) */
  problems: string[];
}

export interface BootOptions {
  speed?: number;
  rateLimitEvery?: number;
  runsDir?: string;
  /** null = hisoblagich faqat xotirada (testlar) */
  usagePath?: string | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  env?: Record<string, string | undefined>;
  /** Testlar uchun: konfigni almashtirish */
  cfg?: AppConfig;
  fetchFn?: typeof fetch;
}

const ROLES = ['mudir', 'uslubchi', 'oqituvchi'] as const;

function chainItem(p: ProviderCfg, provider: ChainItem['provider'], real: boolean): ChainItem {
  return {
    provider,
    trainsOnData: p.trains_on_data,
    limits: p.limits,
    models: p.models,
    needsModel: real,
    resetTz: p.reset_tz,
    price: p.price,
    dailyBudgetUsd: p.daily_budget_usd,
  };
}

/** Yoqilgan real provayderlarni yig'adi. Kalit/base_url/model yetishmasa, sababini aytib o'tkazib yuboradi. */
export function buildRealProviders(
  cfg: AppConfig,
  env: Record<string, string | undefined>,
  fetchFn?: typeof fetch,
): { items: Map<string, ChainItem>; enabled: ProviderCfg[]; problems: string[] } {
  const problems: string[] = [];
  const items = new Map<string, ChainItem>();
  const enabled = cfg.providers.providers.filter((p) => p.enabled && p.kind !== 'mock');
  for (const p of enabled) {
    const miss: string[] = [];
    let key = 'ollama';
    if (p.kind !== 'ollama') {
      key = (p.api_key_env ? env[p.api_key_env] : undefined) ?? '';
      if (!key) miss.push(`${p.api_key_env ?? 'api_key_env'} kaliti .env da yo'q`);
    }
    if (!p.base_url) miss.push('base_url berilmagan');
    if (!p.models?.default && !ROLES.some((r) => p.models?.[r])) miss.push('model nomi berilmagan');
    if (p.price && !p.daily_budget_usd) miss.push("pullik provayder: daily_budget_usd 0 dan katta bo'lishi kerak");
    if (miss.length) {
      problems.push(`${p.id}: o'tkazib yuborildi (${miss.join('; ')})`);
      continue;
    }
    const provider = new OpenAICompatProvider(p.id, {
      baseUrl: p.base_url!,
      apiKey: key,
      timeoutMs: p.timeout_ms,
      jsonMode: p.json_mode,
      maxTokensField: p.max_tokens_field,
      reasoningEffort: p.reasoning_effort,
      fetchFn,
    });
    items.set(p.id, chainItem(p, provider, true));
  }
  return { items, enabled, problems };
}

/**
 * Provayderlarni konfig va muhit o'zgaruvchilaridan yig'adi.
 * Real rejim faqat kamida bitta yoqilgan va to'liq sozlangan provayder bo'lsa va MOCK=1 bo'lmasa yoqiladi.
 * Aks holda mock ishlaydi, sababi `problems` da aniq yoziladi.
 */
export function boot(opts: BootOptions = {}): App {
  const cfg = opts.cfg ?? loadConfig();
  const env = opts.env ?? process.env;
  const speed = opts.speed ?? Number(env.MOCK_SPEED ?? 1);
  const rateLimitEvery = opts.rateLimitEvery ?? 7;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const usage = new UsageStore(opts.usagePath === undefined ? join(ROOT, 'state', 'usage.json') : opts.usagePath, opts.now);
  const bus = new EventBus();
  const problems: string[] = [];

  const { items: real, enabled: enabledReal, problems: realProblems } = buildRealProviders(cfg, env, opts.fetchFn);
  problems.push(...realProblems);

  const forceMock = env.MOCK === '1';
  let chains: Record<string, ChainItem[]>;
  let mock: boolean;
  if (forceMock || real.size === 0) {
    mock = true;
    if (forceMock) problems.push('MOCK=1: real provayderlar ishlatilmaydi.');
    else if (enabledReal.length === 0) problems.push("Hech bir real provayder yoqilmagan (config/providers.yaml). Mock rejimi ishlayapti.");
    else problems.push("Yoqilgan provayderlarning birortasi to'liq sozlanmagan. Mock rejimi ishlayapti.");
    const mockItems = cfg.providers.mock_chain.map((id) => {
      const pc = cfg.providers.providers.find((p) => p.id === id);
      if (!pc || pc.kind !== 'mock') throw new Error(`mock_chain: "${id}" mock provayder emas`);
      return chainItem(pc, new MockProvider(id, { speed, rateLimitEvery, sleep }), false);
    });
    chains = { '*': mockItems, mudir: mockItems, uslubchi: mockItems, oqituvchi: mockItems };
  } else {
    mock = false;
    chains = {};
    for (const role of ROLES) {
      const ids = cfg.providers.chains[role] ?? [];
      const items = ids.map((id) => real.get(id)).filter((x): x is ChainItem => !!x);
      if (items.length === 0) {
        throw new Error(
          `"${role}" roli uchun ishlaydigan provayder yo'q (zanjir: ${ids.join(', ') || 'bo\'sh'}). ` +
            `Sozlangan provayderlar: ${[...real.keys()].join(', ')}. config/providers.yaml dagi chains bo'limini tekshiring.`,
        );
      }
      chains[role] = items;
    }
  }

  const router = new Router({
    chains,
    bus,
    usage,
    sleep,
    now: opts.now,
    waitScale: mock ? speed : 1,
  });
  const orchestrator = new Orchestrator(cfg, bus, router, { runsDir: opts.runsDir ?? join(ROOT, 'runs') });
  return { cfg, bus, orchestrator, router, mock, problems };
}
