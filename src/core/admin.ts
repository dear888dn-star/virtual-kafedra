import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, type Document } from 'yaml';
import { KafedraCfg, ProvidersFile } from '../schemas';
import type { AdminSettings, AdminUpdate } from '../shared/admin';
import { ROOT, type AppConfig } from './config';

export class AdminError extends Error {}

export function readAdminSettings(
  cfg: AppConfig,
  env: Record<string, string | undefined>,
  running: boolean,
): AdminSettings {
  return {
    kafedra: { name: cfg.kafedra.kafedra.name, audience: cfg.kafedra.kafedra.audience },
    limits: { ...cfg.kafedra.limits },
    agents: cfg.kafedra.agents.map((a) => ({ id: a.id, gender: a.gender, role: a.role, name: a.name, title: a.title, color: a.color })),
    providers: cfg.providers.providers.map((p) => ({
      id: p.id,
      kind: p.kind,
      enabled: p.enabled,
      trains_on_data: p.trains_on_data,
      model: p.models?.default ?? '',
      rpm: p.limits.rpm ?? null,
      rpd: p.limits.rpd ?? null,
      tpm: p.limits.tpm ?? null,
      key_env: p.api_key_env ?? null,
      key_set: !!(p.api_key_env && env[p.api_key_env]),
    })),
    chains: cfg.providers.chains,
    mock_forced: env.MOCK === '1',
    running,
  };
}

function readDoc(path: string): Document {
  return parseDocument(readFileSync(path, 'utf8'));
}

/** Matn qiymati: boshqaruv belgilari va qator uzilishlarisiz */
function cleanText(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string') throw new AdminError(`${field}: matn bo'lishi kerak`);
  const t = v.trim();
  // eslint-disable-next-line no-control-regex
  if (!t || t.length > max || /[\u0000-\u001f]/.test(t)) throw new AdminError(`${field}: bo'sh yoki noto'g'ri`);
  return t;
}

function optNum(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) throw new AdminError(`${field}: noto'g'ri son`);
  return v;
}

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

