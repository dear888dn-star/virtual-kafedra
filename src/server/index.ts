import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AdminError, applyAdminUpdate, readAdminSettings } from '../core/admin';
import { boot } from '../core/bootstrap';
import { ROOT, toPublicConfig } from '../core/config';
import { markdownToDocx } from '../export/docx';
import { buildPptx } from '../export/pptx';
import { isThemeId } from '../shared/themes';
import { PdfError, extractPdfText } from '../core/pdf';
import { detectPii } from '../privacy/pii';
import { SensitiveRoutingError } from '../providers/types';
import { RunRequest } from '../schemas';

try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  // .env bo'lmasa ham mock rejimi ishlaydi
}

const PORT = Number(process.env.PORT ?? 3100);
const HOST = '127.0.0.1';
let app = boot();
const webDir = join(ROOT, 'web');

const server = express();
server.disable('x-powered-by');

// DNS rebinding va begona saytlardan so'rov yuborishdan himoya
const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
server.use((req: Request, res: Response, next: NextFunction) => {
  if (!allowedHosts.has(req.headers.host ?? '')) {
    res.status(403).send('Taqiqlangan host');
    return;
  }
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !allowedHosts.has(new URL(origin).host)) {
    res.status(403).send('Taqiqlangan origin');
    return;
  }
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
server.use(express.json({ limit: '3mb' }));

server.get('/', (_req, res) => res.sendFile(join(webDir, 'index.html')));
server.get('/style.css', (_req, res) => res.sendFile(join(webDir, 'style.css')));
server.get('/admin', (_req, res) => res.sendFile(join(webDir, 'admin.html')));
server.get('/icon.svg', (_req, res) => res.sendFile(join(webDir, 'icon.svg')));
server.get('/admin.js', (_req, res) => bundle('admin.ts', res));
server.get('/app.js', (_req, res) => bundle('main.ts', res));
/** Brauzer paketi: fayllar o'zgarmaguncha qayta yig'ilmaydi (three.js tufayli birinchi yig'ish biroz vaqt oladi). */
const bundleCache = new Map<string, { stamp: number; text: string }>();
function sourceStamp(): number {
  let max = 0;
  for (const dir of [webDir, join(ROOT, 'src', 'shared')]) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.ts')) max = Math.max(max, statSync(join(dir, f)).mtimeMs);
    }
  }
  return max;
}

async function bundle(entry: string, res: Response): Promise<void> {
  try {
    const stamp = sourceStamp();
    let hit = bundleCache.get(entry);
    if (!hit || hit.stamp !== stamp) {
      const out = await build({
        entryPoints: [join(webDir, entry)],
        bundle: true,
        write: false,
        format: 'esm',
        target: 'es2022',
        minify: true,
        legalComments: 'none',
        logLevel: 'silent',
      });
      hit = { stamp, text: out.outputFiles[0]!.text };
      bundleCache.set(entry, hit);
    }
    res.type('application/javascript').send(hit.text);
  } catch (e) {
    console.error(e);
    res.status(500).type('text/plain').send("Frontend yig'ilmadi: " + (e as Error).message);
  }
}

// ---- Boshqaruv paneli ----
server.get('/api/admin/settings', (_req, res) => {
  res.json(readAdminSettings(app.cfg, process.env, app.orchestrator.status === 'running'));
});

server.put('/api/admin/settings', (req, res) => {
  if (app.orchestrator.status === 'running') {
    res.status(409).json({ error: "Topshiriq bajarilmoqda. Tugagach yoki to'xtatgach saqlang." });
    return;
  }
  try {
    const { envChanges } = applyAdminUpdate(req.body, app.cfg);
    for (const [k, v] of Object.entries(envChanges)) process.env[k] = v;
    app = boot({ bus: app.bus });
    res.json({ ok: true, mock: app.mock, problems: app.problems, settings: readAdminSettings(app.cfg, process.env, false) });
  } catch (e) {
    if (e instanceof AdminError) {
      res.status(400).json({ error: e.message });
      return;
    }
    console.error("[xato] sozlamalarni qo'llash:", e instanceof Error ? e.message : e);
    res.status(500).json({ error: (e as Error).message });
  }
});

