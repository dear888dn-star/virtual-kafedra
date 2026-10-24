import PptxGenJS from 'pptxgenjs';
import type { Slide, SlideDeck } from '../shared/slides';
import { THEMES, isThemeId, type Theme, type ThemeId } from '../shared/themes';

// 16:9 keng ekran: 13.333 x 7.5 dyuym. Hamma maketlar bitta mavzudan (ranglar, shriftlar) olinadi.
const W = 13.333;
const H = 7.5;
const MX = 0.9; // chap/o'ng chekka
const CW = W - 2 * MX; // kontent kengligi

export interface PptxOptions {
  /** Mavzu; berilmasa taqdimotdagi theme, u ham bo'lmasa "okean" */
  theme?: ThemeId;
  /** Pastki chap burchakdagi yozuv (masalan kafedra nomi) */
  footerLabel?: string;
}

/** Matn uzunligiga qarab shrift o'lchamini kamaytiradi, shunda matn quti chegarasidan chiqib ketmaydi. */
export function fitFont(text: string, base: number, min: number, softChars: number): number {
  if (text.length <= softChars) return base;
  const k = Math.sqrt(softChars / text.length);
  return Math.max(min, Math.round(base * k));
}

const subtle = (t: Theme) => (t.dark ? '374151' : 'E2E8F0');

