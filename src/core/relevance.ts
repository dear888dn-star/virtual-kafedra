/**
 * Uzun manba matnidan (kitob, konspekt) topshiriqqa eng mos parchalarni tanlaydi.
 * Oddiy kalit so'zlar bo'yicha baholash (TF, kam uchraydigan so'zlar og'irroq); modelsiz, tezkor va bepul.
 */

const STOP = new Set([
  'va', 'bilan', 'uchun', 'bu', 'bir', 'ham', 'yoki', 'lekin', 'deb', 'ta', 'ni', 'ning', 'da', 'dan', 'ga',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'ва', 'для', 'что', 'как', 'это', 'при', 'или',
  'tayyorlang', 'mavzusida', 'mavzu', 'haqida', 'slayd', 'taqdimot', 'matn', 'ma\'ruza', 'textbook', 'monograph', 'lecture', 'notes', 'учебник',
]);

export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}']{4,}/gu) ?? []).map((w) => w.replace(/'/g, '')).filter((w) => !STOP.has(w));
}

/** Matnni ~maxChunk belgili parchalarga (abzats chegarasida) bo'ladi. */
export function chunk(text: string, maxChunk = 1200): string[] {
  const paras = text.split(/\n{2,}|\r\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (p.length > maxChunk) {
      if (cur) out.push(cur);
      cur = '';
      for (let i = 0; i < p.length; i += maxChunk) out.push(p.slice(i, i + maxChunk));
    } else if (cur.length + p.length + 2 > maxChunk) {
      out.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** `limit` belgidan oshmaydigan, `query` ga eng mos parchalar (asl tartibda). Matn kichik bo'lsa o'zi qaytadi. */
export function selectRelevant(text: string, query: string, limit: number): string {
  const t = text.trim();
  if (t.length <= limit) return t;
  const q = tokens(query);
  const chunks = chunk(t);
  if (chunks.length === 0) return t.slice(0, limit);
  const df = new Map<string, number>();
  const chunkTokens = chunks.map((c) => tokens(c));
  for (const toks of chunkTokens) for (const w of new Set(toks)) df.set(w, (df.get(w) ?? 0) + 1);
  const qset = [...new Set(q)];
  const scored = chunks.map((c, i) => {
    const tf = new Map<string, number>();
    for (const w of chunkTokens[i]!) tf.set(w, (tf.get(w) ?? 0) + 1);
    let score = 0;
    for (const w of qset) {
      const f = tf.get(w) ?? 0;
      if (f) score += (1 + Math.log(f)) * Math.log(1 + chunks.length / (df.get(w) ?? 1));
    }
    return { i, c, score };
  });
  const picked: typeof scored = [];
  let used = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (used + s.c.length + 8 > limit) continue;
    if (s.score <= 0 && picked.length > 0) break;
    picked.push(s);
    used += s.c.length + 8;
  }
  if (picked.length === 0) return t.slice(0, limit);
  return picked
    .sort((a, b) => a.i - b.i)
    .map((s) => s.c)
    .join('\n[…]\n');
}
