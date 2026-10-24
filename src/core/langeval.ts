/** Til sifatini qo'lda baholash uchun namunalar va hisobot. Avtomatik baholash yo'q: hisobotni inson o'qiydi. */

export const LANG_SAMPLES: { id: string; prompt: string }[] = [
  { id: 'S1', prompt: "\"Talab elastikligi\" tushunchasini turizm xizmatlari misolida 5–6 jumlada o'zbek tilida (lotin) tushuntiring." },
  { id: 'S2', prompt: "Mehmonxona xonalarining band bo'lish darajasi (occupancy rate) nima va u qanday hisoblanadi? Qisqa formula va bitta sonli misol bilan o'zbekcha yozing." },
  { id: 'S3', prompt: "\"Ekoturizm\" mavzusida bakalavr talabalari uchun 3 ta test savoli tuzing (har birida 4 ta variant, to'g'ri javob va izoh). O'zbek tilida." },
  { id: 'S4', prompt: "Quyidagi atamalarni o'zbek tilidan ruscha va inglizchaga tarjima qiling (jadval): taklif, daromad, mavsumiylik, turistik oqim, raqobatbardoshlik." },
  { id: 'S5', prompt: "Quyidagi gapni uslubiy jihatdan tahrir qiling va 2 ta xatosini ko'rsating: \"Turizm sohasi iqtisodiyotimizni rivojlanishida muhim rol o'ynaydi va yangi ish o'rinlarini yaratilishiga sabab bo'ladi.\"" },
];

export interface LangResult {
  provider: string;
  model: string;
  sample: string;
  answer: string | null;
  error: string | null;
  ms: number;
}

export function renderLangReport(results: LangResult[], skipped: string[], date: string): string {
  const lines: string[] = [
    '# Til sifati hisoboti',
    '',
    `Sana: ${date}. Baholashni o'zingiz qiling: skript hech narsani avtomatik baholamaydi.`,
    '',
  ];
  if (skipped.length) {
    lines.push('## O\'tkazib yuborilgan provayderlar', '', ...skipped.map((s) => `- ${s}`), '');
  }
  if (!results.length) lines.push("Hech bir provayder ishga tushmadi. Kalit va modelni `config/providers.yaml` va `.env` da to'ldiring.", '');
  const byKey = new Map<string, LangResult[]>();
  for (const r of results) byKey.set(`${r.provider} / ${r.model}`, [...(byKey.get(`${r.provider} / ${r.model}`) ?? []), r]);

  if (byKey.size) {
    lines.push('## Qisqacha', '', '| Provayder / model | Muvaffaqiyatli | O\'rtacha kechikish |', '|---|---|---|');
    for (const [k, rs] of byKey) {
      const ok = rs.filter((r) => r.answer !== null);
      const avg = ok.length ? Math.round(ok.reduce((n, r) => n + r.ms, 0) / ok.length) : 0;
      lines.push(`| ${k} | ${ok.length}/${rs.length} | ${ok.length ? `${avg} ms` : '-'} |`);
    }
    lines.push('');
  }
  for (const [k, rs] of byKey) {
    lines.push(`## ${k}`, '');
    for (const r of rs) {
      const sample = LANG_SAMPLES.find((s) => s.id === r.sample);
      lines.push(`### ${r.sample} (${r.ms} ms)`, '', `**So'rov:** ${sample?.prompt ?? ''}`, '');
      if (r.answer !== null) lines.push(...r.answer.split('\n').map((l) => `> ${l}`), '');
      else lines.push(`**Xato:** ${r.error ?? 'noma\'lum'}`, '');
      lines.push('**Sizning bahoyingiz (til tozaligi 1–5):** ', '');
    }
  }
  return lines.join('\n');
}
