import { RateLimitError, type CompleteRequest, type CompleteResult, type Provider } from './types';

export interface MockOptions {
  /** Kechikish ko'paytirgichi: 1 = oddiy, 0 = kutishsiz */
  speed: number;
  /** Har n-chaqiruvda sun'iy 429 (0 = hech qachon). Barcha mock nusxalar uchun umumiy hisoblagich. */
  rateLimitEvery: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function topicOf(req: CompleteRequest): string {
  const first = req.messages[0]?.content ?? '';
  const m = first.match(/<topshiriq>\s*([^\n<]+)/) ?? first.match(/Mavzu:\s*(.+)/);
  const line = (m?.[1] ?? first).split('\n')[0] ?? '';
  return line.trim().slice(0, 100) || 'berilgan mavzu';
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function lecture(t: string): string {
  return `# Ma'ruza: ${t}

## 1. Kirish
Mazkur ma'ruzada "${t}" mavzusining asosiy tushunchalari va amaliy ahamiyati ko'rib chiqiladi. *(Namunaviy mock matn.)*

## 2. Asosiy tushunchalar
- **Talab va taklif** — bozor muvozanatini belgilovchi asosiy kuchlar.
- **Xarajat va daromad** — korxona va turizm xizmatlari faoliyatining iqtisodiy asosi.
- **Samaradorlik** — resurslardan oqilona foydalanish ko'rsatkichi.

## 3. Amaliy misol
Mehmonxona xizmatlariga bo'lgan talab mavsumga qarab o'zgaradi. Yozgi mavsumda band xonalar ulushi yuqori bo'ladi. Aniq ko'rsatkichlar: [MANBA KERAK].

## 4. Xulosa
Mavzuni o'zlashtirish uchun nazariy bilimni amaliy misollar bilan mustahkamlash lozim.
`;
}

function test(t: string): string {
  const q = (n: number) => `### ${n}-savol
"${t}" mavzusiga oid ${n}-namunaviy savol?

- A) Birinchi variant
- B) Ikkinchi variant
- C) Uchinchi variant
- D) To'rtinchi variant

**To'g'ri javob:** ${'ABCD'[n % 4]}
**Izoh:** Bu namunaviy mock izoh.
`;
  return `# Test savollari: ${t}\n\n${[1, 2, 3, 4, 5].map(q).join('\n')}`;
}

function practice(t: string): string {
  return `# Amaliy mashqlar: ${t}

## 1-masala
Mehmonxonada 40 ta xona bor, o'rtacha band bo'lish darajasi 65%. Bir kunda nechta xona band bo'ladi?

**Yechim:** 40 × 0,65 = 26 ta xona.

## 2-masala
Turistik xizmat narxi 120 birlik, o'zgaruvchan xarajat 70 birlik. Bir birlikdagi marjinal foydani toping.

**Yechim:** 120 − 70 = 50 birlik.

## 3-masala
"${t}" mavzusi bo'yicha qisqa keys tahlilini yozing (150 so'z).
`;
}

function slides(t: string): string {
  const s = (n: number, title: string) =>
    `## Slayd ${n}: ${title}\n- Birinchi muhim band\n- Ikkinchi muhim band\n- Uchinchi muhim band\n`;
  return `# Slaydlar: ${t}\n\n${s(1, 'Mavzu va maqsad')}\n${s(2, 'Asosiy tushunchalar')}\n${s(3, 'Misollar')}\n${s(4, 'Amaliy qo\'llanish')}\n${s(5, 'Xulosa')}`;
}

function glossary(t: string): string {
  return `# Glossariy: ${t}

| O'zbekcha | Русский | English |
|---|---|---|
| Talab | Спрос | Demand |
| Taklif | Предложение | Supply |
| Daromad | Доход | Revenue |
| Turizm xizmati | Туристическая услуга | Tourism service |
| Mavsumiylik | Сезонность | Seasonality |
`;
}

const WRITERS: Record<string, (t: string) => string> = { lecture, test, practice, slides, glossary };

export class MockProvider implements Provider {
  private static calls = 0;
  private static burst = 0;
  private sleep: (ms: number) => Promise<void>;

  constructor(
    readonly id: string,
    private opts: MockOptions,
  ) {
    this.sleep = opts.sleep ?? realSleep;
  }

  /** Testlar uchun umumiy hisoblagichni nolga qaytaradi. */
  static resetCounter(): void {
    MockProvider.calls = 0;
    MockProvider.burst = 0;
  }

  private async delay(minMs: number, maxMs: number, seed: number): Promise<void> {
    if (this.opts.speed <= 0) return;
    const ms = (minMs + (seed % (maxMs - minMs + 1))) * this.opts.speed;
    await this.sleep(ms);
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const meta = req.meta;
    const topic = topicOf(req);
    const seed = hash(`${topic}|${meta?.agentId}|${meta?.attempt ?? 0}`);

    MockProvider.calls++;
    const n = this.opts.rateLimitEvery;
    if (this.id === 'mock') {
      // Har n-chaqiruvda 3 ta ketma-ket 429: qayta urinishlar tugab, mock-b ga o'tiladi
      if (n > 0 && MockProvider.calls % n === 0) MockProvider.burst = 3;
      if (MockProvider.burst > 0) {
        MockProvider.burst--;
        throw new RateLimitError("Mock: sun'ni 429 (limit)", 1500);
      }
    }

    let text: string;
    switch (meta?.purpose) {
      case 'plan': {
        await this.delay(900, 1800, seed);
        const teachers = meta.roster ?? [];
        const lectureTask = teachers.find((r) => r.deliverable_type === 'lecture');
        const tasks = teachers.map((r, i) => ({
          id: `T${i + 1}`,
          assignee: r.id,
          title: `${r.title}: ${topic}`,
          instructions: `"${topic}" mavzusi bo'yicha ${r.title.toLowerCase()} vazifasini bajaring.`,
          deliverable_type: r.deliverable_type,
          depends_on:
            lectureTask && r.id !== lectureTask.id && ['slides', 'glossary'].includes(r.deliverable_type)
              ? [`T${teachers.indexOf(lectureTask) + 1}`]
              : [],
          acceptance_criteria: ['Mavzuga mos', 'Til toza', 'Format to\'g\'ri'],
        }));
        text = JSON.stringify({ tasks });
        break;
      }
      case 'work': {
        await this.delay(1400, 3200, seed);
        const write = WRITERS[meta.deliverableType ?? 'lecture'] ?? lecture;
        const revised = (meta.attempt ?? 0) > 0 ? '\n\n> Uslubchi izohlari hisobga olindi (qayta ishlangan variant).\n' : '';
        text = write(topic) + revised;
        break;
      }
      case 'review': {
        await this.delay(700, 1500, seed);
        const needsRevision = (meta.attempt ?? 0) === 0 && hash(meta.taskTitle ?? '') % 3 === 0;
        text = JSON.stringify(
          needsRevision
            ? {
                verdict: 'revise',
                score: 6,
                issues: [
                  {
                    place: '2-bo\'lim',
                    problem: 'Misollar yetarli emas, bir joyda takror bor.',
                    fix: 'Bitta aniq misol qo\'shing va takroriy jumlani olib tashlang.',
                  },
                ],
              }
            : { verdict: 'approve', score: 8 + (seed % 2), issues: [] },
        );
        break;
      }
      case 'assemble': {
        await this.delay(900, 1600, seed);
        text = `Kafedra "${topic}" mavzusi bo'yicha barcha materiallarni tayyorladi: ma'ruza, test, mashqlar, slaydlar va glossariy. [MANBA KERAK] belgilari qo'yilgan joylarni ishlatishdan oldin manba bilan tekshiring.`;
        break;
      }
      default:
        await this.delay(300, 600, seed);
        text = 'Mock javob.';
    }

    return {
      text,
      usage: { inputTokens: Math.ceil(req.system.length / 4), outputTokens: Math.ceil(text.length / 4) },
      provider: this.id,
      model: 'mock-1',
    };
  }
}
