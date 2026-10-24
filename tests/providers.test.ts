import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EventBus } from '../src/core/events';
import { RateLimiter, msUntilNextDay } from '../src/providers/limiter';
import { OpenAICompatProvider, parseQuotaError, parseRetryAfter } from '../src/providers/openai-compat';
import { Router, type CallContext, type ChainItem } from '../src/providers/router';
import {
  AuthError,
  BudgetExceededError,
  LimitExhaustedError,
  RateLimitError,
  TransientError,
  type CompleteRequest,
  type Provider,
} from '../src/providers/types';
import { UsageStore, dayKey } from '../src/providers/usage';

const REQ: CompleteRequest = { system: 's', messages: [{ role: 'user', content: 'salom' }], maxTokens: 100, temperature: 0 };
const CTX: CallContext = { agent: 't1', role: 'oqituvchi', state: 'writing' };

/** Soxta soat: sleep vaqtni oldinga suradi. */
function clock(start = Date.UTC(2026, 0, 1, 12, 0, 0)) {
  const c = { t: start, slept: [] as number[] };
  return {
    c,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.slept.push(ms);
      c.t += ms;
    },
  };
}

type Script = (call: number) => Error | null;
function fake(id: string, script: Script = () => null): Provider & { calls: number; models: (string | undefined)[] } {
  const p = {
    id,
    calls: 0,
    models: [] as (string | undefined)[],
    async complete(req: CompleteRequest) {
      p.calls++;
      p.models.push(req.model);
      const err = script(p.calls);
      if (err) throw err;
      return { text: 'ok', usage: { inputTokens: 10, outputTokens: 5 }, provider: id, model: req.model ?? 'm' };
    },
  };
  return p;
}

function setup(items: ChainItem[], over: Partial<ConstructorParameters<typeof Router>[0]> = {}) {
  const k = clock();
  const bus = new EventBus();
  bus.reset(null);
  const usage = new UsageStore(null, k.now);
  const router = new Router({ chains: { oqituvchi: items }, bus, usage, sleep: k.sleep, now: k.now, ...over });
  return { k, bus, usage, router };
}

// ---------- limiter ----------

test('limiter: rpm sirpanuvchi oyna', () => {
  const k = clock();
  const l = new RateLimiter('p', { rpm: 2 }, new UsageStore(null, k.now), 'UTC', k.now);
  assert.equal(l.check().ok, true);
  l.reserve();
  k.c.t += 10_000;
  l.reserve();
  const r = l.check();
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'rpm');
    assert.equal(r.waitMs, 50_000);
  }
  k.c.t += 50_001;
  assert.equal(l.check().ok, true);
});

test('limiter: kunlik hisoblagich va UTC yarim tunda yangilanish', () => {
  const k = clock(Date.UTC(2026, 0, 1, 23, 30, 0));
  const usage = new UsageStore(null, k.now);
  const l = new RateLimiter('p', { rpd: 2 }, usage, 'UTC', k.now);
  usage.record('p', 'UTC', { inputTokens: 1, outputTokens: 1 }, 0);
  usage.record('p', 'UTC', { inputTokens: 1, outputTokens: 1 }, 0);
  const r = l.check();
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'rpd');
    assert.ok(Math.abs(r.waitMs - 30 * 60_000) < 2000);
  }
  k.c.t += 31 * 60_000; // yarim tundan keyin
  assert.equal(l.check().ok, true);
  assert.equal(usage.today('p').requests, 0);
});

test('provayder kuni vaqt zonasiga bog\'liq (Pacific)', () => {
  const t = Date.UTC(2026, 0, 1, 5, 0, 0); // UTC 05:00 = Pacific 21:00 oldingi kun
  assert.equal(dayKey(t, 'UTC'), '2026-01-01');
  assert.equal(dayKey(t, 'America/Los_Angeles'), '2025-12-31');
  assert.ok(msUntilNextDay(t, 'America/Los_Angeles') > 2.9 * 3_600_000);
  assert.ok(msUntilNextDay(t, 'America/Los_Angeles') < 3.1 * 3_600_000);
});

