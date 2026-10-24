import type { ThemeId } from './themes';

// Taqdimot spetsifikatsiyasi: slaydchi JSON qaytaradi, undan .pptx va brauzer ko'rinishi yasaladi.

export const LAYOUTS = ['title', 'section', 'bullets', 'two_column', 'stats', 'quote', 'timeline', 'table', 'closing'] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface Slide {
  layout: Layout;
  title: string;
  subtitle?: string;
  bullets?: string[];
  left_title?: string;
  right_title?: string;
  left?: string[];
  right?: string[];
  stats?: { value: string; label: string }[];
  quote?: string;
  author?: string;
  steps?: { title: string; text?: string }[];
  table?: { head: string[]; rows: string[][] };
  /** Spiker uchun izoh (slayd ostidagi eslatma) */
  notes?: string;
  /** Slaydga mos tasvir g'oyasi (matn bilan; rasm avtomatik qo'yilmaydi) */
  visual?: string;
}

export interface SlideDeck {
  title: string;
  subtitle?: string;
  theme?: ThemeId;
  slides: Slide[];
}

/** Taqdimotni oddiy Markdown'ga aylantiradi: uslubchi o'qishi va "Matn ko'rinishi" uchun. */
export function deckToMarkdown(deck: SlideDeck): string {
  const out: string[] = [`# ${deck.title}`, ''];
  if (deck.subtitle) out.push(`*${deck.subtitle}*`, '');
  deck.slides.forEach((s, i) => {
    out.push(`## Slayd ${i + 1}: ${s.title}`, `*Maket: ${s.layout}*`, '');
    if (s.subtitle) out.push(s.subtitle, '');
    for (const b of s.bullets ?? []) out.push(`- ${b}`);
    if (s.left?.length) out.push(`**${s.left_title ?? 'Chap'}**`, ...s.left.map((b) => `- ${b}`));
    if (s.right?.length) out.push(`**${s.right_title ?? "O'ng"}**`, ...s.right.map((b) => `- ${b}`));
    for (const st of s.stats ?? []) out.push(`- **${st.value}** — ${st.label}`);
    if (s.quote) out.push(`> ${s.quote}`, s.author ? `> — ${s.author}` : '');
    (s.steps ?? []).forEach((st, k) => out.push(`${k + 1}. **${st.title}**${st.text ? `: ${st.text}` : ''}`));
    if (s.table) {
      out.push(`| ${s.table.head.join(' | ')} |`, `|${s.table.head.map(() => '---').join('|')}|`);
      for (const r of s.table.rows) out.push(`| ${r.join(' | ')} |`);
    }
    if (s.visual) out.push('', `*Tasvir g'oyasi: ${s.visual}*`);
    if (s.notes) out.push('', `**Spiker uchun izoh:** ${s.notes}`);
    out.push('');
  });
  return out.join('\n');
}
