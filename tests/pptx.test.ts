import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { buildPptx, fitFont } from '../src/export/pptx';
import { SlideDeckSchema } from '../src/schemas/slides';
import { deckToMarkdown, type SlideDeck } from '../src/shared/slides';
import { THEME_IDS } from '../src/shared/themes';

const DECK: SlideDeck = {
  title: 'Ekoturizmning iqtisodiy ahamiyati',
  subtitle: 'Iqtisodiyot va turizm kafedrasi',
  theme: 'zumrad',
  slides: [
    { layout: 'title', title: 'Ekoturizmning iqtisodiy ahamiyati', subtitle: '2-kurs ma\'ruzasi' },
    { layout: 'bullets', title: 'Asosiy tushunchalar', bullets: ['Ekoturizm tabiatni asrash bilan bog\'liq', 'Mahalliy aholi daromadini oshiradi', 'Barqaror rivojlanish maqsadlariga xizmat qiladi'], notes: 'Misol keltiring.' },
    { layout: 'bullets', title: 'Uzun ro\'yxat', bullets: ['bir', 'ikki', 'uch', 'to\'rt', 'besh', 'olti'] },
    { layout: 'two_column', title: 'Afzallik va xavf', left_title: 'Afzallik', left: ['Ish o\'rinlari'], right_title: 'Xavf', right: ['Tabiatga yuk'] },
    { layout: 'stats', title: 'Raqamlarda (namuna)', stats: [{ value: '12%', label: "o'sish sur'ati" }, { value: '3 mln', label: 'turist' }, { value: '45', label: 'hudud' }] },
    { layout: 'timeline', title: 'Bosqichlar', steps: [{ title: 'Reja', text: 'Hudud tanlash' }, { title: 'Qurilish' }, { title: 'Ochilish', text: 'Birinchi mehmonlar' }] },
    { layout: 'table', title: 'Taqqoslash', table: { head: ['Ko\'rsatkich', 'A', 'B'], rows: [['Narx', '1', '2'], ['Sifat', 'yuqori', 'o\'rta']] } },
    { layout: 'quote', title: 'Fikr', quote: 'Tabiat — eng katta boylik.', author: 'Maqol' },
    { layout: 'section', title: 'Amaliy qism', subtitle: 'Misollar' },
    { layout: 'closing', title: 'Rahmat!', bullets: ['Savollar?'] },
  ],
};

test('pptx: to\'g\'ri zip, slaydlar soni, izohlar va matn', async () => {
  const buf = await buildPptx(DECK, { footerLabel: 'Iqtisodiyot va turizm kafedrasi' });
  assert.equal(buf[0], 0x50); // "PK"
  assert.equal(buf[1], 0x4b);
  const files = unzipSync(buf);
  const slides = Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  assert.equal(slides.length, DECK.slides.length);
  const xml = strFromU8(files['ppt/slides/slide2.xml']!);
  assert.match(xml, /Asosiy tushunchalar/);
  assert.match(xml, /Mahalliy aholi daromadini oshiradi/);
  assert.ok(Object.keys(files).some((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)), 'spiker izohlari bo\'lishi kerak');
  assert.match(strFromU8(files['ppt/slides/slide7.xml']!), /<a:tbl>/);
});

test('pptx: hamma mavzu (jumladan qorong\'i) bilan yasaladi, rang HEX qiymatlari mavzudan olinadi', async () => {
  for (const theme of THEME_IDS) {
    const buf = await buildPptx(DECK, { theme });
    const files = unzipSync(buf);
    assert.equal(Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length, DECK.slides.length, theme);
  }
  const grafit = strFromU8(unzipSync(await buildPptx(DECK, { theme: 'grafit' }))['ppt/slides/slide2.xml']!);
  assert.match(grafit, /111827/); // qorong'i fon
  const okean = strFromU8(unzipSync(await buildPptx(DECK, { theme: 'okean' }))['ppt/slides/slide2.xml']!);
  assert.match(okean, /F6F9FC/);
});

test('pptx: maxsus belgilar va juda uzun matn buzmaydi', async () => {
  const deck: SlideDeck = {
    title: 'A & B <test> "tirnoq"',
    slides: [
      { layout: 'title', title: 'X'.repeat(120) },
      { layout: 'bullets', title: 'Uzun', bullets: ['Y'.repeat(200), 'Z & <b>xavfli</b> \u0000 matn'] },
      { layout: 'closing', title: 'Oxiri' },
    ],
  };
  const files = unzipSync(await buildPptx(deck));
  const xml = strFromU8(files['ppt/slides/slide2.xml']!);
  assert.ok(!xml.includes('<b>xavfli</b>'), 'xom HTML XML ga tushmasligi kerak');
  assert.match(xml, /&lt;b&gt;xavfli/);
});

test('fitFont: matn uzun bo\'lsa shrift kichrayadi, minimumdan pastga tushmaydi', () => {
  assert.equal(fitFont('qisqa', 30, 14, 40), 30);
  assert.ok(fitFont('x'.repeat(160), 30, 14, 40) < 30);
  assert.equal(fitFont('x'.repeat(5000), 30, 14, 40), 14);
});

test('slayd sxemasi: noto\'g\'ri tuzilma aniq xato bilan rad etiladi', () => {
  assert.equal(SlideDeckSchema.safeParse(DECK).success, true);
  const noTitle = { ...DECK, slides: DECK.slides.slice(1) };
  assert.match(JSON.stringify(SlideDeckSchema.safeParse(noTitle).error?.issues), /birinchi slayd/);
  const bad = { ...DECK, slides: [DECK.slides[0], { layout: 'stats', title: 'Bo\'sh' }, DECK.slides[9]] };
  assert.match(JSON.stringify(SlideDeckSchema.safeParse(bad).error?.issues), /stats/);
  const badTable = { ...DECK, slides: [DECK.slides[0], { layout: 'table', title: 'J', table: { head: ['a', 'b'], rows: [['1']] } }, DECK.slides[9]] };
  assert.match(JSON.stringify(SlideDeckSchema.safeParse(badTable).error?.issues), /ustunlar soni/);
  // layout ko'rsatilmasa "bullets" deb olinadi
  const lax = SlideDeckSchema.safeParse({ ...DECK, slides: [DECK.slides[0], { title: 'Maket yo\'q', bullets: ['a', 'b'] }, DECK.slides[9]] });
  assert.equal(lax.success && lax.data.slides[1]?.layout, 'bullets');
});

test('deckToMarkdown: uslubchi o\'qiydigan matnda slaydlar sanaladi', () => {
  const md = deckToMarkdown(DECK);
  assert.equal((md.match(/^## Slayd \d+:/gm) ?? []).length, DECK.slides.length);
  assert.match(md, /Spiker uchun izoh/);
  assert.match(md, /\*\*12%\*\*/);
});