test('usage.json: qayta ishga tushganda tiklanadi', () => {
  const k = clock();
  const path = join(mkdtempSync(join(tmpdir(), 'usage-')), 'usage.json');
  const a = new UsageStore(path, k.now);
  a.record('groq', 'UTC', { inputTokens: 5, outputTokens: 7 }, 0.01);
  const b = new UsageStore(path, k.now);
  assert.equal(b.today('groq').requests, 1);
  assert.equal(b.today('groq').tokens_out, 7);
  writeFileSync(path, '{buzilgan');
  assert.equal(new UsageStore(path, k.now).today('groq').requests, 0);
  assert.ok(readFileSync(`${path}.bak`, 'utf8').includes('buzilgan'));
});

// ---------- router: qayta urinish va fallback ----------

test('429: Retry-After ga rioya qilib qayta uriniladi, keyin muvaffaqiyat', async () => {
  const a = fake('a', (n) => (n === 1 ? new RateLimitError('429', 7000) : null));
  const { k, router, bus } = setup([{ provider: a, models: { default: 'm1' } }]);
  const res = await router.complete(REQ, CTX);
  assert.equal(res.provider, 'a');
  assert.equal(a.calls, 2);
  assert.deepEqual(k.c.slept, [7000]);
  assert.ok(bus.all().some((e) => e.state === 'waiting_rate_limit' && /7 soniya/.test(e.text ?? '')));
  assert.ok(bus.all().some((e) => e.type === 'usage_update'));
});

test('5xx/timeout: eksponensial kutish 1s, 2s, so\'ng keyingi provayder', async () => {
  const a = fake('a', () => new TransientError('500'));
  const b = fake('b');
  const { k, router, bus } = setup([
    { provider: a, models: { default: 'm' } },
    { provider: b, models: { default: 'm' } },
  ]);
  const res = await router.complete(REQ, CTX);
  assert.equal(res.provider, 'b');
  assert.equal(a.calls, 3); // 1 urinish + 2 qayta urinish
  assert.deepEqual(k.c.slept, [1000, 2000]);
  const sw = bus.all().filter((e) => e.type === 'provider_switch');
  assert.equal(sw.length, 1);
  assert.equal(sw[0]!.data?.from, 'a');
  assert.equal(sw[0]!.data?.to, 'b');
});

test('fallback ketma-ketligi zanjir tartibida: a → b → c', async () => {
  const a = fake('a', () => new RateLimitError('429', 100));
  const b = fake('b', () => new TransientError('503'));
  const c = fake('c');
  const { router, bus } = setup([
    { provider: a, models: { default: 'm' } },
    { provider: b, models: { default: 'm' } },
    { provider: c, models: { default: 'm' } },
  ]);
  const res = await router.complete(REQ, CTX);
  assert.equal(res.provider, 'c');
  const route = bus.all().filter((e) => e.type === 'provider_switch').map((e) => `${e.data?.from}>${e.data?.to}`);
  assert.deepEqual(route, ['a>b', 'b>c']);
});

test('sovitilgan provayder keyingi chaqiruvda qayta urinilmaydi (cooldown)', async () => {
  const a = fake('a', () => new RateLimitError('429', 30_000));
  const b = fake('b');
  const { router } = setup([
    { provider: a, models: { default: 'm' } },
    { provider: b, models: { default: 'm' } },
  ]);
  await router.complete(REQ, CTX);
  const callsAfterFirst = a.calls;
  await router.complete(REQ, CTX);
  assert.equal(a.calls, callsAfterFirst);
});

test('401: provayder o\'tkazib yuboriladi va qayta chaqirilmaydi', async () => {
  const a = fake('a', () => new AuthError('401'));
  const b = fake('b');
  const { router } = setup([
    { provider: a, models: { default: 'm' } },
    { provider: b, models: { default: 'm' } },
  ]);
  await router.complete(REQ, CTX);
  await router.complete(REQ, CTX);
  assert.equal(a.calls, 1);
  assert.equal(b.calls, 2);
});

test('hammasi limitda: aniq LimitExhaustedError', async () => {
  const a = fake('a', () => new RateLimitError('429', 5000));
  const { router } = setup([{ provider: a, models: { default: 'm' } }]);
  await assert.rejects(router.complete(REQ, CTX), (e: Error) => {
    assert.ok(e instanceof LimitExhaustedError);
    assert.match(e.message, /limit/i);
    return true;
  });
});

