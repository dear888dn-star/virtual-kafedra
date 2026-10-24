import { join } from 'node:path';
import { buildRealProviders } from '../src/core/bootstrap';
import { loadConfig, ROOT } from '../src/core/config';

process.loadEnvFile(join(ROOT, '.env'));
const { items, problems } = buildRealProviders(loadConfig(), process.env);
for (const p of problems) console.log('muammo:', p);
for (const [id, item] of items) {
  const model = item.models?.default;
  const t0 = Date.now();
  try {
    const r = await item.provider.complete({
      system: "Sen o'zbek tilida qisqa javob beruvchi yordamchisan.",
      messages: [{ role: 'user', content: "Talab va taklif nima? Ikki jumlada o'zbekcha (lotin) tushuntiring." }],
      maxTokens: 300,
      temperature: 0.3,
      model,
    });
    console.log(`${id}/${model}: OK ${Date.now() - t0} ms, tokenlar ${r.usage.inputTokens}+${r.usage.outputTokens}\n---\n${r.text}`);
  } catch (e) {
    console.log(`${id}/${model}: XATO ${(e as Error).name}: ${(e as Error).message}`);
  }
}
