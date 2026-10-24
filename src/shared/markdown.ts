// Xavfsiz Markdown: matnni HTML'ga emas, daraxtga aylantiradi. Brauzer uni createElement/textContent
// bilan quradi, shuning uchun model chiqishidagi HTML hech qachon bajarilmaydi.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'code'; v: string; lang: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'hr' }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

/** Faqat http(s) havolalariga ruxsat (javascript:, data: va h.k. rad etiladi). */
export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^https?:\/\/[^\s<>"']+$/i.test(h) ? h : null;
}

const INLINE_RE = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|\*([^*\s][^*\n]*?)\*|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ t: 'text', v: src.slice(last, idx) });
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] });
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ t: 'strong', c: parseInline((m[2] ?? m[3])!) });
    else if (m[4] !== undefined || m[5] !== undefined) out.push({ t: 'em', c: parseInline((m[4] ?? m[5])!) });
    else {
      const href = safeHref(m[7]!);
      out.push(href ? { t: 'link', href, c: parseInline(m[6]!) } : { t: 'text', v: m[0] });
    }
    last = idx + m[0].length;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}

const FENCE = /^\s*```\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const splitRow = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const startsBlock = (l: string, next?: string) =>
    FENCE.test(l) || HEADING.test(l) || HR.test(l) || LIST.test(l) || /^\s*>/.test(l) || (l.includes('|') && next !== undefined && TABLE_SEP.test(next));

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++; // yopuvchi ```
      blocks.push({ t: 'code', v: body.join('\n'), lang: fence[1] ?? '' });
      continue;
    }
    const hd = HEADING.exec(line);
    if (hd) {
      blocks.push({ t: 'h', level: hd[1]!.length, c: parseInline(hd[2]!) });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }
    if (line.includes('|') && lines[i + 1] !== undefined && TABLE_SEP.test(lines[i + 1]!)) {
      const head = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(splitRow(lines[i++]!).map(parseInline));
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      blocks.push({ t: 'quote', c: parseMarkdown(q.join('\n')) });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]!);
        if (m && /^\s*\d/.test(lines[i]!) === ordered) {
          items.push(m[2]!);
          i++;
        } else if (lines[i]!.trim() && /^\s{2,}\S/.test(lines[i]!) && items.length) {
          items[items.length - 1] += ' ' + lines[i]!.trim();
          i++;
        } else break;
      }
      blocks.push({ t: 'list', ordered, items: items.map(parseInline) });
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!, lines[i + 1])) para.push(lines[i++]!);
    blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
  }
  return blocks;
}