test('kunlik limit (rpd) tugagan provayder o\'tkazib yuboriladi', async () => {
  const a = fake('a');
  const b = fake('b');
  const { router, usage } = setup([
    { provider: a, models: { default: 'm' }, limits: { rpd: 1 } },
    { provider: b, models: { default: 'm' } },
  ]);
  usage.record('a', 'UTC', { inputTokens: 1, outputTokens: 1 }, 0);
  const res = await router.complete(REQ, CTX);
  assert.equal(res.provider, 'b');
  assert.equal(a.calls, 0);
});

test('rol bo\'yicha model tanlanadi, modelsiz real provayder o\'tkazib yuboriladi', async () => {
  const a = fake('a');
  const b = fake('b');
  const { router } = setup([
    { provider: a, needsModel: true, models: {} },
    { provider: b, needsModel: true, models: { default: 'x', oqituvchi: 'teacher-model' } },
  ]);
  const res = await router.complete(REQ, CTX);
  assert.equal(res.provider, 'b');
  assert.equal(a.calls, 0);
  assert.deepEqual(b.models, ['teacher-model']);
});

// ---------- xarajat nazorati ----------

test('byudjet: narx hisoblanadi va chegaradan oshganda to\'xtaydi', async () => {
  const a = fake('a');
  const { router, usage } = setup([
    {
      provider: a,
      models: { default: 'm' },
      price: { input_per_mtok: 1_000_000, output_per_mtok: 1_000_000 }, // 1 token = $1
      dailyBudgetUsd: 20,
    },
  ]);
  await router.complete(REQ, CTX); // 10 + 5 token = $15
  assert.equal(usage.today('a').cost_usd, 15);
  await router.complete(REQ, CTX); // $30 > 20
  await assert.rejects(router.complete(REQ, CTX), (e: Error) => e instanceof BudgetExceededError);
  assert.equal(a.calls, 2);
});

// ---------- adapter ----------

function resp(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

test('adapter: so\'rov shakli va javobni o\'qish', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const p = new OpenAICompatProvider('x', {
    baseUrl: 'https://example.test/v1/',
    apiKey: 'KALIT',
    jsonMode: 'json_object',
    fetchFn: (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return resp(200, { choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 11, completion_tokens: 3 }, model: 'real-m' });
    }) as unknown as typeof fetch,
  });
  const r = await p.complete({ ...REQ, model: 'm', json: true });
  assert.equal(r.text, '{"a":1}');
  assert.deepEqual(r.usage, { inputTokens: 11, outputTokens: 3 });
  assert.equal(seen!.url, 'https://example.test/v1/chat/completions');
  const body = JSON.parse(String(seen!.init.body));
  assert.equal(body.model, 'm');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages[0].role, 'system');
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Bearer KALIT');
});

test('adapter: HTTP xatolari to\'g\'ri turga aylanadi va kalitni oshkor qilmaydi', async () => {
  const mk = (status: number, headers: Record<string, string> = {}) =>
    new OpenAICompatProvider('x', {
      baseUrl: 'https://example.test/v1',
      apiKey: 'SIRKALIT',
      fetchFn: (async () => resp(status, 'xato matni', headers)) as unknown as typeof fetch,
    });
  await assert.rejects(mk(429, { 'retry-after': '12' }).complete({ ...REQ, model: 'm' }), (e: Error) => e instanceof RateLimitError && e.retryAfterMs === 12000);
  await assert.rejects(mk(503).complete({ ...REQ, model: 'm' }), (e: Error) => e instanceof TransientError);
  await assert.rejects(mk(401).complete({ ...REQ, model: 'm' }), (e: Error) => e instanceof AuthError && !e.message.includes('SIRKALIT'));
});

test('adapter: tarmoq xatosi va timeout TransientError bo\'ladi', async () => {
  const p = new OpenAICompatProvider('x', {
    baseUrl: 'https://example.test/v1',
    apiKey: 'k',
    timeoutMs: 20,
    fetchFn: ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))))) as unknown as typeof fetch,
  });
  await assert.rejects(p.complete({ ...REQ, model: 'm' }), (e: Error) => e instanceof TransientError && /timeout/.test(e.message));
});

test('Retry-After: soniya va HTTP sana', () => {
  assert.equal(parseRetryAfter('5'), 5000);
  assert.equal(parseRetryAfter(null), null);
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now), 10_000);
});