/** .env dagi o'zgaruvchilarni almashtiradi yoki oxiriga qo'shadi; izohlar va boshqa qatorlar saqlanadi. */
export function upsertEnv(text: string, values: Record<string, string>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [k, v] of Object.entries(values)) {
    const idx = lines.findIndex((l) => new RegExp(`^\\s*${k}\\s*=`).test(l));
    const line = `${k}=${v}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  return lines.join(eol) + eol;
}

export interface ApplyResult {
  /** Process muhitiga ham qo'llash kerak bo'lgan o'zgaruvchilar */
  envChanges: Record<string, string>;
}

/**
 * Sozlamalarni config/*.yaml (izohlar saqlanadi) va .env ga yozadi.
 * Avval hammasi tekshiriladi: xato bo'lsa hech narsa o'zgarmaydi. Eski fayllar *.bak sifatida saqlanadi.
 */
export function applyAdminUpdate(u: AdminUpdate, cfg: AppConfig, root = ROOT): ApplyResult {
  const kPath = join(root, 'config', 'kafedra.yaml');
  const pPath = join(root, 'config', 'providers.yaml');
  const kDoc = readDoc(kPath);
  const pDoc = readDoc(pPath);

  kDoc.setIn(['kafedra', 'name'], cleanText(u.kafedra?.name, 'Kafedra nomi'));
  kDoc.setIn(['kafedra', 'audience'], cleanText(u.kafedra?.audience, 'Auditoriya'));
  for (const k of Object.keys(cfg.kafedra.limits) as (keyof typeof cfg.kafedra.limits)[]) {
    const v = u.limits?.[k];
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new AdminError(`limits.${k}: butun son bo'lishi kerak`);
    kDoc.setIn(['limits', k], v);
  }
  const agentIds = cfg.kafedra.agents.map((a) => a.id);
  for (const a of u.agents ?? []) {
    const i = agentIds.indexOf(a.id);
    if (i < 0) throw new AdminError(`Noma'lum agent: ${a.id}`);
    kDoc.setIn(['agents', i, 'name'], cleanText(a.name, `${a.id} ismi`, 60));
    kDoc.setIn(['agents', i, 'title'], cleanText(a.title, `${a.id} lavozimi`, 60));
    kDoc.setIn(['agents', i, 'color'], cleanText(a.color, `${a.id} rangi`, 7));
    if (a.gender !== undefined) {
      if (a.gender !== 'male' && a.gender !== 'female') throw new AdminError(`${a.id} jinsi: male yoki female bo'lishi kerak`);
      kDoc.setIn(['agents', i, 'gender'], a.gender);
    }
  }

  const provIds = cfg.providers.providers.map((p) => p.id);
  for (const p of u.providers ?? []) {
    const i = provIds.indexOf(p.id);
    if (i < 0) throw new AdminError(`Noma'lum provayder: ${p.id}`);
    if (typeof p.enabled !== 'boolean') throw new AdminError(`${p.id}: enabled noto'g'ri`);
    pDoc.setIn(['providers', i, 'enabled'], p.enabled);
    const model = typeof p.model === 'string' ? p.model.trim() : '';
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\s]/.test(model) || model.length > 120) throw new AdminError(`${p.id}: model nomi noto'g'ri`);
    if (model) {
      if (!pDoc.hasIn(['providers', i, 'models']) || pDoc.getIn(['providers', i, 'models']) == null) {
        pDoc.setIn(['providers', i, 'models'], pDoc.createNode({}));
      }
      pDoc.setIn(['providers', i, 'models', 'default'], model);
    } else if (pDoc.hasIn(['providers', i, 'models', 'default'])) {
      pDoc.deleteIn(['providers', i, 'models', 'default']);
    }
    for (const f of ['rpm', 'rpd', 'tpm'] as const) {
      const v = optNum(p[f], `${p.id}.${f}`);
      if (v === null) {
        if (pDoc.hasIn(['providers', i, 'limits', f])) pDoc.deleteIn(['providers', i, 'limits', f]);
      } else {
        if (pDoc.getIn(['providers', i, 'limits']) == null) pDoc.setIn(['providers', i, 'limits'], pDoc.createNode({}));
        pDoc.setIn(['providers', i, 'limits', f], v);
      }
    }
  }

  for (const [role, ids] of Object.entries(u.chains ?? {})) {
    if (!(role in cfg.providers.chains)) throw new AdminError(`Noma'lum zanjir: ${role}`);
    if (!Array.isArray(ids) || ids.some((id) => !provIds.includes(id))) {
      throw new AdminError(`${role} zanjiri: noma'lum provayder bor`);
    }
    const node = pDoc.createNode([...new Set(ids)]);
    (node as { flow?: boolean }).flow = true;
    pDoc.setIn(['chains', role], node);
  }

  // Yozishdan oldin to'liq tekshirish
  const k = KafedraCfg.safeParse(kDoc.toJS());
  if (!k.success) throw new AdminError(k.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const p = ProvidersFile.safeParse(pDoc.toJS());
  if (!p.success) throw new AdminError(p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  for (const [role, ids] of Object.entries(p.data.chains)) {
    if (ids.some((id) => !p.data.providers.some((x) => x.id === id))) throw new AdminError(`${role} zanjirida noma'lum provayder bor`);
  }

  // Kalitlar: faqat ma'lum o'zgaruvchi nomlariga yoziladi
  const allowed = new Set(cfg.providers.providers.map((x) => x.api_key_env).filter((x): x is string => !!x));
  const envChanges: Record<string, string> = {};
  for (const [name, value] of Object.entries(u.keys ?? {})) {
    if (!value) continue;
    if (!allowed.has(name)) throw new AdminError(`Ruxsat etilmagan o'zgaruvchi: ${name}`);
    if (typeof value !== 'string' || /\s/.test(value) || value.length < 8 || value.length > 400) {
      throw new AdminError(`${name}: kalit noto'g'ri ko'rinadi (bo'sh joy bo'lmasligi kerak)`);
    }
    envChanges[name] = value;
  }
  envChanges.MOCK = u.mock_forced ? '1' : '0';

  for (const path of [kPath, pPath]) copyFileSync(path, `${path}.bak`);
  writeAtomic(kPath, kDoc.toString());
  writeAtomic(pPath, pDoc.toString());
  const envPath = join(root, '.env');
  const envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  if (existsSync(envPath)) copyFileSync(envPath, `${envPath}.bak`);
  writeAtomic(envPath, upsertEnv(envText, envChanges));
  return { envChanges };
}
