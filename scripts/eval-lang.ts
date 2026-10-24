import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRealProviders } from '../src/core/bootstrap';
import { loadConfig, ROOT } from '../src/core/config';
import { LANG_SAMPLES, renderLangReport, type LangResult } from '../src/core/langeval';
import { RateLimitError } from '../src/providers/types';

try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  // .env bo'lmasa, kalitsiz provayderlar o'tkazib yuboriladi
}

const SYSTEM = "Sen iqtisodiyot va turizm kafedrasi o'qituvchisisan. Aniq, grammatik to'g'ri va tabiiy o'zbek tilida (lotin) javob ber. Ishonching komil bo'lmagan faktni uydirma.";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { items, enabled, problems } = buildRealProviders(cfg, process.env);
  const skipped = [...problems];
  if (enabled.length === 0) skipped.push("Hech bir real provayder yoqilmagan (config/providers.yaml: enabled: true).");

  const results: LangResult[] = [];
  for (const [id, item] of items) {
    const pc = cfg.providers.providers.find((p) => p.id === id)!;
    const models = [...new Set(Object.values(pc.models ?? {}))];
    for (const model of models) {
      console.log(`${id} / ${model}`);
      for (const s of LANG_SAMPLES) {
        let answer: string | null = null;
        let error: string | null = null;
        const t0 = Date.now();
        for (let attempt = 0; attempt < 2 && answer === null; attempt++) {
          try {
            const r = await item.provider.complete({
              system: SYSTEM,
              messages: [{ role: 'user', content: s.prompt }],
              maxTokens: 900,
              temperature: 0.3,
              model,
            });
            answer = r.text;
            error = null;
          } catch (e) {
            error = (e as Error).message;
            if (e instanceof RateLimitError && attempt === 0 && e.retryAfterMs <= 60_000) await sleep(e.retryAfterMs);
            else break;
          }
        }
        results.push({ provider: id, model, sample: s.id, answer, error, ms: Date.now() - t0 });
        console.log(`  ${s.id}: ${answer !== null ? 'ok' : `xato (${error})`}`);
        await sleep(1500); // bepul limitlarni tejash
      }
    }
  }

  const report = renderLangReport(results, skipped, new Date().toISOString().slice(0, 10));
  mkdirSync(join(ROOT, 'reports'), { recursive: true });
  const out = join(ROOT, 'reports', 'lang-eval.md');
  writeFileSync(out, report);
  for (const s of skipped) console.warn(`[o'tkazildi] ${s}`);
  console.log(`Hisobot: ${out}`);
}

main().catch((e) => {
  console.error('eval-lang xatosi:', e instanceof Error ? e.message : e);
  process.exit(1);
});
