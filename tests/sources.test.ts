import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/core/config';
import { EventBus } from '../src/core/events';
import { Orchestrator } from '../src/core/orchestrator';
import { chunk, selectRelevant } from '../src/core/relevance';
import { searchSources, similarTitle } from '../src/core/sources';
import { Router } from '../src/providers/router';
import type { CompleteRequest, Provider } from '../src/providers/types';
import { UsageStore } from '../src/providers/usage';
import { RunRequest } from '../src/schemas';
import { bookKey, formatBook, formatBooks, type Book } from '../src/shared/sources';

// ---------- relevance ----------

test('relevance: kichik matn o\'zgarishsiz, uzun matndan mos parchalar tanlanadi va chegaradan oshmaydi', () => {
  assert.equal(selectRelevant('qisqa matn', 'talab', 1000), 'qisqa matn');
  const filler = Array.from({ length: 40 }, (_, i) => `Bu ${i}-abzats: umumiy mavzusiz ma'lumot, boshqa narsa haqida uzoq matn. `.repeat(8)).join('\n\n');
  const key = "Mehmonxona xonalarining band bo'lish darajasi (occupancy) hisoblash formulasi: band xonalar bo'linadi mavjud xonalarga.";
  const text = `${filler}\n\n${key}\n\n${filler}`;
  const out = selectRelevant(text, "mehmonxona band bo'lish darajasi formulasi", 3000);
  assert.ok(out.length <= 3000, `uzunlik ${out.length}`);
  assert.ok(out.includes('occupancy'), 'mos parcha tanlanishi kerak');
  assert.ok(chunk(text).length > 5);
});

// ---------- kitob yordamchilari ----------

test('formatBook va bookKey', () => {
  const b: Book = { title: 'Tourism Economics', authors: ['Alvaro Matias'], year: '2011', publisher: 'Springer', isbn: '123' };
  assert.equal(formatBook(b), 'Alvaro Matias. Tourism Economics (2011). Springer. ISBN 123.');
  assert.equal(formatBooks([b, { title: 'X kitob' }]).split('\n').length, 2);
  assert.equal(bookKey({ title: 'Tourism  Economics!', authors: ['Dr. Alvaro Matias'] }), bookKey({ title: 'tourism economics', authors: ['Matias'] }));
  assert.ok(similarTitle('Tourism Economics and Policy', 'Tourism economics & policy'));
  assert.ok(!similarTitle('Tourism Economics', 'Cooking for beginners'));
});

// ---------- qidiruv ----------

