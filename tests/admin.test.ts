import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AdminError, applyAdminUpdate, readAdminSettings, upsertEnv } from '../src/core/admin';
import { loadConfig, ROOT } from '../src/core/config';
import type { AdminUpdate } from '../src/shared/admin';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'kafedra-admin-'));
  mkdirSync(join(root, 'config'));
  cpSync(join(ROOT, 'config'), join(root, 'config'), { recursive: true });
  writeFileSync(join(root, '.env'), '# izoh\r\nMOCK=1\r\nGROQ_API_KEY=\r\n');
  const cfg = loadConfig();
  const env = {};
  const base = readAdminSettings(cfg, env, false);
  const update: AdminUpdate = {
    kafedra: base.kafedra,
    limits: base.limits,
    agents: base.agents.map(({ id, name, title, color }) => ({ id, name, title, color })),
    providers: base.providers.map(({ id, enabled, model, rpm, rpd, tpm }) => ({ id, enabled, model, rpm, rpd, tpm })),
    chains: base.chains,
    mock_forced: true,
    keys: {},
  };
  return { root, cfg, update };
}

test('saqlash: qiymatlar o\'zgaradi, izohlar va .env izohi saqlanadi, .bak yaratiladi', () => {
  const { root, cfg, update } = sandbox();
  update.limits.concurrency = 2;
  update.mock_forced = false;
  update.keys = { GROQ_API_KEY: 'gsk_test_12345678' };
  const g = update.providers.find((p) => p.id === 'groq')!;
  g.model = 'openai/gpt-oss-20b';
  g.rpm = 10;
  g.tpm = null;
  update.agents[2]!.name = 'Yangi ism';
  update.chains.oqituvchi = ['groq', 'mistral'];
  const { envChanges } = applyAdminUpdate(update, cfg, root);
  assert.equal(envChanges.MOCK, '0');

  const re = loadConfigAt(root);
  assert.equal(re.kafedra.limits.concurrency, 2);
  assert.equal(re.kafedra.agents[2]!.name, 'Yangi ism');
  const gp = re.providers.providers.find((p) => p.id === 'groq')!;
  assert.equal(gp.models?.default, 'openai/gpt-oss-20b');
  assert.equal(gp.limits.rpm, 10);
  assert.equal(gp.limits.tpm, undefined);
  assert.equal(gp.limits.rpd, 1000);
  assert.deepEqual(re.providers.chains.oqituvchi, ['groq', 'mistral']);

  const yaml = readFileSync(join(root, 'config', 'providers.yaml'), 'utf8');
  assert.match(yaml, /# Provayderlar\. Manbalar/);
  assert.match(yaml, /# VERIFY/);
  const env = readFileSync(join(root, '.env'), 'utf8');
  assert.match(env, /^# izoh\r\nMOCK=0\r\nGROQ_API_KEY=gsk_test_12345678\r\n$/);
  assert.ok(readFileSync(join(root, 'config', 'kafedra.yaml.bak'), 'utf8').includes('concurrency'));
});

test('noto\'g\'ri qiymat: hech narsa yozilmaydi', () => {
  const { root, cfg, update } = sandbox();
  const before = readFileSync(join(root, 'config', 'kafedra.yaml'), 'utf8');
  update.limits.concurrency = 99;
  assert.throws(() => applyAdminUpdate(update, cfg, root), AdminError);
  assert.equal(readFileSync(join(root, 'config', 'kafedra.yaml'), 'utf8'), before);
});

test('begona .env o\'zgaruvchisi va noma\'lum provayder rad etiladi', () => {
  const { root, cfg, update } = sandbox();
  assert.throws(() => applyAdminUpdate({ ...update, keys: { PATH: 'abcdefgh1234' } }, cfg, root), AdminError);
  assert.throws(() => applyAdminUpdate({ ...update, chains: { ...update.chains, mudir: ['yoq'] } }, cfg, root), AdminError);
  assert.throws(() => applyAdminUpdate({ ...update, keys: { GROQ_API_KEY: 'a b c d e f g h' } }, cfg, root), AdminError);
});

test('readAdminSettings kalit qiymatini qaytarmaydi', () => {
  const s = readAdminSettings(loadConfig(), { GROQ_API_KEY: 'sir-qiymat' }, false);
  assert.equal(s.providers.find((p) => p.id === 'groq')!.key_set, true);
  assert.ok(!JSON.stringify(s).includes('sir-qiymat'));
});

test('upsertEnv: bor qatorni almashtiradi, yo\'qni qo\'shadi', () => {
  assert.equal(upsertEnv('A=1\nB=2\n', { B: '3', C: '4' }), 'A=1\nB=3\nC=4\n');
});

import { parse } from 'yaml';
import { DeliverablesFile, KafedraCfg, ProvidersFile } from '../src/schemas';
function loadConfigAt(root: string) {
  const rd = (f: string) => parse(readFileSync(join(root, 'config', f), 'utf8'));
  return { kafedra: KafedraCfg.parse(rd('kafedra.yaml')), providers: ProvidersFile.parse(rd('providers.yaml')), deliverables: DeliverablesFile.parse(rd('deliverables.yaml')) };
}