export async function buildPptx(deck: SlideDeck, opts: PptxOptions = {}): Promise<Uint8Array> {
  const themeId: ThemeId = opts.theme && isThemeId(opts.theme) ? opts.theme : deck.theme && isThemeId(deck.theme) ? deck.theme : 'okean';
  const t = THEMES[themeId];
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = deck.title;
  if (opts.footerLabel) pres.company = opts.footerLabel;
  const shape = pres.ShapeType;
  const label = opts.footerLabel ?? '';

  const titleColor = t.dark ? t.text : t.primary;
  const headFont = t.headFont;
  const bodyFont = t.bodyFont;

  const footer = (s: PptxGenJS.Slide, n: number, onDark: boolean) => {
    const c = onDark ? t.onPrimary : t.muted;
    if (label) s.addText(label, { x: MX, y: H - 0.55, w: 7, h: 0.3, fontFace: bodyFont, fontSize: 10, color: c, transparency: onDark ? 30 : 0 });
    s.addText(String(n), { x: W - MX - 0.8, y: H - 0.55, w: 0.8, h: 0.3, fontFace: bodyFont, fontSize: 11, color: c, align: 'right', bold: true });
  };

  const header = (s: PptxGenJS.Slide, sl: Slide) => {
    s.background = { color: t.bg };
    s.addShape(shape.rect, { x: 0, y: 0, w: 0.22, h: H, fill: { color: t.primary }, line: { color: t.primary, width: 0 } });
    s.addText(sl.title, {
      x: MX, y: 0.5, w: CW, h: 1.05, fontFace: headFont, fontSize: fitFont(sl.title, 34, 22, 48), bold: true, color: titleColor, valign: 'middle',
    });
    s.addShape(shape.rect, { x: MX, y: 1.6, w: 1.1, h: 0.07, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
    if (sl.subtitle) s.addText(sl.subtitle, { x: MX + 1.3, y: 1.47, w: CW - 1.3, h: 0.34, fontFace: bodyFont, fontSize: 14, color: t.muted, italic: true });
  };

  const card = (s: PptxGenJS.Slide, x: number, y: number, w: number, h: number) =>
    s.addShape(shape.roundRect, { x, y, w, h, rectRadius: 0.12, fill: { color: t.surface }, line: { color: subtle(t), width: 1 } });

  const badge = (s: PptxGenJS.Slide, x: number, y: number, n: number, d = 0.55) => {
    s.addShape(shape.ellipse, { x, y, w: d, h: d, fill: { color: t.secondary }, line: { color: t.secondary, width: 0 } });
    s.addText(String(n), { x, y, w: d, h: d, fontFace: headFont, fontSize: 16, bold: true, color: t.dark ? '0B1220' : 'FFFFFF', align: 'center', valign: 'middle' });
  };

  const list = (s: PptxGenJS.Slide, items: string[], x: number, y: number, w: number, h: number, base = 22) => {
    const longest = Math.max(...items.map((i) => i.length), 1);
    const size = fitFont('x'.repeat(longest + Math.floor(items.length * 14)), base, 13, 70);
    const runs: PptxGenJS.TextProps[] = [];
    for (const it of items) {
      runs.push({ text: '■  ', options: { color: t.accent, fontSize: Math.max(8, size - 8), fontFace: bodyFont } });
      runs.push({ text: it, options: { color: t.text, fontSize: size, fontFace: bodyFont, breakLine: true, paraSpaceAfter: 10 } });
    }
    s.addText(runs, { x, y, w, h, valign: 'top', margin: 4 });
  };

  const addNotes = (s: PptxGenJS.Slide, sl: Slide) => {
    const parts = [sl.notes, sl.visual ? `Tasvir g'oyasi: ${sl.visual}` : ''].filter(Boolean);
    if (parts.length) s.addNotes(parts.join('\n\n'));
  };

  deck.slides.forEach((sl, idx) => {
    const n = idx + 1;
    const s = pres.addSlide();
    switch (sl.layout) {
      case 'title':
      case 'closing': {
        const dark = !t.dark; // ochiq mavzuda asosiy rang fon, qorong'i mavzuda oddiy fon
        s.background = { color: dark ? t.primary : t.bg };
        const fg = dark ? t.onPrimary : t.text;
        s.addShape(shape.ellipse, { x: 8.3, y: -1.6, w: 7.4, h: 7.4, fill: { color: t.secondary, transparency: 72 }, line: { color: t.secondary, width: 0, transparency: 100 } });
        s.addShape(shape.ellipse, { x: 10.4, y: 3.9, w: 4.6, h: 4.6, fill: { color: t.accent, transparency: 78 }, line: { color: t.accent, width: 0, transparency: 100 } });
        s.addShape(shape.ellipse, { x: 7.6, y: 5.5, w: 1.2, h: 1.2, fill: { color: t.secondary, transparency: 40 }, line: { color: t.secondary, width: 0, transparency: 100 } });
        s.addShape(shape.rect, { x: MX, y: 2.45, w: 1.3, h: 0.12, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
        s.addText(sl.title, { x: MX, y: 2.7, w: 8.0, h: 2.1, fontFace: headFont, fontSize: fitFont(sl.title, 46, 26, 34), bold: true, color: fg, valign: 'top' });
        const sub = sl.subtitle ?? (sl.layout === 'title' ? deck.subtitle : undefined);
        if (sub) s.addText(sub, { x: MX, y: 4.95, w: 7.6, h: 0.9, fontFace: bodyFont, fontSize: 20, color: fg, transparency: 15, valign: 'top' });
        if (sl.layout === 'closing' && sl.bullets?.length) {
          s.addText(sl.bullets.map((b) => ({ text: b, options: { bullet: { code: '25CF' }, breakLine: true, paraSpaceAfter: 6 } })), {
            x: MX, y: 5.5, w: 7.4, h: 1.3, fontFace: bodyFont, fontSize: 15, color: fg, transparency: 10, valign: 'top',
          });
        }
        if (label) s.addText(label, { x: MX, y: H - 0.65, w: 7, h: 0.3, fontFace: bodyFont, fontSize: 11, color: fg, transparency: 35 });
        break;
      }
      case 'section': {
        s.background = { color: t.bg };
        s.addShape(shape.rect, { x: 0, y: 0, w: 4.8, h: H, fill: { color: t.primary }, line: { color: t.primary, width: 0 } });
        s.addText(String(n - 1 || n).padStart(2, '0'), { x: 0.5, y: 2.3, w: 4, h: 2.4, fontFace: headFont, fontSize: 110, bold: true, color: t.accent, align: 'left', valign: 'middle' });
        s.addText(sl.title, { x: 5.6, y: 2.3, w: 6.9, h: 2.0, fontFace: headFont, fontSize: fitFont(sl.title, 40, 24, 36), bold: true, color: titleColor, valign: 'middle' });
        if (sl.subtitle) s.addText(sl.subtitle, { x: 5.6, y: 4.4, w: 6.9, h: 1.0, fontFace: bodyFont, fontSize: 18, color: t.muted, valign: 'top' });
        footer(s, n, false);
        break;
      }
      case 'bullets': {
        header(s, sl);
        const items = sl.bullets ?? [];
        if (items.length >= 2 && items.length <= 4) {
          const cols = items.length === 4 ? 2 : items.length;
          const rows = items.length === 4 ? 2 : 1;
          const gap = 0.3;
          const cw = (CW - gap * (cols - 1)) / cols;
          const ch = rows === 2 ? 2.15 : 3.5;
          const y0 = rows === 2 ? 2.05 : 2.3;
          items.forEach((it, i) => {
            const cx = MX + (i % cols) * (cw + gap);
            const cy = y0 + Math.floor(i / cols) * (ch + gap);
            card(s, cx, cy, cw, ch);
            s.addShape(shape.rect, { x: cx + 0.3, y: cy, w: 0.9, h: 0.08, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
            badge(s, cx + 0.3, cy + 0.3, i + 1);
            const size = fitFont(it, rows === 2 ? 18 : 22, 12, rows === 2 ? 70 : 90);
            s.addText(it, { x: cx + 0.3, y: cy + 1.0, w: cw - 0.6, h: ch - 1.2, fontFace: bodyFont, fontSize: size, color: t.text, valign: 'top' });
          });
        } else {
          list(s, items, MX, 2.0, CW, 4.7);
        }
        footer(s, n, false);
        break;
      }
      case 'two_column': {
        header(s, sl);
        const gap = 0.35;
        const cw = (CW - gap) / 2;
        const cols: [string | undefined, string[], number][] = [
          [sl.left_title, sl.left ?? [], MX],
          [sl.right_title, sl.right ?? [], MX + cw + gap],
        ];
        cols.forEach(([title, items, x], i) => {
          card(s, x, 2.0, cw, 4.5);
          s.addShape(shape.rect, { x, y: 2.0, w: cw, h: 0.75, fill: { color: i === 0 ? t.primary : t.secondary }, line: { color: i === 0 ? t.primary : t.secondary, width: 0 } });
          s.addText(title ?? (i === 0 ? 'Bir tomoni' : 'Ikkinchi tomoni'), { x: x + 0.3, y: 2.0, w: cw - 0.6, h: 0.75, fontFace: headFont, fontSize: 20, bold: true, color: i === 0 ? t.onPrimary : t.dark ? '0B1220' : 'FFFFFF', valign: 'middle' });
          list(s, items, x + 0.3, 2.95, cw - 0.6, 3.4, 20);
        });
        footer(s, n, false);
        break;
      }
      case 'stats': {
        header(s, sl);
        const st = sl.stats ?? [];
        const gap = 0.3;
        const tw = (CW - gap * (st.length - 1)) / Math.max(st.length, 1);
        st.forEach((x, i) => {
          const tx = MX + i * (tw + gap);
          card(s, tx, 2.2, tw, 3.7);
          s.addShape(shape.rect, { x: tx, y: 2.2, w: tw, h: 0.12, fill: { color: i % 2 ? t.secondary : t.accent }, line: { color: t.accent, width: 0 } });
          s.addText(x.value, { x: tx + 0.2, y: 2.65, w: tw - 0.4, h: 1.5, fontFace: headFont, fontSize: fitFont(x.value, 58, 28, 6), bold: true, color: t.dark ? t.secondary : t.primary, align: 'center', valign: 'middle' });
          s.addText(x.label, { x: tx + 0.3, y: 4.25, w: tw - 0.6, h: 1.4, fontFace: bodyFont, fontSize: fitFont(x.label, 18, 12, 50), color: t.text, align: 'center', valign: 'top' });
        });
        footer(s, n, false);
        break;
      }
      case 'quote': {
        s.background = { color: t.dark ? t.surface : t.primary };
        const fg = t.dark ? t.text : t.onPrimary;
        s.addText('“', { x: 0.8, y: 0.4, w: 3, h: 2.6, fontFace: headFont, fontSize: 200, bold: true, color: t.accent, valign: 'top' });
        const q = sl.quote ?? sl.title;
        s.addText(q, { x: 1.6, y: 2.3, w: 10.2, h: 2.9, fontFace: headFont, italic: true, fontSize: fitFont(q, 34, 20, 120), color: fg, valign: 'middle' });
        if (sl.author) s.addText(`— ${sl.author}`, { x: 1.6, y: 5.4, w: 10.2, h: 0.6, fontFace: bodyFont, fontSize: 18, color: t.accent, bold: true });
        footer(s, n, true);
        break;
      }
      case 'timeline': {
        header(s, sl);
        const steps = sl.steps ?? [];
        const x0 = MX + 0.3;
        const span = CW - 0.6;
        s.addShape(shape.rect, { x: x0, y: 3.2, w: span, h: 0.07, fill: { color: t.secondary }, line: { color: t.secondary, width: 0 } });
        const sw = span / steps.length;
        steps.forEach((st, i) => {
          const cx = x0 + sw * i + sw / 2;
          s.addShape(shape.ellipse, { x: cx - 0.3, y: 2.93, w: 0.6, h: 0.6, fill: { color: t.primary }, line: { color: t.bg, width: 3 } });
          s.addText(String(i + 1), { x: cx - 0.3, y: 2.93, w: 0.6, h: 0.6, fontFace: headFont, fontSize: 16, bold: true, color: t.onPrimary, align: 'center', valign: 'middle' });
          s.addText(st.title, { x: cx - sw / 2 + 0.1, y: 3.75, w: sw - 0.2, h: 0.9, fontFace: headFont, fontSize: fitFont(st.title, 18, 12, 22), bold: true, color: titleColor, align: 'center', valign: 'top' });
          if (st.text) s.addText(st.text, { x: cx - sw / 2 + 0.1, y: 4.7, w: sw - 0.2, h: 1.9, fontFace: bodyFont, fontSize: fitFont(st.text, 14, 10, 60), color: t.text, align: 'center', valign: 'top' });
        });
        footer(s, n, false);
        break;
      }
      case 'table': {
        header(s, sl);
        const tb = sl.table!;
        const size = tb.rows.length > 5 ? 13 : 15;
        const border = { type: 'solid' as const, color: subtle(t), pt: 0.75 };
        const rows: PptxGenJS.TableRow[] = [
          tb.head.map((h) => ({ text: h, options: { bold: true, color: t.onPrimary, fill: { color: t.primary }, fontFace: headFont, fontSize: size + 1, border, valign: 'middle' as const, margin: 0.08 } })),
          ...tb.rows.map((r, ri) =>
            r.map((c) => ({ text: c, options: { color: t.text, fill: { color: ri % 2 ? t.bg : t.surface }, fontFace: bodyFont, fontSize: size, border, valign: 'middle' as const, margin: 0.08 } })),
          ),
        ];
        s.addTable(rows, { x: MX, y: 2.05, w: CW, colW: tb.head.map(() => CW / tb.head.length), rowH: 0.52 });
        footer(s, n, false);
        break;
      }
    }
    addNotes(s, sl);
  });

  const out = await pres.write({ outputType: 'nodebuffer' });
  return out as Uint8Array;
}
