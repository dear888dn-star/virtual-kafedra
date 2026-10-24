import type { Slide, SlideDeck } from '../src/shared/slides';
import { THEMES, type Theme, type ThemeId } from '../src/shared/themes';

// Brauzerdagi taqdimot ko'rinishi: .pptx bilan bir xil mavzu va maketlar. Faqat DOM (textContent) orqali quriladi.

type Child = Node | string | null | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  for (const c of children) if (c != null) e.append(c);
  return e;
}

const dot = (cls: string, css: string) => {
  const d = el('span', cls);
  d.style.cssText = css;
  return d;
};

function bulletList(items: string[]): HTMLUListElement {
  const ul = el('ul', 's-list');
  for (const it of items) ul.append(el('li', '', it));
  return ul;
}

function slideBody(sl: Slide, idx: number, t: Theme, deck: SlideDeck): HTMLElement {
  const root = el('div', `slide s-${sl.layout}`);
  switch (sl.layout) {
    case 'title':
    case 'closing': {
      root.append(dot('s-circle c1', ''), dot('s-circle c2', ''), el('div', 's-bar'));
      root.append(el('h2', 's-h', sl.title));
      const sub = sl.subtitle ?? (sl.layout === 'title' ? deck.subtitle : undefined);
      if (sub) root.append(el('p', 's-sub', sub));
      if (sl.layout === 'closing' && sl.bullets?.length) root.append(bulletList(sl.bullets));
      break;
    }
    case 'section':
      root.append(el('div', 's-side', el('span', 's-num', String(idx).padStart(2, '0'))));
      root.append(el('div', 's-main', el('h2', 's-h', sl.title), sl.subtitle ? el('p', 's-sub', sl.subtitle) : null));
      break;
    case 'bullets': {
      root.append(el('div', 's-edge'), el('h3', 's-title', sl.title), el('div', 's-rule'));
      const items = sl.bullets ?? [];
      if (items.length >= 2 && items.length <= 4) {
        const grid = el('div', `s-cards n${items.length}`);
        items.forEach((it, i) => grid.append(el('div', 's-card', el('span', 's-badge', String(i + 1)), el('p', '', it))));
        root.append(grid);
      } else {
        root.append(el('div', 's-body', bulletList(items)));
      }
      break;
    }
    case 'two_column': {
      root.append(el('div', 's-edge'), el('h3', 's-title', sl.title), el('div', 's-rule'));
      const col = (title: string | undefined, items: string[], cls: string) =>
        el('div', `s-col ${cls}`, el('div', 's-colhead', title ?? ''), bulletList(items));
      root.append(el('div', 's-cols', col(sl.left_title ?? 'Bir tomoni', sl.left ?? [], 'a'), col(sl.right_title ?? 'Ikkinchi tomoni', sl.right ?? [], 'b')));
      break;
    }
    case 'stats': {
      root.append(el('div', 's-edge'), el('h3', 's-title', sl.title), el('div', 's-rule'));
      const row = el('div', 's-stats');
      for (const s of sl.stats ?? []) row.append(el('div', 's-stat', el('b', '', s.value), el('span', '', s.label)));
      root.append(row);
      break;
    }
    case 'quote':
      root.append(el('div', 's-qmark', '“'), el('p', 's-quote', sl.quote ?? sl.title));
      if (sl.author) root.append(el('p', 's-author', `— ${sl.author}`));
      break;
    case 'timeline': {
      root.append(el('div', 's-edge'), el('h3', 's-title', sl.title), el('div', 's-rule'));
      const line = el('div', 's-line');
      const steps = el('div', 's-steps');
      (sl.steps ?? []).forEach((st, i) => steps.append(el('div', 's-step', el('span', 's-badge', String(i + 1)), el('b', '', st.title), st.text ? el('span', '', st.text) : null)));
      root.append(line, steps);
      break;
    }
    case 'table': {
      root.append(el('div', 's-edge'), el('h3', 's-title', sl.title), el('div', 's-rule'));
      const tb = sl.table;
      if (tb) {
        const table = el('table', 's-table');
        const head = el('tr', '');
        for (const h of tb.head) head.append(el('th', '', h));
        table.append(head);
        for (const r of tb.rows) {
          const tr = el('tr', '');
          for (const c of r) tr.append(el('td', '', c));
          table.append(tr);
        }
        root.append(table);
      }
      break;
    }
  }
  const dark = sl.layout === 'title' || sl.layout === 'closing' || sl.layout === 'quote';
  if (!dark && sl.layout !== 'section') root.append(el('span', 's-no', String(idx)));
  return root;
}

/** Taqdimotni slaydlar ro'yxati (16:9 kartalar) sifatida chizadi. */
export function renderDeck(deck: SlideDeck, themeId: ThemeId): HTMLElement {
  const t = THEMES[themeId];
  const wrap = el('div', `deck${t.dark ? ' dark' : ''}`);
  const vars: Record<string, string> = {
    '--s-bg': `#${t.bg}`,
    '--s-surface': `#${t.surface}`,
    '--s-primary': `#${t.primary}`,
    '--s-secondary': `#${t.secondary}`,
    '--s-accent': `#${t.accent}`,
    '--s-text': `#${t.text}`,
    '--s-muted': `#${t.muted}`,
    '--s-on': `#${t.onPrimary}`,
    '--s-head': `${t.headFont}, Georgia, serif`,
    '--s-body': `${t.bodyFont}, system-ui, sans-serif`,
  };
  for (const [k, v] of Object.entries(vars)) wrap.style.setProperty(k, v);
  deck.slides.forEach((sl, i) => {
    const frame = el('div', 'slide-frame', slideBody(sl, i + 1, t, deck));
    if (sl.notes) frame.append(el('p', 'slide-notes', `Spiker izohi: ${sl.notes}`));
    wrap.append(frame);
  });
  return wrap;
}
