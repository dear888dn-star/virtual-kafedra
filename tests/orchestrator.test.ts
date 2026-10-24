import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { boot } from '../src/core/bootstrap';
import { MockProvider } from '../src/providers/mock';

async function runOnce(rateLimitEvery: number, task = 'Turizm bozorida talab va taklif') {
  MockProvider.resetCounter();
  const runsDir = mkdtempSync(join(tmpdir(), 'kafedra-'));
  const app = boot({ speed: 0, rateLimitEvery, runsDir, usagePath: null, env: {}, sleep: async () => {} });
  const runId = app.orchestrator.start({ task, sensitive: false, language: 'uz' });
  await app.orchestrator.done;
  return { app, runId, runsDir };
}

test('mock oqim: reja → vazifalar → tekshiruv → yakuniy hujjat', async () => {
  const { app, runId, runsDir } = await runOnce(0);
  const types = app.bus.all().map((e) => e.type);
  assert.equal(types[0], 'run_started');
  assert.ok(types.includes('plan_ready'));
  assert.ok(types.includes('review_result'));
  assert.equal(types[types.length - 1], 'run_finished');

  const snap = app.orchestrator.getSnapshot();
  assert.equal(snap.status, 'finished');
  assert.equal(snap.plan.length, 5);
  assert.equal(Object.keys(snap.deliverables).length, 5);
  assert.match(snap.final ?? '', /Glossariy/);

  const dir = join(runsDir, runId);
  for (const f of ['task.md', 'plan.json', 'final.md', 'events.jsonl']) {
    assert.ok(existsSync(join(dir, f)), `${f} yo'q`);
  }
  const lines = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, app.bus.all().length);
});

test('bog\'liq vazifalar (slayd, glossariy) ma\'ruzadan keyin boshlanadi', async () => {
  const { app } = await runOnce(0);
  const events = app.bus.all();
  const idx = (pred: (e: (typeof events)[number]) => boolean) => events.findIndex(pred);
  const lectureReviewed = idx((e) => e.type === 'review_result' && e.task_id === 'T1' && e.data?.accepted === true);
  const slidesStart = idx((e) => e.type === 'agent_state' && e.state === 'writing' && e.task_id === 'T4');
  assert.ok(lectureReviewed >= 0 && slidesStart > lectureReviewed);
});

test('revise bo\'lsa qayta ishlash so\'raladi va ish baribir tugaydi', async () => {
  const { app } = await runOnce(0, 'A');
  const revs = app.bus.all().filter((e) => e.type === 'revision_requested');
  const reviews = app.bus.all().filter((e) => e.type === 'review_result');
  assert.equal(app.orchestrator.status, 'finished');
  assert.ok(reviews.length >= 5);
  assert.ok(reviews.length === 5 + revs.length);
});

test('sun\'iy 429: kutish va provayder almashtirish, ish to\'xtamaydi', async () => {
  const { app } = await runOnce(3);
  const types = app.bus.all().map((e) => e.type);
  assert.ok(types.includes('provider_switch'));
  assert.ok(app.bus.all().some((e) => e.state === 'waiting_rate_limit'));
  assert.equal(app.orchestrator.status, 'finished');
});

test('bir vaqtda ikkinchi topshiriq rad etiladi', async () => {
  MockProvider.resetCounter();
  const app = boot({ speed: 0, rateLimitEvery: 0, runsDir: mkdtempSync(join(tmpdir(), 'kafedra-')), usagePath: null, env: {}, sleep: async () => {} });
  app.orchestrator.start({ task: 'Birinchi', sensitive: false, language: 'uz' });
  assert.throws(() => app.orchestrator.start({ task: 'Ikkinchi', sensitive: false, language: 'uz' }), /bajarilmoqda/);
  await app.orchestrator.done;
});

test('hamma provayder limitda: ish run_failed (limits_exhausted) bilan to\'xtaydi', async () => {
  const { loadConfig } = await import('../src/core/config');
  const { EventBus } = await import('../src/core/events');
  const { Orchestrator } = await import('../src/core/orchestrator');
  const { Router } = await import('../src/providers/router');
  const { UsageStore } = await import('../src/providers/usage');
  const { RateLimitError } = await import('../src/providers/types');
  const bus = new EventBus();
  const dead = { id: 'dead', complete: async () => { throw new RateLimitError('429', 100); } };
  const router = new Router({
    chains: { mudir: [{ provider: dead }], uslubchi: [{ provider: dead }], oqituvchi: [{ provider: dead }] },
    bus,
    usage: new UsageStore(null),
    sleep: async () => {},
  });
  const orch = new Orchestrator(loadConfig(), bus, router, { runsDir: mkdtempSync(join(tmpdir(), 'kafedra-')) });
  orch.start({ task: 'Limit sinovi', sensitive: false, language: 'uz' });
  await orch.done;
  const last = bus.all().at(-1)!;
  assert.equal(last.type, 'run_failed');
  assert.equal(last.data?.reason, 'limits_exhausted');
  assert.equal(orch.status, 'failed');
});
