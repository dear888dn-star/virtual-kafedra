import { formatBook, bookKey, type Book, type SourceMode } from '../src/shared/sources';
import { h } from './dom';

export type SearchOutcome = { ok: true; books: Book[]; notes: string[]; queries: string[] } | { ok: false; error: string };

export interface SourceValue {
  source_mode: SourceMode;
  books: Book[];
  material?: string;
}

export interface SourcePickerOptions {
  /** Joriy topshiriq matni (qidiruv mavzusi) */
  getTask(): string;
  search(task: string): Promise<SearchOutcome>;
  maxMaterial(): number;
}

type Mode = 'mine' | 'search' | 'none';

/**
 * "Qaysi kitob asosida ishlaymiz?" bosqichi: o'z kitobini ko'rsatish, internetdan tavsiya olish yoki manbasiz ishlash.
 * Rejim tanlanmaguncha topshiriq yuborilmaydi.
 */
export function sourcePicker(opts: SourcePickerOptions): { el: HTMLElement; get(): SourceValue | null; validate(): string | null; refresh(): void } {
  let mode: Mode | null = null;
  let books: Book[] = [];
  let results: Book[] = [];
  let searching = false;

  const radios: Record<Mode, HTMLInputElement> = {
    mine: h('input', { type: 'radio', name: 'src-mode', value: 'mine' }),
    search: h('input', { type: 'radio', name: 'src-mode', value: 'search' }),
    none: h('input', { type: 'radio', name: 'src-mode', value: 'none' }),
  };
  const card = (m: Mode, title: string, text: string) =>
    h('label', { class: 'src-opt' }, radios[m], h('span', {}, h('b', {}, title), h('small', {}, text)));

  // --- "Kitobim bor"
  const inTitle = h('input', { type: 'text', placeholder: 'Kitob nomi', maxlength: '200', 'aria-label': 'Kitob nomi' });
  const inAuthor = h('input', { type: 'text', placeholder: 'Muallif (ixtiyoriy)', maxlength: '80', 'aria-label': 'Muallif' });
  const inYear = h('input', { type: 'text', placeholder: 'Yil', maxlength: '4', style: 'max-width:70px', 'aria-label': 'Nashr yili' });
  const addBtn = h('button', { class: 'btn small', type: 'button' }, "Qo'shish");
  const minePanel = h('div', { class: 'src-panel', hidden: true }, h('div', { class: 'row' }, inTitle, inAuthor, inYear, addBtn));

  // --- Qidirish
  const searchBtn = h('button', { class: 'btn small', type: 'button' }, 'Kitoblarni qidirish');
  const searchNote = h('p', { class: 'muted' }, "Mavzu bo'yicha ochiq kataloglardan (Open Library) kitob topiladi. Bitta model so'rovi sarflanadi. Katalogda tasdiqlangan kitoblargina ko'rsatiladi.");
  const resultBox = h('div', { class: 'src-results' });
  const searchPanel = h('div', { class: 'src-panel', hidden: true }, h('div', { class: 'row' }, searchBtn), searchNote, resultBox);

  // --- Kitob matni (ikkala rejimda ham)
  const mat = h('textarea', { placeholder: "Kitobdan parcha, konspekt yoki sillabus matni (ixtiyoriy, lekin eng ishonchli natija beradi). Model faqat topshiriqqa mos parchalarni oladi.", style: 'min-height:80px' });
  const matInfo = h('p', { class: 'muted' });
  const matFile = h('input', { type: 'file', accept: '.pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown', 'aria-label': 'Kitob matni faylini tanlash' });
  const matBox = h('details', { class: 'material', hidden: true }, h('summary', {}, "Kitob matni yoki parcha (ixtiyoriy)"), mat, h('div', { class: 'row' }, matFile, h('button', { class: 'btn small ghost', type: 'button', onclick: () => { mat.value = ''; matFile.value = ''; updateMat(); } }, 'Tozalash')), matInfo);

  // --- Tanlanganlar
  const chosen = h('div', { class: 'src-chosen' });

  // --- "Manba kerak emas"
  const nonePanel = h('div', { class: 'src-panel note', hidden: true }, "Manba talab qilinmaydi: kafedra umumiy bilimga tayanadi. Aniq raqam va iqtiboslar baribir [MANBA KERAK] bilan belgilanadi.");

  const hint = h('p', { class: 'note warn', hidden: true, role: 'alert' });
  const el = h(
    'fieldset',
    { class: 'src' },
    h('legend', {}, 'Qaysi kitob asosida ishlaymiz?'),
    h('p', { class: 'muted', style: 'margin:0 0 6px' }, "Kafedra ma'lumotlarni faqat siz tanlagan kitob(lar) asosida shakllantiradi."),
    h('div', { class: 'src-opts' },
      card('mine', 'Kitobim bor', "Nomi va muallifini ayting (matnini ham berishingiz mumkin)"),
      card('search', 'Mos kitob topib bering', 'Internetdan tavsiya oling va tanlang'),
      card('none', 'Manba kerak emas', 'Umumiy savol yoki ijodiy ish'),
    ),
    minePanel,
    searchPanel,
    nonePanel,
    chosen,
    matBox,
    hint,
  );

  const updateMat = () => {
    const n = mat.value.length;
    const max = opts.maxMaterial();
    matInfo.textContent = n ? `${n} belgi${n > max ? ` (ruxsat etilgan ${max} dan ortiq: qisqartiring)` : ''}. Matn tashqi AI xizmatiga yuboriladi.` : ".txt yoki .md fayl yuklang yoki matnni shu yerga qo'ying.";
    matInfo.className = n > max ? 'note err' : 'muted';
  };
  mat.addEventListener('input', updateMat);
  matFile.addEventListener('change', async () => {
    const f = matFile.files?.[0];
    if (!f) return;
    matBox.open = true;
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      if (f.size > 40_000_000) {
        matInfo.textContent = 'PDF juda katta (40 MB gacha).';
        return;
      }
      matInfo.textContent = "PDF o'qilmoqda…";
      try {
        const r = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: f });
        const j = (await r.json().catch(() => ({}))) as { text?: string; pages?: number; chars?: number; truncated?: boolean; error?: string };
        if (!r.ok || !j.text) {
          matInfo.textContent = j.error ?? `PDF o'qilmadi (${r.status})`;
          matInfo.className = 'note err';
          return;
        }
        mat.value = j.text;
        updateMat();
        matInfo.textContent = `PDF: ${j.pages} sahifa, ${j.chars} belgi o'qildi${j.truncated ? ` (birinchi ${j.text.length} belgi olindi)` : ''}. Model faqat topshiriqqa mos parchalarni oladi.`;
      } catch {
        matInfo.textContent = "PDF yuborib bo'lmadi: serverga ulanishni tekshiring.";
        matInfo.className = 'note err';
      }
      return;
    }
    if (f.size > 2_000_000) {
      matInfo.textContent = 'Fayl juda katta (2 MB gacha).';
      return;
    }
    mat.value = await f.text();
    updateMat();
  });

  const renderChosen = () => {
    chosen.replaceChildren(
      ...(books.length
        ? [
            h('div', { class: 'muted' }, `Tanlangan kitoblar (${books.length}):`),
            ...books.map((b, i) =>
              h('div', { class: 'src-chip' }, h('span', {}, formatBook(b)), h('button', { type: 'button', class: 'btn small ghost', 'aria-label': `${b.title} ni olib tashlash`, onclick: () => { books.splice(i, 1); renderChosen(); renderResults(); } }, '×')),
            ),
          ]
        : []),
    );
  };

  const has = (b: Book) => books.some((x) => bookKey(x) === bookKey(b));
  const renderResults = () => {
    if (searching) {
      resultBox.replaceChildren(h('p', { class: 'muted' }, 'Qidirilmoqda…'));
      return;
    }
    resultBox.replaceChildren(
      ...results.map((b) =>
        h('div', { class: 'src-book' },
          h('div', {},
            h('b', {}, b.title),
            h('div', { class: 'muted' }, `${(b.authors ?? []).join(', ') || 'Muallif nomaʼlum'}${b.year ? ` · ${b.year}` : ''}${b.publisher ? ` · ${b.publisher}` : ''}`),
            h('div', { class: 'src-tags' },
              b.recommended ? h('span', { class: 'badge badge-mock' }, 'Tavsiya') : null,
              b.verified ? h('span', { class: 'badge' }, 'Katalogda tasdiqlangan') : null,
              b.url ? h('a', { href: b.url, target: '_blank', rel: 'noopener noreferrer' }, 'Katalog') : null,
            ),
          ),
          h('button', { class: has(b) ? 'btn small ghost' : 'btn small', type: 'button', disabled: has(b), onclick: () => { if (books.length < 8) books.push(b); renderChosen(); renderResults(); } }, has(b) ? 'Tanlandi' : 'Tanlash'),
        ),
      ),
    );
  };

  addBtn.addEventListener('click', () => {
    const title = inTitle.value.trim();
    if (title.length < 2) {
      inTitle.focus();
      return;
    }
    const authors = inAuthor.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
    const b: Book = { title, authors, year: inYear.value.trim() || undefined, origin: 'user' };
    if (!has(b) && books.length < 8) books.push(b);
    inTitle.value = inAuthor.value = inYear.value = '';
    renderChosen();
    hint.hidden = true;
  });
  inTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBtn.click();
    }
  });

  searchBtn.addEventListener('click', async () => {
    const task = opts.getTask().trim();
    if (task.length < 3) {
      searchNote.textContent = 'Avval yuqoriga topshiriq matnini yozing: qidiruv mavzuga qarab ishlaydi.';
      searchNote.className = 'note warn';
      return;
    }
    searching = true;
    searchBtn.disabled = true;
    renderResults();
    const r = await opts.search(task);
    searching = false;
    searchBtn.disabled = false;
    if (!r.ok) {
      results = [];
      searchNote.textContent = r.error;
      searchNote.className = 'note err';
    } else {
      results = r.books;
      searchNote.className = 'note';
      searchNote.textContent = r.books.length
        ? `${r.books.length} ta kitob topildi. Bir yoki bir nechtasini tanlang.${r.notes.length ? ` ${r.notes.join(' ')}` : ''}`
        : r.notes.join(' ') || "Mos kitob topilmadi. \"Kitobim bor\" bo'limida kitobni o'zingiz kiriting.";
    }
    renderResults();
  });

  const setMode = (m: Mode) => {
    mode = m;
    minePanel.hidden = m !== 'mine';
    searchPanel.hidden = m !== 'search';
    nonePanel.hidden = m !== 'none';
    chosen.hidden = m === 'none';
    matBox.hidden = m === 'none';
    hint.hidden = true;
    el.classList.toggle('src-need', false);
  };
  for (const m of Object.keys(radios) as Mode[]) radios[m].addEventListener('change', () => radios[m].checked && setMode(m));

  updateMat();
  renderChosen();

  return {
    el,
    refresh: updateMat,
    validate() {
      if (!mode) return "Avval manbani tanlang: \"Kitobim bor\", \"Mos kitob topib bering\" yoki \"Manba kerak emas\".";
      if (mode !== 'none' && books.length === 0 && !mat.value.trim()) {
        return mode === 'mine' ? "Kitob nomini kiriting va \"Qo'shish\" ni bosing (yoki kitob matnini qo'ying)." : 'Kamida bitta kitobni tanlang (avval "Kitoblarni qidirish" ni bosing).';
      }
      if (mat.value.length > opts.maxMaterial()) return `Kitob matni juda uzun (maksimum ${opts.maxMaterial()} belgi).`;
      return null;
    },
    get(): SourceValue | null {
      if (!mode) return null;
      if (mode === 'none') return { source_mode: 'none', books: [] };
      return { source_mode: 'books', books: books.map((b) => ({ ...b })), material: mat.value.trim() || undefined };
    },
  };
}
