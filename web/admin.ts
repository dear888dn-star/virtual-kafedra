import type { AdminAgent, AdminLimits, AdminProvider, AdminSettings, AdminUpdate } from '../src/shared/admin';
import { h } from './panels';

const root = document.getElementById('root') as HTMLElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const stateEl = document.getElementById('state') as HTMLElement;

let data: AdminSettings;
let dirty = false;
/** Yangi kiritilgan kalitlar (faqat xotirada, saqlangach tozalanadi) */
let newKeys: Record<string, string> = {};

const LIMIT_LABELS: Record<keyof AdminLimits, [string, string]> = {
  max_revisions: ['Qayta ishlash soni', "Uslubchi qaytargan ishni necha marta qayta ishlash mumkin (0–10)"],
  concurrency: ["Bir vaqtda o'qituvchilar", 'Bir vaqtda ishlaydigan o‘qituvchilar soni (1–10)'],
  max_input_chars: ['Topshiriq uzunligi', 'Topshiriq matnining maksimal hajmi, belgi (100–200000)'],
  max_material_chars: ['Manba material uzunligi', 'Manba materialning maksimal hajmi, belgi (0–60000)'],
  max_plan_tasks: ['Reja vazifalari', 'Mudir bitta topshiriqni ko‘pi bilan nechta vazifaga bo‘ladi (1–30)'],
  max_requests_per_run: ["Bitta ishdagi so'rovlar", "Bitta topshiriq uchun model so'rovlarining qat'iy chegarasi (3–1000). Tokenlarni himoya qiladi"],
};

function setState(text: string, cls = ''): void {
  stateEl.textContent = text;
  stateEl.className = `badge ${cls}`.trim();
}

function touch(): void {
  dirty = true;
  saveBtn.disabled = data.running;
  setState(data.running ? 'Topshiriq bajarilmoqda: saqlab bo‘lmaydi' : "Saqlanmagan o'zgarishlar bor", 'running');
}

function field(label: string, hint: string, input: HTMLElement): HTMLElement {
  return h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('p', { class: 'muted' }, hint) : null);
}

function textInput(value: string, on: (v: string) => void, attrs: Record<string, string> = {}): HTMLInputElement {
  const el = h('input', { type: 'text', value, ...attrs, oninput: (e) => { on((e.target as HTMLInputElement).value); touch(); } });
  el.value = value;
  return el;
}

function numInput(value: number | null, on: (v: number | null) => void, attrs: Record<string, string> = {}): HTMLInputElement {
  const el = h('input', { type: 'number', min: '0', step: '1', ...attrs, oninput: (e) => {
    const raw = (e.target as HTMLInputElement).value;
    on(raw === '' ? null : Number(raw));
    touch();
  } });
  el.value = value === null ? '' : String(value);
  return el;
}

function card(title: string, intro: string, ...body: HTMLElement[]): HTMLElement {
  return h('section', { class: 'card-box' }, h('h2', {}, title), intro ? h('p', { class: 'muted intro' }, intro) : null, ...body);
}

function generalCard(): HTMLElement {
  return card(
    'Umumiy',
    '',
    h('div', { class: 'grid2' },
      field('Kafedra nomi', '', textInput(data.kafedra.name, (v) => (data.kafedra.name = v), { maxlength: '200' })),
      field('Auditoriya', '', textInput(data.kafedra.audience, (v) => (data.kafedra.audience = v), { maxlength: '200' })),
    ),
    h('label', { class: 'check' },
      (() => {
        const c = h('input', { type: 'checkbox', onchange: (e) => { data.mock_forced = (e.target as HTMLInputElement).checked; touch(); } });
        c.checked = data.mock_forced;
        return c;
      })(),
      'Sinov rejimi (MOCK): real modellarga so‘rov yuborilmaydi, kalit sarflanmaydi',
    ),
  );
}

