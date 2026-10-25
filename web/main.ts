import type { KafedraEvent, PublicConfig, RunSnapshot } from '../src/shared/events';
import { Office } from './office';
import type { OfficeLike } from './office-api';
import { Office3D } from './office3d';
import { boardPanel, h, limitsPanel, logPanel, resultPanel, settingsPanel, taskPanel, type Panel, type PiiFinding, type RunItem, type SubmitResult } from './panels';
import type { Book, SourceMode } from '../src/shared/sources';
import type { SearchOutcome } from './sources';
import { Store } from './store';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} topilmadi`);
  return el as T;
};

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // saqlab bo'lmasa, sahifa baribir ishlaydi
  }
}

async function main(): Promise<void> {
  const config = (await (await fetch('/api/config')).json()) as PublicConfig;
  const store = new Store();
  store.config = config;

  $('kafedra-name').textContent = config.kafedra.name;
  $('kafedra-sub').textContent = `${config.kafedra.audience} · ${config.kafedra.languages.join(' / ')}`;
  $('mode-badge').hidden = !config.mock;

  // ---- mavzu va animatsiya ----
  const root = document.documentElement;
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : mql.matches);
  const saved = lsGet('theme');
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

  const canvas = $<HTMLCanvasElement>('office');
  // 3D ofis (WebGL); qo'llab-quvvatlanmasa yoki xato bo'lsa 2D versiyaga o'tamiz
  let office: OfficeLike;
  try {
    office = new Office3D(canvas, config.agents, $('tooltip'));
  } catch (e) {
    console.warn("3D ofis ishga tushmadi, 2D ishlatiladi:", e);
    const plain = canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.replaceWith(plain);
    canvas.parentElement?.querySelector('.o3-overlay')?.remove();
    office = new Office(plain, config.agents, $('tooltip'));
  }
  // Nosozliklarni tekshirish uchun (brauzer konsolidan): window.__office
  (window as unknown as { __office?: OfficeLike }).__office = office;
  const syncTheme = () => office.setDark(isDark());
  syncTheme();
  mql.addEventListener('change', syncTheme);
  $('theme-toggle').addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    lsSet('theme', root.dataset.theme);
    syncTheme();
  });

  const motionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = lsGet('reduced') ? lsGet('reduced') === '1' : motionMql.matches;
  const motionBtn = $('motion-toggle');
  const applyMotion = () => {
    office.setReduced(reduced);
    motionBtn.setAttribute('aria-pressed', String(reduced));
    motionBtn.textContent = reduced ? 'Animatsiya: o\'chiq' : 'Animatsiya: yoqiq';
  };
  applyMotion();
  motionBtn.addEventListener('click', () => {
    reduced = !reduced;
    lsSet('reduced', reduced ? '1' : '0');
    applyMotion();
  });

  // ---- legenda ----
  const legend = $('legend');
  for (const a of config.agents) {
    legend.append(h('li', {}, h('span', { class: 'dot', style: `background:${a.color}` }), `${a.name} · ${a.title}`));
  }

  // ---- API ----
  const fetchRun = async (): Promise<RunSnapshot | null> => {
    try {
      return (await (await fetch('/api/run')).json()) as RunSnapshot;
    } catch {
      return null;
    }
  };
  const searchBooks = async (task: string): Promise<SearchOutcome> => {
    try {
      const r = await fetch('/api/sources/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) });
      const j = (await r.json().catch(() => ({}))) as { books?: Book[]; notes?: string[]; queries?: string[]; error?: string };
      if (!r.ok) return { ok: false, error: j.error ?? `Xato (${r.status})` };
      return { ok: true, books: j.books ?? [], notes: j.notes ?? [], queries: j.queries ?? [] };
    } catch {
      return { ok: false, error: "Serverga ulanib bo'lmadi." };
    }
  };
  const submit = async (body: { task: string; sensitive: boolean; language: string; confirm_pii?: boolean; material?: string; source_mode?: SourceMode; books?: Book[] }): Promise<SubmitResult> => {
    try {
      const r = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) return { ok: true };
      const j = (await r.json().catch(() => ({}))) as { error?: string; code?: string; findings?: PiiFinding[] };
      return { ok: false, error: j.error ?? `Xato (${r.status})`, pii: j.code === 'pii' ? j.findings : undefined };
    } catch {
      return { ok: false, error: "Serverga ulanib bo'lmadi." };
    }
  };

  // Qayta ishga tushgandan keyin ham bugungi hisob ko'rinishi uchun
  try {
    const u = (await (await fetch('/api/usage')).json()) as Record<string, { requests: number; limit: number | null }>;
    for (const [id, v] of Object.entries(u)) store.usage.set(id, { count: v.requests, limit: v.limit, model: '' });
  } catch {
    // limit paneli hodisalar kelganda yangilanadi
  }

  // ---- panellar ----
  const result = resultPanel(store, fetchRun);
  const listRuns = async () => {
    try {
      return (await (await fetch('/api/runs')).json()) as RunItem[];
    } catch {
      return [];
    }
  };
  const resume = async (id: string): Promise<string | null> => {
    try {
      const r = await fetch(`/api/runs/${encodeURIComponent(id)}/resume`, { method: 'POST' });
      if (r.ok) return null;
      return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Xato (${r.status})`;
    } catch {
      return "Serverga ulanib bo'lmadi.";
    }
  };
  const stop = async (): Promise<void> => {
    try {
      await fetch('/api/run/stop', { method: 'POST' });
    } catch {
      // aloqa bo'lmasa, tugma qayta bosiladi
    }
  };
  const taskP = taskPanel(store, { submit, listRuns, resume, stop, searchBooks });
  const panels: Panel[] = [
    taskP,
    boardPanel(store),
    logPanel(store),
    result,
    limitsPanel(store),
    settingsPanel(store),
  ];
  const tabs = $('tabs');
  const host = $('panels');
  const tabEls = new Map<string, HTMLButtonElement>();
  const select = (id: string) => {
    for (const p of panels) {
      p.el.hidden = p.id !== id;
      tabEls.get(p.id)?.setAttribute('aria-selected', String(p.id === id));
      tabEls.get(p.id)?.setAttribute('tabindex', p.id === id ? '0' : '-1');
    }
    lsSet('tab', id);
    panels.find((p) => p.id === id)?.render();
    if (id === 'result') void result.refresh?.();
    if (id === 'task') void taskP.refresh?.();
  };
  panels.forEach((p, i) => {
    const t = h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': 'false', title: `Alt+${i + 1}` }, p.label);
    t.addEventListener('click', () => select(p.id));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = panels[(i + (e.key === 'ArrowRight' ? 1 : panels.length - 1)) % panels.length]!;
      select(next.id);
      tabEls.get(next.id)?.focus();
    });
    tabEls.set(p.id, t);
    tabs.append(t);
    host.append(p.el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key >= '1' && e.key <= String(panels.length)) {
      e.preventDefault();
      select(panels[Number(e.key) - 1]!.id);
    }
  });
  const savedTab = lsGet('tab');
  select(panels.some((p) => p.id === savedTab) ? savedTab! : 'task');

  // ---- holat belgisi ----
  const statusEl = $('run-status');
  const STATUS: Record<string, string> = { idle: "Bo'sh", running: 'Jarayonda', finished: 'Tugadi', failed: 'Xato' };
  const renderAll = () => {
    statusEl.textContent = STATUS[store.status] ?? store.status;
    statusEl.className = `badge ${store.status}`;
    office.setBoard({ task: store.runTask, done: store.doneCount, total: store.tasks.size });
    for (const p of panels) if (!p.el.hidden) p.render();
  };
  let scheduled = false;
  store.onChange(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      renderAll();
    });
  });
  store.onEvent((e: KafedraEvent) => {
    office.handle(e);
    if (e.type === 'review_result' || e.type === 'run_finished') void result.refresh?.();
    if (e.type === 'run_started' || e.type === 'run_finished' || e.type === 'run_failed') void taskP.refresh?.();
  });
  for (const p of panels) p.render();
  renderAll();

  // ---- SSE ----
  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    try {
      store.apply(JSON.parse(m.data as string) as KafedraEvent);
    } catch (err) {
      console.error('Hodisani o\'qib bo\'lmadi', err);
    }
  };
  const connEl = $('conn-badge');
  const conn = (ok: boolean) => {
    connEl.hidden = ok;
  };
  es.onopen = () => conn(true);
  es.onerror = () => conn(false);
}

main().catch((e) => {
  document.body.prepend(h('div', { class: 'note err' }, `Dastur ishga tushmadi: ${(e as Error).message}`));
});