test('adapter: reasoning_effort yuboriladi, fikrlash zaxirasi qo\'shiladi', async () => {
  const bodies: Record<string, unknown>[] = [];
  const p = new OpenAICompatProvider('x', {
    baseUrl: 'https://example.test/v1',
    apiKey: 'k',
    reasoningEffort: 'low',
    fetchFn: (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return resp(200, { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] });
    }) as unknown as typeof fetch,
  });
  await p.complete({ ...REQ, model: 'm', maxTokens: 100 });
  assert.equal(bodies[0]!.reasoning_effort, 'low');
  assert.equal(bodies[0]!.max_tokens, 2148);
});

test('adapter: bo\'sh (token chegarasi) javobda chegarani oshirib qayta uriladi', async () => {
  const limits: number[] = [];
  const p = new OpenAICompatProvider('x', {
    baseUrl: 'https://example.test/v1',
    apiKey: 'k',
    fetchFn: (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      limits.push(b.max_tokens);
      return limits.length === 1
        ? resp(200, { choices: [{ finish_reason: 'length', message: { role: 'assistant' } }] })
        : resp(200, { choices: [{ finish_reason: 'stop', message: { content: 'to\'liq javob' } }] });
    }) as unknown as typeof fetch,
  });
  const r = await p.complete({ ...REQ, model: 'm', maxTokens: 100 });
  assert.equal(r.text, "to'liq javob");
  assert.deepEqual(limits, [100, 300]);
});

test('adapter: ikkinchi urinishda ham kesilgan bo\'lsa, bor matn qaytariladi; butunlay bo\'sh bo\'lsa xato', async () => {
  const mk = (content?: string) =>
    new OpenAICompatProvider('x', {
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      fetchFn: (async () => resp(200, { choices: [{ finish_reason: 'length', message: content === undefined ? {} : { content } }] })) as unknown as typeof fetch,
    });
  assert.equal((await mk('yarmi').complete({ ...REQ, model: 'm' })).text, 'yarmi');
  await assert.rejects(mk().complete({ ...REQ, model: 'm' }), (e: Error) => e instanceof TransientError && /bo'sh javob/.test(e.message));
});

test('limiter: bir vaqtda kutayotgan agentlar navbat bilan o\'tadi, hech biri tashlab ketmaydi', async () => {
  const a = fake('a');
  const { router, k } = setup([{ provider: a, models: { default: 'm' }, limits: { rpm: 2 } }]);
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => router.complete(REQ, CTX)));
  assert.equal(results.length, 5);
  assert.equal(a.calls, 5);
  assert.ok(k.c.slept.length >= 2, 'kutish bo\'lishi kerak edi');
});

test('Google 429: kunlik kvota matni tahlil qilinadi (qayta urinish vaqti, daily)', () => {
  const body = JSON.stringify([
    {
      error: {
        code: 429,
        message: 'You exceeded your current quota.\n* Quota exceeded ... Generate content requests per day limit exceeded on Free Tier.\nPlease retry in 14h15m16.3s.',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '51316s' }],
      },
    },
  ]);
  const q = parseQuotaError(body);
  assert.equal(q.daily, true);
  assert.equal(q.retryMs, 51_316_000);
  assert.match(q.message, /exceeded your current quota/);
  const plain = parseQuotaError('rate limited. Please retry in 7s');
  assert.equal(plain.daily, false);
  assert.equal(plain.retryMs, 7000);
});

test('kunlik kvota tugasa: qayta urinmaydi, hisob saqlanadi, keyingi (boshqa model) provayderga o\'tadi', async () => {
  const a = fake('a', () => new RateLimitError('kunlik kvota', 50_000_000, true));
  const b = fake('b');
  const { router, usage, bus } = setup([
    { provider: a, models: { default: 'm' }, limits: { rpd: 20 } },
    { provider: b, models: { default: 'm' } },
  ]);
  const res = await router.complete(REQ, CTX);
  assert.equal(res.provider, 'b');
  assert.equal(a.calls, 1, 'kunlik kvotada qayta urinish bo\'lmasligi kerak');
  assert.equal(usage.today('a').requests, 20);
  assert.ok(bus.all().some((e) => e.type === 'provider_switch' && /kunlik kvota/.test(String(e.data?.reason))));
  // keyingi chaqiruvda a umuman chaqirilmaydi
  await router.complete(REQ, CTX);
  assert.equal(a.calls, 1);
});