function limitsCard(): HTMLElement {
  const grid = h('div', { class: 'grid2' });
  for (const k of Object.keys(LIMIT_LABELS) as (keyof AdminLimits)[]) {
    const [label, hint] = LIMIT_LABELS[k];
    grid.append(field(label, hint, numInput(data.limits[k], (v) => (data.limits[k] = v ?? 0))));
  }
  return card('Chegaralar', "Ishlash hajmi va token sarfini cheklaydi.", grid);
}

function genderSelect(a: AdminAgent): HTMLSelectElement {
  const sel = h('select', { 'aria-label': `${a.name} jinsi`, onchange: (e) => { a.gender = (e.target as HTMLSelectElement).value === 'female' ? 'female' : 'male'; touch(); } },
    h('option', { value: 'male' }, 'Erkak'),
    h('option', { value: 'female' }, 'Ayol'),
  );
  sel.value = a.gender;
  return sel;
}

function agentsCard(): HTMLElement {
  const rows = data.agents.map((a) => {
    const color = h('input', { type: 'color', 'aria-label': `${a.name} rangi`, oninput: (e) => { a.color = (e.target as HTMLInputElement).value; touch(); } });
    color.value = a.color;
    return h('div', { class: 'agent-row' },
      h('span', { class: 'badge' }, a.role),
      textInput(a.name, (v) => (a.name = v), { maxlength: '60', 'aria-label': 'Ism' }),
      textInput(a.title, (v) => (a.title = v), { maxlength: '60', 'aria-label': 'Lavozim' }),
      genderSelect(a),
      color,
    );
  });
  return card('Agentlar', "Ism, lavozim, jins (3D personaj ko'rinishi) va rang. Rollar va promptlar o'zgarmaydi.", ...rows);
}

function providerRow(p: AdminProvider): HTMLElement {
  const isMock = p.kind === 'mock';
  const en = h('input', { type: 'checkbox', 'aria-label': `${p.id} yoqilgan`, onchange: (e) => { p.enabled = (e.target as HTMLInputElement).checked; row.classList.toggle('off', !p.enabled); touch(); } });
  en.checked = p.enabled;
  const keyBox = p.key_env
    ? h('div', {},
        (() => {
          const k = h('input', { type: 'password', autocomplete: 'off', placeholder: p.key_set ? 'Kalit saqlangan (o‘zgartirish uchun yangisini yozing)' : 'Kalit kiritilmagan', 'aria-label': `${p.id} API kaliti`,
            oninput: (e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) newKeys[p.key_env!] = v; else delete newKeys[p.key_env!]; touch(); } });
          return k;
        })(),
        h('span', { class: `badge ${p.key_set ? 'finished' : 'failed'}` }, p.key_set ? 'kalit bor' : 'kalit yo‘q'),
      )
    : h('span', { class: 'muted' }, isMock ? 'kalit kerak emas' : 'mahalliy, kalit kerak emas');
  const trains = p.trains_on_data === false ? 'ma’lumot o‘qitishga ishlatilmaydi' : p.trains_on_data === true ? 'ma’lumot o‘qitishga ishlatilishi mumkin' : 'ma’lumot siyosati noma’lum';
  const row: HTMLElement = h('div', { class: `prov-row${p.enabled ? '' : ' off'}` },
    h('div', { class: 'prov-head' }, h('label', { class: 'check' }, en, h('strong', {}, p.id)), h('span', { class: 'muted' }, `${p.kind} · ${trains}`)),
    h('div', { class: 'prov-body' },
      field('Model', '', textInput(p.model, (v) => (p.model = v.trim()), { placeholder: 'model nomi', spellcheck: 'false' })),
      field('So‘rov/daqiqa', '', numInput(p.rpm, (v) => (p.rpm = v))),
      field('So‘rov/kun', '', numInput(p.rpd, (v) => (p.rpd = v))),
      field('Token/daqiqa', '', numInput(p.tpm, (v) => (p.tpm = v))),
    ),
    field('API kalit', '', keyBox),
  );
  return row;
}