server.get('/api/config', (_req, res) => res.json(toPublicConfig(app.cfg, app.mock, app.problems)));
server.get('/api/usage', (_req, res) => res.json(app.router.snapshot()));
server.get('/api/run', (_req, res) => res.json(app.orchestrator.getSnapshot()));

server.post('/api/runs', (req, res) => {
  const parsed = RunRequest.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') ?? '';
    res.status(400).json({
      error: !where || where === 'task' ? "Topshiriq matni kamida 3 belgi bo'lishi kerak" : `So'rov noto'g'ri (${where}): ${issue?.message ?? ''}`,
    });
    return;
  }
  const max = app.cfg.kafedra.limits.max_input_chars;
  if (parsed.data.task.length > max) {
    res.status(413).json({ error: `Topshiriq juda uzun (maksimum ${max} belgi)` });
    return;
  }
  if (app.orchestrator.status === 'running') {
    res.status(409).json({ error: 'Boshqa topshiriq bajarilmoqda' });
    return;
  }
  // Manba tanlash majburiy: kitob(lar), o'z matni yoki aniq "manba talab qilinmaydi"
  if (parsed.data.source_mode !== 'none' && !(parsed.data.books?.length || parsed.data.material?.trim())) {
    res.status(422).json({
      code: 'source_required',
      error: "Manbani tanlang: kitob ko'rsating, mos kitoblarni qidirtiring yoki \"Manba kerak emas\" ni yoqing.",
    });
    return;
  }
  const maxMat = app.cfg.kafedra.limits.max_material_chars;
  if ((parsed.data.material?.length ?? 0) > maxMat) {
    res.status(413).json({ error: `Manba material juda uzun (maksimum ${maxMat} belgi)` });
    return;
  }
  const pii = detectPii(`${parsed.data.task}
${parsed.data.material ?? ''}`);
  if (pii.length && !parsed.data.confirm_pii) {
    res.status(409).json({ code: 'pii', error: "Matnda shaxsiy ma'lumot bo'lishi mumkin", findings: pii });
    return;
  }
  try {
    const runId = app.orchestrator.start(parsed.data);
    res.status(202).json({ runId });
  } catch (e) {
    if (e instanceof SensitiveRoutingError) {
      res.status(422).json({ code: 'sensitive_routing', error: e.message });
      return;
    }
    res.status(500).json({ error: (e as Error).message });
  }
});

// Taqdimot (slaydchi yozgan JSON): ko'rinish va PowerPoint (.pptx) eksporti. ?file=<vazifa id>&theme=okean
server.get('/api/run/deck', (req, res) => {
  const deck = app.orchestrator.getDeck(String(req.query.file ?? ''));
  if (!deck) {
    res.status(404).json({ error: "Bu vazifada taqdimot yo'q" });
    return;
  }
  res.json(deck);
});

