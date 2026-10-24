import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const AgentCfg = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/i),
  name: z.string().min(1),
  role: z.enum(['mudir', 'uslubchi', 'oqituvchi']),
  title: z.string().min(1),
  deliverable_type: z.string().optional(),
  /** Bu o'qituvchi bajara oladigan natija turlari (deliverable_type asosiy ko'nikma; `general` hammaga ochiq) */
  skills: z.array(z.string()).optional(),
  prompt: z.string().min(1),
  color: hexColor,
});
export type AgentCfg = z.infer<typeof AgentCfg>;

export const KafedraCfg = z
  .object({
    kafedra: z.object({
      name: z.string(),
      audience: z.string(),
      languages: z.array(z.string()).min(1),
      default_language: z.string(),
    }),
    limits: z.object({
      max_revisions: z.number().int().min(0).max(10),
      concurrency: z.number().int().min(1).max(10),
      max_input_chars: z.number().int().min(100).max(200000),
      max_material_chars: z.number().int().min(0).max(60000).default(30000),
      max_plan_tasks: z.number().int().min(1).max(30).default(8),
      max_requests_per_run: z.number().int().min(3).max(1000).default(60),
    }),
    agents: z.array(AgentCfg).min(3),
  })
  .superRefine((cfg, ctx) => {
    const ids = new Set<string>();
    for (const a of cfg.agents) {
      if (ids.has(a.id)) ctx.addIssue({ code: 'custom', message: `Agent id takrorlangan: ${a.id}` });
      ids.add(a.id);
    }
    for (const role of ['mudir', 'uslubchi'] as const) {
      if (cfg.agents.filter((a) => a.role === role).length !== 1) {
        ctx.addIssue({ code: 'custom', message: `Aynan bitta "${role}" bo'lishi kerak` });
      }
    }
    if (!cfg.agents.some((a) => a.role === 'oqituvchi')) {
      ctx.addIssue({ code: 'custom', message: "Kamida bitta o'qituvchi kerak" });
    }
  });
export type KafedraCfg = z.infer<typeof KafedraCfg>;

export const ProviderCfg = z.object({
  id: z.string(),
  kind: z.enum(['mock', 'openai_compat', 'gemini', 'ollama']),
  enabled: z.boolean().default(false),
  trains_on_data: z.union([z.boolean(), z.literal('unknown')]).default('unknown'),
  api_key_env: z.string().optional(),
  base_url: z.string().nullable().optional(),
  models: z.record(z.string()).optional(),
  daily_budget_usd: z.number().min(0).optional(),
  /** 1M token uchun USD (byudjet hisobi uchun) */
  price: z.object({ input_per_mtok: z.number().min(0), output_per_mtok: z.number().min(0) }).optional(),
  /** Kunlik hisoblagich nolga tushadigan vaqt zonasi (IANA) */
  reset_tz: z.string().default('UTC'),
  json_mode: z.enum(['json_object', 'none']).default('none'),
  max_tokens_field: z.enum(['max_tokens', 'max_completion_tokens']).default('max_tokens'),
  timeout_ms: z.number().int().min(1000).default(60000),
  /** Fikrlovchi modellar uchun (Gemini 3.x va h.k.): tezlik va token sarfini kamaytiradi. Hamma model qabul qilmaydi. */
  reasoning_effort: z.enum(['none', 'minimal', 'low', 'medium', 'high']).optional(),
  limits: z
    .object({ rpm: z.number().optional(), rpd: z.number().optional(), tpm: z.number().optional() })
    .default({}),
});
export type ProviderCfg = z.infer<typeof ProviderCfg>;

export const ProvidersFile = z.object({
  providers: z.array(ProviderCfg),
  chains: z.record(z.array(z.string())),
  mock_chain: z.array(z.string()).min(1),
});
export type ProvidersFile = z.infer<typeof ProvidersFile>;

export const DeliverablesFile = z.object({
  deliverables: z.record(z.object({ title: z.string(), rubric: z.array(z.string()), guide: z.string().optional() })),
});
export type DeliverablesFile = z.infer<typeof DeliverablesFile>;

export const PlanTask = z.object({
  id: z.string().min(1),
  assignee: z.string().min(1),
  title: z.string().min(1),
  instructions: z.string().min(1),
  deliverable_type: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
});
export type PlanTask = z.infer<typeof PlanTask>;

export const Plan = z.object({ tasks: z.array(PlanTask).min(1) });
export type Plan = z.infer<typeof Plan>;

export const Review = z.object({
  verdict: z.enum(['approve', 'revise', 'reject']),
  score: z.number().min(0).max(10),
  issues: z
    .array(z.object({ place: z.string(), problem: z.string(), fix: z.string() }))
    .default([]),
});
export type Review = z.infer<typeof Review>;

export const RunRequest = z.object({
  task: z.string().trim().min(3),
  sensitive: z.boolean().default(false),
  language: z.enum(['uz', 'ru', 'en', 'multi']).default('uz'),
  /** Foydalanuvchi shaxsiy ma'lumot ogohlantirishini ko'rib, baribir yuborishni tasdiqladi */
  confirm_pii: z.boolean().optional(),
  /** Foydalanuvchi bergan manba matni (konspekt, sillabus). Faqat ma'lumot, ko'rsatma emas. */
  material: z.string().max(60000).optional(),
});
export type RunRequest = z.infer<typeof RunRequest>;
