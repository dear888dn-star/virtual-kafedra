import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/core/config';
import { EventBus } from '../src/core/events';
import { LANG_SAMPLES, renderLangReport } from '../src/core/langeval';
import { Orchestrator } from '../src/core/orchestrator';
import { detectPii } from '../src/privacy/pii';
import { Router, type ChainItem } from '../src/providers/router';
import { SensitiveRoutingError, type CompleteRequest, type Provider } from '../src/providers/types';
import { UsageStore } from '../src/providers/usage';
import { parseInline, parseMarkdown, safeHref } from '../src/shared/markdown';

// ---------- PII ----------

test('PII: telefon, email, pasport, karta topiladi va niqoblanadi', () => {
  const f = detectPii('Aloqa: +998 90 123 45 67, ali.valiyev@mail.uz, pasport AA1234567, karta 4111 1111 1111 1111.');
  const types = f.map((x) => x.type).sort();
  assert.deepEqual(types, ['card', 'email', 'passport', 'phone']);
  for (const x of f) assert.ok(x.sample.includes('***') && x.sample.length < 12);
});

test('PII: oddiy iqtisodiy raqamlar ogohlantirishni keltirib chiqarmaydi', () => {
  const f = detectPii("Mehmonxonada 40 ta xona, band bo'lish 65%, daromad 12 500 000 so'm, narx 120 000 dan 150 000 gacha, 2025-yil.");
  assert.deepEqual(f, []);
});

test('PII: Luhn xato 16 raqam karta emas, 14 raqam PINFL deb belgilanadi', () => {
  assert.ok(!detectPii('1234 5678 9012 3456').some((x) => x.type === 'card'));
  assert.ok(detectPii('JShShIR 31501985750123 raqami').some((x) => x.type === 'pinfl'));
});

// ---------- Markdown xavfsizligi ----------

test('Markdown: bloklar to\'g\'ri tahlil qilinadi', () => {
  const b = parseMarkdown('# Sarlavha\n\nMatn **qalin** va `kod`.\n\n- bir\n- ikki\n\n1. a\n2. b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> iqtibos\n\n```js\nx<y\n```\n---');
  assert.deepEqual(b.map((x) => x.t), ['h', 'p', 'list', 'list', 'table', 'quote', 'code', 'hr']);
  const table = b.find((x) => x.t === 'table');
  assert.equal(table?.t === 'table' && table.rows.length, 1);
});

test('Markdown: HTML va xavfli havolalar matn bo\'lib qoladi', () => {
  const [p] = parseMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> [bos](javascript:alert(1)) [ok](https://example.com/a)');
  assert.equal(p?.t, 'p');
  const inl = p!.t === 'p' ? p!.c : [];
  const links = inl.filter((n) => n.t === 'link');
  assert.equal(links.length, 1);
  assert.equal(links[0]!.t === 'link' && links[0]!.href, 'https://example.com/a');
  const text = inl.filter((n) => n.t === 'text').map((n) => (n.t === 'text' ? n.v : '')).join('');
  assert.ok(text.includes('<script>')); // matn sifatida: render textContent orqali bo'ladi
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html;base64,AAA'), null);
  assert.equal(safeHref('//evil.com'), null);
  assert.deepEqual(parseInline('a_b_c'), [{ t: 'text', v: 'a_b_c' }]);
});

// ---------- Maxfiy yo'naltirish ----------

const REQ: CompleteRequest = { system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 10, temperature: 0 };

function fake(id: string): Provider & { calls: number } {
  const p = {
    id,
    calls: 0,
    async complete(req: CompleteRequest) {
      p.calls++;
      return { text: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, provider: id, model: req.model ?? 'm' };
    },
  };
  return p;
}

function routerOf(items: ChainItem[]) {
  return new Router({
    chains: { mudir: items, uslubchi: items, oqituvchi: items },
    bus: new EventBus(),
    usage: new UsageStore(null),
    sleep: async () => {},
  });
}
const CTX = { agent: 't1', role: 'oqituvchi', state: 'writing' as const };

test('maxfiy: faqat trains_on_data=false provayder chaqiriladi, boshqalari tegilmaydi', async () => {
  const free = fake('free');
  const safe = fake('safe');
  const unk = fake('unk');
  const r = routerOf([
    { provider: free, trainsOnData: true, models: { default: 'm' } },
    { provider: unk, trainsOnData: 'unknown', models: { default: 'm' } },
    { provider: safe, trainsOnData: false, models: { default: 'm' } },
  ]);
  const res = await r.complete(REQ, { ...CTX, sensitive: true });
  assert.equal(res.provider, 'safe');
  assert.equal(free.calls + unk.calls, 0);
  // oddiy topshiriq zanjir boshidan ketadi
  assert.equal((await r.complete(REQ, CTX)).provider, 'free');
});

test('maxfiy: mos provayder yo\'q bo\'lsa jimgina bepul modelga yuborilmaydi', async () => {
  const free = fake('free');
  const unk = fake('unk');
  const r = routerOf([
    { provider: free, trainsOnData: true, models: { default: 'm' } },
    { provider: unk, trainsOnData: 'unknown', models: { default: 'm' } },
  ]);
  assert.deepEqual(r.missingForSensitive().sort(), ['mudir', 'oqituvchi', 'uslubchi']);
  await assert.rejects(r.complete(REQ, { ...CTX, sensitive: true }), (e: Error) => e instanceof SensitiveRoutingError);
  assert.equal(free.calls + unk.calls, 0);
});

test('maxfiy ish: mos provayder yo\'q bo\'lsa start() rad etadi, papka yaratilmaydi', async () => {
  const free = fake('free');
  const router = routerOf([{ provider: free, trainsOnData: true, models: { default: 'm' } }]);
  const runsDir = mkdtempSync(join(tmpdir(), 'kafedra-'));
  const orch = new Orchestrator(loadConfig(), new EventBus(), router, { runsDir });
  assert.throws(
    () => orch.start({ task: 'Imtihon savollari', sensitive: true, language: 'uz' }),
    (e: Error) => e instanceof SensitiveRoutingError && /Hech narsa bepul modelga yuborilmadi/.test(e.message),
  );
  assert.equal(free.calls, 0);
  assert.equal(orch.listRuns().length, 0);
});

// ---------- eval-lang hisoboti ----------

test('eval-lang: hisobot provayder/model bo\'yicha, avtomatik baholashsiz, kalitsizlar o\'tkazib yuboriladi', () => {
  const md = renderLangReport(
    [
      { provider: 'groq', model: 'm1', sample: 'S1', answer: 'Javob matni', error: null, ms: 1200 },
      { provider: 'groq', model: 'm1', sample: 'S2', answer: null, error: 'HTTP 429', ms: 300 },
    ],
    ['gemini: o\'tkazib yuborildi (GEMINI_API_KEY kaliti .env da yo\'q)'],
    '2026-10-24',
  );
  assert.match(md, /## groq \/ m1/);
  assert.match(md, /1\/2/);
  assert.match(md, /gemini: o'tkazib yuborildi/);
  assert.match(md, /Sizning bahoyingiz/);
  assert.equal(LANG_SAMPLES.length, 5);
  assert.match(renderLangReport([], [], '2026-10-24'), /Hech bir provayder ishga tushmadi/);
});