function fakeFetch(opts: { olFail?: boolean; gb429?: boolean } = {}): { fn: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const u = new URL(url);
    if (u.hostname === 'openlibrary.org') {
      if (opts.olFail) throw new Error('tarmoq yo\'q');
      const title = u.searchParams.get('title');
      const q = u.searchParams.get('q');
      const docs =
        title === 'Tourism Economics and Policy'
          ? [{ key: '/works/OL1W', title: 'Tourism economics and policy', author_name: ['Larry Dwyer'], first_publish_year: 2010, language: ['eng'] }]
          : title
            ? [] // o'ylab topilgan kitob katalogda yo'q
            : [
                { key: '/works/OL2W', title: q === 'hospitality management' ? 'Hospitality management' : 'Tourism economics and hospitality', author_name: ['Tim Knowles'], first_publish_year: 1994, language: ['eng'] },
                { key: '/works/OL1W', title: 'Tourism economics and policy', author_name: ['Larry Dwyer'], first_publish_year: 2010, language: ['eng'] },
              ];
      return new Response(JSON.stringify({ docs }), { status: 200 });
    }
    if (opts.gb429) return new Response('{"error":{"code":429}}', { status: 429 });
    return new Response(JSON.stringify({ items: [{ volumeInfo: { title: 'Tourism Economics and Policy', authors: ['Larry Dwyer'], publishedDate: '2010-01-01', description: 'Annotatsiya matni', infoLink: 'https://books.google.com/x' } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, urls };
}

const LLM_OK = async () =>
  JSON.stringify({
    queries: ['tourism economics', 'hospitality management'],
    known_books: [
      { title: 'Tourism Economics and Policy', author: 'Larry Dwyer' },
      { title: 'Mavjud emas kitob nomi uydirma', author: 'Hech kim' },
    ],
  });

test('qidiruv: tavsiya qilingan kitob katalogda tasdiqlanadi, uydirma nomlar tushmaydi, dublikatlar birlashadi', async () => {
  const { fn, urls } = fakeFetch();
  const r = await searchSources('Turizm iqtisodiyoti', LLM_OK, fn);
  const titles = r.books.map((b) => b.title);
  assert.ok(!titles.some((t) => /uydirma/i.test(t)), "katalogda yo'q kitob ro'yxatga tushmasligi kerak");
  const dwyer = r.books.filter((b) => /Tourism economics and policy/i.test(b.title));
  assert.equal(dwyer.length, 1, 'bir xil kitob bir marta');
  assert.equal(dwyer[0]!.recommended, true);
  assert.equal(r.books[0]!.recommended, true, 'tavsiya qilingan kitob birinchi');
  assert.equal(dwyer[0]!.summary, 'Annotatsiya matni', "Google Books annotatsiyasi qo'shiladi");
  assert.ok(r.books.every((b) => b.verified));
  assert.deepEqual(r.queries, ['tourism economics', 'hospitality management']);
  assert.ok(urls.some((u) => u.includes('openlibrary.org')));
});

test("qidiruv: model ishlamasa mavzu so'zlari bilan qidiriladi; Google Books 429 bersa e'tiborsiz", async () => {
  const { fn } = fakeFetch({ gb429: true });
  const r = await searchSources('tourism economics textbook', async () => 'bu JSON emas', fn);
  assert.ok(r.books.length >= 1);
  assert.ok(r.notes.some((n) => /tuza olmadi/.test(n)));
  const r2 = await searchSources('tourism economics textbook', null, fn);
  assert.ok(r2.notes.some((n) => /Model ishlamayapti/.test(n)));
});

test("qidiruv: katalogga ulanib bo'lmasa aniq izoh, xato tashlamaydi", async () => {
  const { fn } = fakeFetch({ olFail: true, gb429: true });
  const r = await searchSources('tourism economics', LLM_OK, fn);
  assert.equal(r.books.length, 0);
  assert.ok(r.notes.some((n) => /ulanib bo'lmadi/.test(n)));
});

// ---------- ish jarayonida manba ----------

function scripted() {
  const reqs: CompleteRequest[] = [];
  const provider: Provider = {
    id: 'fake',
    async complete(req) {
      reqs.push(req);
      const msg = req.messages[0]!.content;
      let text: string;
      if (/Reja tuz/.test(msg)) {
        text = JSON.stringify({ tasks: [{ id: 'T1', assignee: 't2', title: 'Test', instructions: '3 ta test savoli', deliverable_type: 'test', depends_on: [], acceptance_criteria: [] }] });
      } else if (req.json && /Sen universitet kutubxonachisisan/.test(req.system)) {
        text = JSON.stringify({ queries: ['tourism'], known_books: [] });
      } else if (req.json) {
        text = '{"verdict":"approve","score":9,"issues":[]}';
      } else {
        text = [1, 2, 3].map((i) => `### ${i}. Savol ${i}?\n- A) bir\n- B) ikki\n- C) uch\n- D) to'rt\n\n**To'g'ri javob:** B\n**Izoh:** sabab shu.\n`).join('\n');
      }
      return { text, usage: { inputTokens: 1, outputTokens: 1 }, provider: 'fake', model: 'm' };
    },
  };
  return { provider, reqs };
}

function orch(provider: Provider) {
  const bus = new EventBus();
  const chain = [{ provider }];
  const router = new Router({ chains: { mudir: chain, uslubchi: chain, oqituvchi: chain }, bus, usage: new UsageStore(null), sleep: async () => {} });
  return { o: new Orchestrator(loadConfig(), bus, router, { runsDir: mkdtempSync(join(tmpdir(), 'kafedra-')) }), bus };
}

const BOOKS: Book[] = [
  { title: 'Tourism Economics and Policy', authors: ['Larry Dwyer'], year: '2010', publisher: 'Channel View', origin: 'openlibrary', verified: true, url: 'https://openlibrary.org/works/OL1W' },
];

test("tanlangan kitoblar: reja, o'qituvchi va uslubchi so'rovlariga beriladi, yakuniy hujjatda manbalar ro'yxati bor", async () => {
  const { provider, reqs } = scripted();
  const { o } = orch(provider);
  const req = RunRequest.parse({ task: 'Turizm iqtisodiyoti bo\'yicha test', source_mode: 'books', books: BOOKS });
  o.start(req);
  await o.done;
  assert.equal(o.status, 'finished');
  const withBooks = reqs.filter((r) => /^<manba_kitoblar>$/m.test(r.messages[0]!.content));
  assert.equal(withBooks.length, reqs.length, 'hamma so\'rovda kitoblar bo\'lishi kerak (reja, yozish, tekshiruv)');
  assert.match(reqs[0]!.messages[0]!.content, /Larry Dwyer\. Tourism Economics and Policy \(2010\)/);
  const work = reqs.find((r) => /Vazifa: Test/.test(r.messages[0]!.content) && !r.json)!;
  assert.match(work.messages[0]!.content, /FAQAT <manba_kitoblar>/);
  const review = reqs.find((r) => r.json && /tekshiriladigan_matn/.test(r.messages[0]!.content))!;
  assert.match(review.messages[0]!.content, /kitoblarga mosmi/);
  const final = o.getSnapshot().final ?? '';
  assert.match(final, /### Foydalanilgan manbalar/);
  assert.match(final, /Tourism Economics and Policy/);
  assert.match(final, /to'liq matni berilmagan/);
});

test('"Manba kerak emas": kitob bloki yo\'q, qoida va yakuniy hujjatda izoh bor', async () => {
  const { provider, reqs } = scripted();
  const { o } = orch(provider);
  o.start(RunRequest.parse({ task: 'Oddiy topshiriq', source_mode: 'none' }));
  await o.done;
  assert.ok(reqs.every((r) => !/^<manba_kitoblar>$/m.test(r.messages[0]!.content)));
  assert.ok(reqs.some((r) => /Manba talab qilinmaydi/.test(r.messages[0]!.content)));
  assert.match(o.getSnapshot().final ?? '', /manba talab qilinmagan/);
});

test("kitob matni (material) bilan: mos parchalar so'rovga qo'shiladi, 'matn berilmagan' eslatmasi chiqmaydi", async () => {
  const { provider, reqs } = scripted();
  const { o } = orch(provider);
  const filler = Array.from({ length: 80 }, (_, i) => `${i}-bo'lim: boshqa mavzudagi uzun va befoyda matn. `.repeat(10)).join('\n\n');
  const material = `${filler}\n\nTest savollari uchun asosiy ta'rif: talab elastikligi narx o'zgarganda talab hajmi o'zgarishini ko'rsatadi.\n\n${filler}`;
  o.start(RunRequest.parse({ task: 'Talab elastikligi bo\'yicha test', source_mode: 'books', books: BOOKS, material }));
  await o.done;
  const work = reqs.find((r) => /Vazifa: Test/.test(r.messages[0]!.content) && !r.json)!;
  assert.match(work.messages[0]!.content, /talab elastikligi narx o'zgarganda/);
  assert.ok(work.messages[0]!.content.length < 14000, "butun kitob emas, faqat mos parchalar");
  assert.doesNotMatch(o.getSnapshot().final ?? '', /to'liq matni berilmagan/);
  assert.match(o.getSnapshot().final ?? '', /Foydalanuvchi bergan matn/);
});

test("suggestSources: bitta model so'rovi, ofisda mudir holati; run boshlanmaydi", async () => {
  const { provider, reqs } = scripted();
  const { o, bus } = orch(provider);
  const { fn } = fakeFetch({ gb429: true });
  const r = await o.suggestSources('Turizm iqtisodiyoti', fn);
  assert.equal(reqs.length, 1);
  assert.equal(o.status, 'idle');
  assert.ok(r.books.length >= 1);
  assert.ok(bus.all().some((e) => e.agent === 'mudir' && e.state === 'thinking'));
});

test('so\'rov sxemasi: kitoblar tekshiriladi (url faqat http(s), son yil matnga aylanadi)', () => {
  const ok = RunRequest.safeParse({ task: 'abc', books: [{ title: 'Kitob', year: 2020, url: 'https://x.org/a' }] });
  assert.equal(ok.success && ok.data.books?.[0]?.year, '2020');
  assert.equal(RunRequest.safeParse({ task: 'abc', books: [{ title: 'Kitob', url: 'javascript:alert(1)' }] }).success, false);
  assert.equal(RunRequest.safeParse({ task: 'abc', books: Array.from({ length: 9 }, () => ({ title: 'Kitob' })) }).success, false);
});

// ---------- PDF ----------

import { PdfError, extractPdfText } from '../src/core/pdf';

function makePdf(lines: string[]): Uint8Array {
  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  const stream = `BT /F1 14 Tf 50 740 Td 18 TL ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

test('PDF kitob: matn qatlami o\'qiladi, uzun bo\'lsa qirqiladi', async () => {
  const pdf = makePdf(['Talab elastikligi nima?', 'Narx oshsa talab kamayadi, bu talab qonunidir.']);
  const r = await extractPdfText(pdf, 100000);
  assert.equal(r.pages, 1);
  assert.match(r.text, /Talab elastikligi nima\?\nNarx oshsa talab kamayadi/);
  assert.equal(r.truncated, false);
  const cut = await extractPdfText(pdf, 30);
  assert.equal(cut.truncated, true);
  assert.equal(cut.text.length, 30);
});

test('PDF: noto\'g\'ri fayl va matnsiz (skaner) PDF aniq xato bilan rad etiladi', async () => {
  await assert.rejects(extractPdfText(new TextEncoder().encode('bu pdf emas'), 1000), (e: Error) => e instanceof PdfError && /PDF fayl emas/.test(e.message));
  await assert.rejects(extractPdfText(makePdf([]), 1000), (e: Error) => e instanceof PdfError && /matn qatlami/.test(e.message));
});

test("katalog ma'lumotlari uzun bo'lsa so'rov rad etilmaydi, qirqiladi", () => {
  const long = 'x'.repeat(400);
  const r = RunRequest.safeParse({
    task: 'abc',
    source_mode: 'books',
    books: [{ title: 'Kitob', authors: [long, 'B'], subjects: [long, long], languages: ['eng', 'rus', 'uzb'], publisher: long, summary: long.repeat(10) }],
  });
  assert.equal(r.success, true);
  if (r.success) {
    const b = r.data.books![0]!;
    assert.equal(b.authors![0]!.length, 80);
    assert.equal(b.subjects![0]!.length, 60);
    assert.equal(b.publisher!.length, 120);
    assert.equal(b.summary!.length, 1200);
  }
});
