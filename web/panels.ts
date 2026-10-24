import type { RunSnapshot } from '../src/shared/events';
import { renderMarkdown } from './render';
import type { CardStatus, Store } from './store';

type Child = Node | string | null | undefined;

/** Kichik DOM yordamchisi. Matn doim textContent orqali qo'yiladi (XSS'dan xavfsiz). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else el.setAttribute(k, v);
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

export interface Panel {
  id: string;
  label: string;
  el: HTMLElement;
  render(): void;
  refresh?(): Promise<void>;
}

const SAMPLES = [
  "Turizm xizmatlari bozorida talab va taklif. 2 soatlik ma'ruza, test va amaliy mashqlar tayyorlang.",
  "Mehmonxona biznesida xarajatlar tahlili: ma'ruza, 10 ta test va 3 ta masala.",
  "Ekoturizmni rivojlantirishning iqtisodiy jihatlari: to'liq o'quv to'plami (ma'ruza, slayd, glossariy).",
];
const SENSITIVE_WORDS = /imtihon|ekzamen|экзамен|exam|talaba|студент|student|baho|оценк/i;

// ---------- 1. Topshiriq ----------

export interface RunItem {
  id: string;
  task: string;
  status: 'running' | 'finished' | 'failed';
  reason?: string;
  createdAt: string;
  resumable: boolean;
}

export interface PiiFinding {
  type: string;
  count: number;
  sample: string;
}

export type SubmitResult = { ok: true } | { ok: false; error: string; pii?: PiiFinding[] };

const PII_LABELS: Record<string, string> = {
  email: 'email manzil',
  phone: 'telefon raqami',
  passport: 'pasport raqami',
  card: 'bank kartasi raqami',
  pinfl: 'JShShIR (PINFL) shaklidagi raqam',
};

export interface TaskApi {
  submit(body: { task: string; sensitive: boolean; language: string; confirm_pii?: boolean; material?: string }): Promise<SubmitResult>;
  listRuns(): Promise<RunItem[]>;
  resume(id: string): Promise<string | null>;
}

const RUN_STATUS: Record<string, string> = { running: 'jarayonda', finished: 'tugagan', failed: "to'xtagan" };
const RUN_REASON: Record<string, string> = {
  limits_exhausted: 'limit tugadi',
  sensitive_routing: "maxfiy: mos provayder yo'q",
  budget: 'byudjet tugadi',
  bad_json: 'JSON xatosi',
  error: 'xato',
};

export function taskPanel(store: Store, api: TaskApi): Panel {
  const submit = api.submit;
  const runsBox = h('div', { class: 'runs' });
  const ta = h('textarea', { id: 'task-text', placeholder: 'Topshiriqni yozing…', maxlength: '20000' });
  const lang = h('select', { id: 'task-lang' });
  const sens = h('input', { type: 'checkbox', id: 'task-sensitive' });
  const warn = h('div', { class: 'note warn', hidden: true }, "Imtihon yoki talaba ma'lumoti bo'lishi mumkin. \"Maxfiy\" katakchasini belgilashni o'ylab ko'ring.");
  const err = h('div', { class: 'note err', hidden: true, role: 'alert' });
  const send = h('button', { class: 'btn', type: 'button' }, 'Yuborish');
  const sensInfo = h('div', { class: 'note', hidden: true });
  const piiBox = h('div', { class: 'note warn', hidden: true, role: 'alert' });
  const failNote = h('div', { class: 'note err', hidden: true, role: 'alert' });
  const mat = h('textarea', { id: 'task-material', placeholder: "Konspekt, sillabus yoki mavzu bo'yicha manba matn. Model faktlarni shundan oladi.", style: 'min-height:90px' });
  const matInfo = h('p', { class: 'muted' });
  const matFile = h('input', { type: 'file', accept: '.txt,.md,.csv,text/plain,text/markdown', 'aria-label': 'Manba faylini tanlash' });
  const matBox = h('details', { class: 'material' }, h('summary', {}, 'Manba material (ixtiyoriy)'), mat, h('div', { class: 'row' }, matFile, h('button', { class: 'btn small ghost', type: 'button', onclick: () => { mat.value = ''; matFile.value = ''; updateMat(); } }, 'Tozalash')), matInfo);
  let sampleIdx = 0;

  const el = h(
    'section',
    { class: 'panel' },
    h('label', { for: 'task-text' }, 'Topshiriq'),
    ta,
    matBox,
    h('div', { class: 'row' }, h('div', {}, h('label', { for: 'task-lang' }, 'Til'), lang), h('label', { class: 'check', for: 'task-sensitive' }, sens, 'Maxfiy topshiriq')),
    warn,
    sensInfo,
    piiBox,
    err,
    failNote,
    h(
      'div',
      { class: 'row between' },
      h('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => {
          ta.value = SAMPLES[sampleIdx++ % SAMPLES.length] ?? '';
          onInput();
          ta.focus();
        },
      }, 'Namuna'),
      send,
    ),
    h('p', { class: 'muted', style: 'margin-top:8px' }, 'Ctrl+Enter — yuborish'),
    runsBox,
  );

  const labels: Record<string, string> = { uz: "O'zbekcha", ru: 'Ruscha', en: 'Inglizcha', multi: 'Uch tilda' };
  for (const code of ['uz', 'ru', 'en', 'multi']) lang.append(h('option', { value: code }, labels[code] ?? code));

  const onInput = () => {
    warn.hidden = !SENSITIVE_WORDS.test(ta.value) || sens.checked;
    piiBox.hidden = true;
    updateSensInfo();
  };
  const updateSensInfo = () => {
    sensInfo.hidden = !sens.checked;
    if (!sens.checked || !store.config) return;
    const ok = store.config.providers.filter((p) => p.enabled && p.trains_on_data === false).map((p) => p.id);
    sensInfo.className = ok.length ? 'note' : 'note err';
    sensInfo.textContent = ok.length
      ? `Maxfiy rejim: topshiriq faqat shu provayderlarga yuboriladi: ${ok.join(', ')}. Boshqasiga jimgina o'tilmaydi.`
      : "Maxfiy rejim: ma'lumotni o'qitishga ishlatmaydigan provayder yoqilmagan. Yuborsangiz ish boshlanmaydi (mahalliy Ollama'ni yoqing).";
  };
  ta.addEventListener('input', onInput);
  sens.addEventListener('change', onInput);

  const MAT_LIMIT = 30000;
  const updateMat = () => {
    const n = mat.value.length;
    const max = store.config?.limits.max_material_chars ?? MAT_LIMIT;
    matInfo.textContent = n ? `${n} belgi${n > max ? ` (ruxsat etilgan ${max} dan ortiq: qisqartiring)` : ''}. Matn tashqi AI xizmatiga yuboriladi.` : ".txt yoki .md fayl yuklang yoki matnni shu yerga qo'ying.";
    matInfo.className = n > max ? 'note err' : 'muted';
  };
  mat.addEventListener('input', updateMat);
  matFile.addEventListener('change', async () => {
    const f = matFile.files?.[0];
    if (!f) return;
    if (f.size > 400_000) {
      matInfo.textContent = 'Fayl juda katta (400 KB gacha).';
      return;
    }
    mat.value = await f.text();
    matBox.open = true;
    updateMat();
  });
  updateMat();

  const doSend = async () => {
    err.hidden = true;
    const text = ta.value.trim();
    if (text.length < 3) {
      err.textContent = 'Topshiriq matnini yozing.';
      err.hidden = false;
      return;
    }
    send.disabled = true;
    piiBox.hidden = true;
    await attempt(false);
    send.disabled = store.status === 'running';
  };
  const attempt = async (confirm: boolean) => {
    const res = await submit({ task: ta.value.trim(), sensitive: sens.checked, language: lang.value, confirm_pii: confirm || undefined, material: mat.value.trim() || undefined });
    if (res.ok) return;
    if (res.pii?.length) {
      piiBox.replaceChildren(
        h('div', {}, "Matnda shaxsiy ma'lumotga o'xshash qismlar bor: " + res.pii.map((f) => `${PII_LABELS[f.type] ?? f.type} (${f.count} ta, masalan ${f.sample})`).join('; ') + ". Matn tashqi AI xizmatiga yuboriladi."),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onclick: async () => { piiBox.hidden = true; send.disabled = true; await attempt(true); send.disabled = store.status === 'running'; } }, 'Baribir yuborish'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => { piiBox.hidden = true; ta.focus(); } }, 'Matnni tahrirlash'),
        ),
      );
      piiBox.hidden = false;
      return;
    }
    err.textContent = res.error;
    err.hidden = false;
  };
  send.addEventListener('click', () => void doSend());
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void doSend();
    }
  });

  const renderRuns = (runs: RunItem[]) => {
    const rows = runs.map((r) =>
      h(
        'div',
        { class: 'run-row' },
        h('div', {}, h('div', { title: r.task }, r.task), h('div', { class: 'muted' }, `${r.createdAt.slice(0, 16).replace('T', ' ')} · ${RUN_STATUS[r.status] ?? r.status}${r.reason ? ` (${RUN_REASON[r.reason] ?? r.reason})` : ''}`)),
        r.resumable && r.status !== 'finished' && !(store.status === 'running' && store.runId === r.id)
          ? h('button', {
              class: 'btn small', type: 'button', disabled: store.status === 'running',
              onclick: async () => {
                const problem = await api.resume(r.id);
                if (problem) {
                  err.textContent = problem;
                  err.hidden = false;
                }
              },
            }, 'Davom ettirish')
          : null,
      ),
    );
    runsBox.replaceChildren(h('h2', { style: 'margin-top:14px' }, 'Oxirgi ishlar'), ...(rows.length ? rows : [h('p', { class: 'muted' }, "Hali ish yo'q.")]));
  };

  return {
    id: 'task',
    label: 'Topshiriq',
    el,
    async refresh() {
      renderRuns(await api.listRuns());
    },
    render() {
      send.disabled = store.status === 'running';
      send.textContent = store.status === 'running' ? 'Bajarilmoqda…' : 'Yuborish';
      if (store.status === 'failed' && store.error) {
        failNote.textContent = store.error;
        failNote.hidden = false;
      } else failNote.hidden = true;
      if (store.config) lang.value = lang.value || store.config.kafedra.default_language;
      updateSensInfo();
    },
  };
}

// ---------- 2. Vazifalar doskasi ----------

const COLUMNS: { status: CardStatus[]; title: string }[] = [
  { status: ['planned'], title: 'Rejalandi' },
  { status: ['working'], title: 'Jarayonda' },
  { status: ['reviewing'], title: 'Tekshiruvda' },
  { status: ['revising'], title: 'Qayta ishlash' },
  { status: ['done', 'failed'], title: 'Tayyor' },
];

export function boardPanel(store: Store): Panel {
  const el = h('section', { class: 'panel', hidden: true });
  return {
    id: 'board',
    label: 'Doska',
    el,
    render() {
      const board = h('div', { class: 'kanban' });
      for (const col of COLUMNS) {
        const cards = [...store.tasks.values()].filter((t) => col.status.includes(t.status));
        board.append(
          h(
            'div',
            { class: 'col' },
            h('h3', {}, h('span', {}, col.title), h('span', {}, String(cards.length))),
            ...cards.map((t) =>
              h(
                'div',
                { class: `card${t.status === 'failed' ? ' failed' : ''}`, title: t.title },
                `${t.id} · ${store.config?.agents.find((a) => a.id === t.assignee)?.title ?? t.title}`,
                h('div', { class: 'who' }, `${store.agentName(t.assignee)}${t.score != null ? ` · ${t.score}/10` : ''}${t.status === 'failed' ? ' · xato' : ''}${t.warned ? ' · ogohlantirish' : ''}`),
              ),
            ),
          ),
        );
      }
      el.replaceChildren(store.tasks.size ? board : h('p', { class: 'muted' }, 'Hozircha vazifa yo\'q. Topshiriq yuboring.'));
    },
  };
}

// ---------- 3. Jonli jurnal ----------

const FILTERS: Record<string, (type: string) => boolean> = {
  all: () => true,
  state: (t) => t === 'agent_state',
  flow: (t) => ['run_started', 'plan_ready', 'task_assigned', 'handoff', 'run_finished', 'run_failed'].includes(t),
  review: (t) => t === 'review_result' || t === 'revision_requested',
  provider: (t) => t === 'provider_switch' || t === 'usage_update',
};

export function logPanel(store: Store): Panel {
  const sel = h('select', { class: 'filter', 'aria-label': 'Jurnal filtri' },
    h('option', { value: 'all' }, 'Hammasi'),
    h('option', { value: 'flow' }, 'Oqim'),
    h('option', { value: 'state' }, 'Holatlar'),
    h('option', { value: 'review' }, 'Tekshiruv'),
    h('option', { value: 'provider' }, 'Provayder'),
  );
  const list = h('ul', { class: 'log' });
  const el = h('section', { class: 'panel', hidden: true }, sel, list);
  sel.addEventListener('change', () => panel.render());
  const panel: Panel = {
    id: 'log',
    label: 'Jurnal',
    el,
    render() {
      const f = FILTERS[sel.value] ?? FILTERS.all!;
      const stick = el.parentElement ? el.parentElement.scrollTop + el.parentElement.clientHeight >= el.parentElement.scrollHeight - 30 : true;
      list.replaceChildren(
        ...store.events.filter((e) => f(e.type)).slice(-300).map((e) => {
          const time = e.ts.slice(11, 19);
          const who = e.type === 'handoff' ? `${store.agentName(e.agent)} → ${store.agentName(e.to)}` : store.agentName(e.agent);
          return h('li', {}, h('span', { class: 't' }, `${time} `), who ? h('span', { class: 'ag' }, `${who}: `) : null, `${e.type === 'agent_state' ? `[${e.state}] ` : ''}${e.text ?? e.type}`);
        }),
      );
      if (stick && el.parentElement) el.parentElement.scrollTop = el.parentElement.scrollHeight;
    },
  };
  return panel;
}

// ---------- 4. Natija ----------

export function resultPanel(store: Store, fetchRun: () => Promise<RunSnapshot | null>): Panel {
  const list = h('div', { class: 'result-list' });
  const doc = h('div', { class: 'doc md' });
  const docxBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Yuklab olish (.docx)');
  const viewBtn = h('button', { class: 'btn small ghost', type: 'button', 'aria-pressed': 'false' }, "Matn ko'rinishi");
  let raw = false;
  const copyBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Nusxalash');
  const dlBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Yuklab olish (.md)');
  const note = h('p', { class: 'muted' });
  const reviewBox = h('div', { class: 'reviews' });
  const el = h('section', { class: 'panel', hidden: true }, list, h('div', { class: 'row' }, copyBtn, dlBtn, docxBtn, viewBtn), note, doc, reviewBox);
  let snap: RunSnapshot | null = null;
  let selected = 'final';

  const current = () => (selected === 'final' ? snap?.final : snap?.deliverables[selected]) ?? '';

  viewBtn.addEventListener('click', () => {
    raw = !raw;
    viewBtn.setAttribute('aria-pressed', String(raw));
    viewBtn.textContent = raw ? "Formatlangan ko'rinish" : "Matn ko'rinishi";
    panel.render();
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(current());
      note.textContent = 'Nusxalandi.';
    } catch {
      note.textContent = 'Nusxalab bo\'lmadi: matnni qo\'lda belgilang.';
    }
  });
  dlBtn.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([current()], { type: 'text/markdown;charset=utf-8' }));
    const a = h('a', { href: url, download: `${selected === 'final' ? 'final' : selected}.md` });
    a.click();
    URL.revokeObjectURL(url);
  });

  docxBtn.addEventListener('click', async () => {
    try {
      const r = await fetch(`/api/run/export.docx?file=${encodeURIComponent(selected)}`);
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob());
      h('a', { href: url, download: `${selected}.docx` }).click();
      URL.revokeObjectURL(url);
    } catch {
      note.textContent = ".docx yuklab bo'lmadi.";
    }
  });

  const panel: Panel = {
    id: 'result',
    label: 'Natija',
    el,
    render() {
      list.replaceChildren();
      const items: { id: string; label: string }[] = [];
      if (snap?.final) items.push({ id: 'final', label: 'Yakuniy hujjat' });
      for (const t of snap?.plan ?? []) {
        if (snap?.deliverables[t.id]) items.push({ id: t.id, label: `${t.id}: ${store.agentName(t.assignee)}` });
      }
      if (!items.some((i) => i.id === selected)) selected = items[0]?.id ?? 'final';
      for (const it of items) {
        list.append(h('button', { class: 'btn small ghost', type: 'button', 'aria-pressed': String(it.id === selected), onclick: () => { selected = it.id; panel.render(); } }, it.label));
      }
      doc.classList.toggle('raw', raw);
      if (!items.length) doc.textContent = 'Natija hali tayyor emas.';
      else if (raw) doc.textContent = current();
      else doc.replaceChildren(renderMarkdown(current()));
      copyBtn.disabled = dlBtn.disabled = docxBtn.disabled = !items.length;
      const rs = selected === 'final' ? [] : (snap?.reviews[selected] ?? []).filter(Boolean);
      const VERDICT: Record<string, string> = { approve: 'qabul', revise: 'qayta ishlash', reject: 'rad' };
      reviewBox.replaceChildren(
        ...(rs.length
          ? [
              h('h2', { style: 'margin-top:12px' }, 'Uslubchi izohlari'),
              ...rs.map((r) =>
                h(
                  'div',
                  { class: 'review' },
                  h('div', {}, h('strong', {}, `${r.attempt + 1}-tekshiruv: ${VERDICT[r.verdict] ?? r.verdict}, ${r.score}/10`), r.lint ? ` · format muammolari: ${r.lint}` : '', r.unreviewed ? " · uslubchi javobi o'qilmadi" : ''),
                  r.issues.length ? h('ul', {}, ...r.issues.map((i) => h('li', {}, `${i.place}: ${i.problem}${i.fix ? ` → ${i.fix}` : ''}`))) : h('div', { class: 'muted' }, "Izoh yo'q."),
                ),
              ),
            ]
          : []),
      );
    },
  };
  panel.refresh = async () => {
    snap = await fetchRun();
    panel.render();
  };
  return panel;
}

// ---------- 5. Limitlar ----------

export function limitsPanel(store: Store): Panel {
  const el = h('section', { class: 'panel', hidden: true });
  return {
    id: 'limits',
    label: 'Limitlar',
    el,
    render() {
      const cfg = store.config;
      if (!cfg) return;
      const rows = cfg.providers.map((p) => {
        const u = store.usage.get(p.id);
        const limit = u?.limit ?? p.rpd ?? null;
        const count = u?.count ?? 0;
        const pct = limit ? Math.min(100, (count / limit) * 100) : 0;
        const cls = pct >= 100 ? 'max' : pct >= 80 ? 'hi' : '';
        return h(
          'div',
          { class: `prov${p.enabled ? '' : ' off'}` },
          h('div', { class: 'line' }, h('strong', {}, `${p.id}${store.currentProvider === p.id ? ' ●' : ''}`), h('span', {}, p.enabled ? `${count} / ${limit ?? '?'} bugun` : "o'chiq")),
          h('div', { class: 'bar' }, h('i', { class: cls, style: `width:${pct}%` })),
        );
      });
      el.replaceChildren(
        h('h2', {}, 'Bugungi so\'rovlar'),
        ...rows,
        h('p', { class: 'muted' }, store.lastSwitch ? `Oxirgi almashtirish: ${store.lastSwitch}` : 'Provayder almashtirilmagan.'),
      );
    },
  };
}

// ---------- 6. Sozlamalar ----------

export function settingsPanel(store: Store): Panel {
  const el = h('section', { class: 'panel', hidden: true });
  return {
    id: 'settings',
    label: 'Sozlamalar',
    el,
    render() {
      const c = store.config;
      if (!c) return;
      const kv = (pairs: [string, string][]) => h('dl', { class: 'kv' }, ...pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
      el.replaceChildren(
        h('h2', {}, 'Kafedra'),
        kv([
          ['Nomi', c.kafedra.name],
          ['Auditoriya', c.kafedra.audience],
          ['Tillar', c.kafedra.languages.join(', ')],
          ['Qayta ishlash', `${c.limits.max_revisions} martagacha`],
          ['Parallel ish', String(c.limits.concurrency)],
          ['Rejim', c.mock ? 'MOCK (kalitsiz sinov)' : 'Real'],
        ]),
        ...(c.problems.length ? [h('div', { class: 'note warn' }, ...c.problems.map((p) => h('div', {}, p)))] : []),
        h('h2', {}, 'Agentlar'),
        kv(c.agents.map((a) => [a.name, a.title] as [string, string])),
        h('h2', {}, 'Provayder zanjirlari'),
        kv(Object.entries(c.chains).map(([k, v]) => [k, v.join(' → ')] as [string, string])),
        h('p', { class: 'muted' }, 'Tahrirlash: config/*.yaml fayllari orqali. Bu yerda faqat ko\'rsatiladi.'),
      );
    },
  };
}
