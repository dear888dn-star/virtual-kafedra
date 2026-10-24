import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { ZodType } from 'zod';
import {
  DeliverablesFile,
  KafedraCfg,
  ProvidersFile,
  type DeliverablesFile as DeliverablesCfg,
  type KafedraCfg as KafedraConfig,
  type ProvidersFile as ProvidersConfig,
} from '../schemas';
import type { PublicConfig } from '../shared/events';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface AppConfig {
  kafedra: KafedraConfig;
  providers: ProvidersConfig;
  deliverables: DeliverablesCfg;
  /** Rol promptlari (fayldan o'qilgan), fayl nomi bo'yicha */
  prompts: Record<string, string>;
  commonPrompt: string;
}

function loadYaml<T>(file: string, schema: ZodType<T, any, any>): T {
  const path = join(ROOT, 'config', file);
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`config/${file} o'qib bo'lmadi: ${(e as Error).message}`);
  }
  const res = schema.safeParse(raw);
  if (!res.success) {
    const msg = res.error.issues.map((i) => `${i.path.join('.') || '(ildiz)'}: ${i.message}`).join('; ');
    throw new Error(`config/${file} noto'g'ri: ${msg}`);
  }
  return res.data;
}

export function loadConfig(root = ROOT): AppConfig {
  const kafedra = loadYaml('kafedra.yaml', KafedraCfg);
  const providers = loadYaml('providers.yaml', ProvidersFile);
  const deliverables = loadYaml('deliverables.yaml', DeliverablesFile);

  const prompts: Record<string, string> = {};
  for (const a of kafedra.agents) {
    try {
      prompts[a.prompt] = readFileSync(join(root, 'prompts', a.prompt), 'utf8');
    } catch {
      throw new Error(`prompts/${a.prompt} topilmadi (agent: ${a.id})`);
    }
  }
  const commonPrompt = readFileSync(join(root, 'prompts', '_umumiy.md'), 'utf8');
  return { kafedra, providers, deliverables, prompts, commonPrompt };
}

export function toPublicConfig(cfg: AppConfig, mock: boolean, problems: string[] = []): PublicConfig {
  return {
    kafedra: cfg.kafedra.kafedra,
    limits: cfg.kafedra.limits,
    agents: cfg.kafedra.agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      title: a.title,
      color: a.color,
      deliverable_type: a.deliverable_type,
    })),
    providers: cfg.providers.providers.map((p) => ({
      id: p.id,
      kind: p.kind,
      enabled: p.enabled,
      trains_on_data: p.trains_on_data,
      rpm: p.limits.rpm,
      rpd: p.limits.rpd,
    })),
    chains: mock ? { all: cfg.providers.mock_chain } : cfg.providers.chains,
    mock,
    problems,
  };
}