server.get('/api/run/export.pptx', async (req, res) => {
  const file = String(req.query.file ?? '');
  const deck = app.orchestrator.getDeck(file);
  if (!deck) {
    res.status(404).json({ error: "Bu vazifada taqdimot yo'q" });
    return;
  }
  try {
    const theme = isThemeId(req.query.theme) ? req.query.theme : undefined;
    const buf = await buildPptx(deck, { theme, footerLabel: app.cfg.kafedra.kafedra.name });
    res
      .type('application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .setHeader('Content-Disposition', `attachment; filename="${file.replace(/[^A-Za-z0-9_-]/g, '')}.pptx"`)
      .send(Buffer.from(buf));
  } catch (e) {
    console.error('[xato] pptx yasash:', e instanceof Error ? e.message : e);
    res.status(500).json({ error: "Taqdimot faylini yasab bo'lmadi" });
  }
});

// .docx eksport: ?file=final yoki vazifa id (masalan T1)
server.get('/api/run/export.docx', (req, res) => {
  const snap = app.orchestrator.getSnapshot();
  const file = String(req.query.file ?? 'final');
  const md = file === 'final' ? snap.final : Object.hasOwn(snap.deliverables, file) ? snap.deliverables[file] : null;
  if (!md) {
    res.status(404).json({ error: 'Bu natija hali tayyor emas' });
    return;
  }
  const name = file === 'final' ? 'final' : file.replace(/[^A-Za-z0-9_-]/g, '');
  res
    .type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    .setHeader('Content-Disposition', `attachment; filename="${name}.docx"`)
    .send(Buffer.from(markdownToDocx(md)));
});

// Ishlayotgan topshiriqni to'xtatish: yangi model so'rovi yuborilmaydi, holat saqlanadi
server.post('/api/run/stop', (_req, res) => {
  res.json({ stopping: app.orchestrator.cancel() });
});

// Mavzu bo'yicha kitob qidirish va tavsiya qilish (bitta model so'rovi va ochiq kataloglar). Foydalanuvchi bosganda ishlaydi.
// PDF kitobdan matn olish (xom fayl yuboriladi; matn qatlami bo'lishi kerak). Natija brauzerdagi "kitob matni" maydoniga tushadi.
server.post('/api/extract', express.raw({ type: () => true, limit: '40mb' }), async (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({ error: 'Fayl yuborilmadi.' });
    return;
  }
  try {
    const r = await extractPdfText(new Uint8Array(body), app.cfg.kafedra.limits.max_material_chars);
    res.json(r);
  } catch (e) {
    res.status(e instanceof PdfError ? 422 : 500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

let searchingSources = false;
server.post('/api/sources/search', async (req, res) => {
  const task = typeof req.body?.task === 'string' ? req.body.task.trim() : '';
  if (task.length < 3 || task.length > app.cfg.kafedra.limits.max_input_chars) {
    res.status(400).json({ error: 'Avval topshiriq matnini yozing (kitob qidirish mavzuga qarab ishlaydi).' });
    return;
  }
  if (searchingSources) {
    res.status(409).json({ error: 'Kitob qidirilmoqda, bir oz kuting.' });
    return;
  }
  searchingSources = true;
  try {
    res.json(await app.orchestrator.suggestSources(task));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: `Kitob qidirib bo'lmadi: ${msg.slice(0, 160)}` });
  } finally {
    searchingSources = false;
  }
});

server.get('/api/runs', (_req, res) => res.json(app.orchestrator.listRuns()));

server.post('/api/runs/:id/resume', (req, res) => {
  try {
    const runId = app.orchestrator.resume(String(req.params.id));
    res.status(202).json({ runId });
  } catch (e) {
    const msg = (e as Error).message;
    res.status(e instanceof SensitiveRoutingError ? 422 : /bajarilmoqda/.test(msg) ? 409 : 400).json({ error: msg });
  }
});

// SSE: ulanganda to'plangan hodisalar qayta o'ynatiladi
server.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  // id: "<epoch>.<seq>". Epoch boshqa ishga tegishli bo'lsa, ish boshidan qayta o'ynatiladi.
  const [ep, sq] = String(req.headers['last-event-id'] ?? '').split('.').map(Number);
  const from = ep === app.bus.epoch && sq !== undefined && Number.isFinite(sq) ? sq + 1 : 0;
  const send = (e: { seq: number }) => res.write(`id: ${app.bus.epoch}.${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
  for (const e of app.bus.since(from)) send(e);
  const unsub = app.bus.subscribe(send);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    unsub();
  });
});

process.on('unhandledRejection', (e) => console.error('[xato] ishlov berilmagan rad etish:', e instanceof Error ? e.message : e));

server.listen(PORT, HOST, () => {
  console.log(`Virtual Kafedra: http://localhost:${PORT}  (${app.mock ? 'MOCK rejimi' : 'real rejim'})`);
  for (const p of app.problems) console.warn(`[ogohlantirish] ${p}`);
});

// index.html mavjudligini erta tekshirish
readFileSync(join(webDir, 'index.html'));