function providersCard(): HTMLElement {
  return card(
    'Provayderlar va modellar',
    "Yoqilgan, kaliti bor va modeli yozilgan provayderlar ishlaydi. Limitlarni o'z dashboardingizdagi qiymatlarga moslang. Kalitlar faqat serverdagi .env faylida saqlanadi va bu sahifaga qaytarilmaydi.",
    ...data.providers.filter((p) => p.kind !== 'mock').map(providerRow),
  );
}

function chainsCard(): HTMLElement {
  const real = data.providers.filter((p) => p.kind !== 'mock').map((p) => p.id);
  const box = h('div', {});
  const render = (): void => {
    box.replaceChildren();
    for (const role of Object.keys(data.chains)) {
      const ids = data.chains[role]!;
      const list = h('ol', { class: 'chain' });
      ids.forEach((id, i) => {
        const move = (d: number) => () => {
          const j = i + d;
          if (j < 0 || j >= ids.length) return;
          [ids[i], ids[j]] = [ids[j]!, ids[i]!];
          touch();
          render();
        };
        list.append(h('li', {},
          h('span', {}, id),
          h('span', { class: 'chain-btns' },
            h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `${id} ni yuqoriga`, onclick: move(-1) }, '↑'),
            h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `${id} ni pastga`, onclick: move(1) }, '↓'),
            h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `${id} ni olib tashlash`, onclick: () => { ids.splice(i, 1); touch(); render(); } }, '✕'),
          ),
        ));
      });
      const free = real.filter((id) => !ids.includes(id));
      const add = h('select', { 'aria-label': `${role} zanjiriga qo'shish`, onchange: (e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v) { ids.push(v); touch(); render(); }
      } }, h('option', { value: '' }, '+ provayder qo‘shish'), ...free.map((id) => h('option', { value: id }, id)));
      box.append(h('div', { class: 'chain-box' }, h('h3', {}, role), list, free.length ? add : null));
    }
  };
  render();
  return card('Zanjirlar (zaxira tartibi)', "Rol bo'yicha: birinchisi ishlamasa yoki kvotasi tugasa keyingisiga o'tiladi.", box);
}

function render(): void {
  root.replaceChildren(generalCard(), limitsCard(), providersCard(), chainsCard(), agentsCard());
}

function collect(): AdminUpdate {
  return {
    kafedra: data.kafedra,
    limits: data.limits,
    agents: data.agents.map(({ id, name, title, color, gender }) => ({ id, name, title, color, gender })),
    providers: data.providers.map(({ id, enabled, model, rpm, rpd, tpm }) => ({ id, enabled, model, rpm, rpd, tpm })),
    chains: data.chains,
    mock_forced: data.mock_forced,
    keys: newKeys,
  };
}

async function load(): Promise<void> {
  const res = await fetch('/api/admin/settings');
  data = (await res.json()) as AdminSettings;
  newKeys = {};
  dirty = false;
  saveBtn.disabled = true;
  setState(data.running ? 'Topshiriq bajarilmoqda' : 'Hammasi saqlangan', data.running ? 'running' : 'finished');
  render();
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  setState('Saqlanmoqda…', 'running');
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect()),
    });
    const body = (await res.json()) as { error?: string; settings?: AdminSettings; mock?: boolean; problems?: string[] };
    if (!res.ok || !body.settings) {
      setState(body.error ?? 'Saqlab bo‘lmadi', 'failed');
      saveBtn.disabled = false;
      return;
    }
    data = body.settings;
    newKeys = {};
    dirty = false;
    render();
    const note = body.problems?.length ? ` · Ogohlantirish: ${body.problems.join(' | ')}` : '';
    setState(`Saqlandi va qo‘llandi (${body.mock ? 'MOCK rejimi' : 'real rejim'})${note}`, body.problems?.length ? 'running' : 'finished');
  } catch (e) {
    setState(`Aloqa xatosi: ${(e as Error).message}`, 'failed');
    saveBtn.disabled = false;
  }
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

load().catch((e) => {
  root.replaceChildren(h('p', { class: 'note err' }, `Sozlamalarni yuklab bo'lmadi: ${(e as Error).message}`));
});
