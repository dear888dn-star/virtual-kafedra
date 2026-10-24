import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boot } from '../src/core/bootstrap';
import { loadConfig } from '../src/core/config';

function cfgWith(enable: string[]) {
  const cfg = loadConfig();
  // Testlar foydalanuvchi sozlamalariga bog'liq bo'lmasligi uchun avval hamma real provayderni o'chiramiz
  for (const p of cfg.providers.providers) if (p.kind !== 'mock') p.enabled = enable.includes(p.id);
  return cfg;
}
const base = { usagePath: null, speed: 0, sleep: async () => {} };

test('kalitsiz: real provayder yoqilgan bo\'lsa ham aniq xabar bilan mock\'ga tushadi', () => {
  const app = boot({ ...base, cfg: cfgWith(['groq']), env: {} });
  assert.equal(app.mock, true);
  assert.ok(app.problems.some((p) => p.includes('groq') && p.includes('GROQ_API_KEY')));
});

test('hech narsa yoqilmagan: mock va tushuntirish', () => {
  const app = boot({ ...base, cfg: cfgWith([]), env: {} });
  assert.equal(app.mock, true);
  assert.ok(app.problems.some((p) => /yoqilmagan/.test(p)));
});

test('kalit bor va model berilgan: real rejim, zanjir rol bo\'yicha', () => {
  const app = boot({ ...base, cfg: cfgWith(['groq', 'gemini']), env: { GROQ_API_KEY: 'x', GEMINI_API_KEY: 'y' } });
  assert.equal(app.mock, false);
  assert.equal(app.problems.length, 0);
});

test('real rejimda ba\'zi rolga provayder yo\'q bo\'lsa aniq xato', () => {
  // groq faqat oqituvchi zanjirida; mudir zanjirida yo'q
  // cerebras faqat oqituvchi zanjirida turadi
  assert.throws(() => boot({ ...base, cfg: cfgWith(['cerebras']), env: { CEREBRAS_API_KEY: 'x' } }), /"mudir" roli uchun/);
});

test('MOCK=1 real kalit bo\'lsa ham mock\'ni majburlaydi', () => {
  const app = boot({ ...base, cfg: cfgWith(['gemini']), env: { GEMINI_API_KEY: 'x', MOCK: '1' } });
  assert.equal(app.mock, true);
});

test('pullik provayder byudjetsiz yoqilmaydi', () => {
  const cfg = cfgWith(['deepseek']);
  const ds = cfg.providers.providers.find((p) => p.id === 'deepseek')!;
  ds.daily_budget_usd = 0;
  const app = boot({ ...base, cfg, env: { DEEPSEEK_API_KEY: 'x' } });
  assert.equal(app.mock, true);
  assert.ok(app.problems.some((p) => p.includes('daily_budget_usd')));
});
