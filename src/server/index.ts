import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import express, { type NextFunction, type Request, type Response } from 'express';
import { boot } from '../core/bootstrap';
import { ROOT, toPublicConfig } from '../core/config';
import { markdownToDocx } from '../export/docx';
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
const app = boot();
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
server.use(express.json({ limit: '400kb' }));

server.get('/', (_req, res) => res.sendFile(join(webDir, 'index.html')));
server.get('/style.css', (_req, res) => res.sendFile(join(webDir, 'style.css')));
server.get('/app.js', async (_req, res) => {
  try {
    const out = await build({
      entryPoints: [join(webDir, 'main.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2022',
      sourcemap: 'inline',
      logLevel: 'silent',
    });
    res.type('application/javascript').send(out.outputFiles[0]!.text);
  } catch (e) {
    console.error(e);
    res.status(500).type('text/plain').send('Frontend yig\'ilmadi: ' + (e as Error).message);
  }
});

server.get('/api/config', (_req, res) => res.json(toPublicConfig(app.cfg, app.mock, app.problems)));
server.get('/api/usage', (_req, res) => res.json(app.router.snapshot()));
server.get('/api/run', (_req, res) => res.json(app.orchestrator.getSnapshot()));

server.post('/api/runs', (req, res) => {
  const parsed = RunRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Topshiriq matni kamida 3 belgi bo'lishi kerak" });
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

server.get('/api/runs',(_req, res) => res.json(app.orchestrator.listRuns()));

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
