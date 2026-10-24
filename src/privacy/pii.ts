export type PiiType = 'email' | 'phone' | 'passport' | 'card' | 'pinfl';

export interface PiiFinding {
  type: PiiType;
  count: number;
  /** Niqoblangan namuna (to'liq qiymat hech qachon qaytarilmaydi) */
  sample: string;
}

const mask = (s: string): string => {
  const t = s.trim();
  return t.length <= 4 ? '***' : `${t.slice(0, 2)}***${t.slice(-2)}`;
};

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CARD = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const PINFL = /(?<!\d)\d{14}(?!\d)/g;
const PASSPORT = /(?<![A-Za-z])[A-Z]{2}[ -]?\d{7}(?!\d)/g;
const PHONES = [
  /(?<!\d)(?:\+|00)?998[\s().-]*\d{2}[\s().-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)/g,
  /(?<![\d+])\(?(?:33|50|55|71|77|88|9\d)\)?[\s.-]\d{3}[\s.-]\d{2}[\s.-]\d{2}(?!\d)/g,
  /(?<![\d])\+\d{1,3}[\s().-]*\d{2,4}[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2,4}(?!\d)/g,
];

/**
 * Oddiy regex bilan telefon, email, pasport/ID shaklidagi matnlarni topadi.
 * Bu ishonchli aniqlash emas, faqat foydalanuvchini ogohlantirish uchun: noto'g'ri ijobiy natijalar bo'lishi mumkin.
 */
export function detectPii(text: string): PiiFinding[] {
  const out: PiiFinding[] = [];
  const add = (type: PiiType, matches: string[]) => {
    if (matches.length) out.push({ type, count: matches.length, sample: mask(matches[0]!) });
  };

  add('email', text.match(EMAIL) ?? []);

  let rest = text;
  const cards = (rest.match(CARD) ?? []).filter((m) => luhn(m.replace(/\D/g, '')));
  for (const c of cards) rest = rest.replace(c, ' ');
  add('card', cards);

  add('pinfl', rest.match(PINFL) ?? []);
  add('passport', rest.match(PASSPORT) ?? []);

  // Bir raqamni bir nechta andoza topsa, bir marta sanaymiz (raqamlar bo'yicha)
  const phones = new Map<string, string>();
  for (const re of PHONES) for (const m of rest.match(re) ?? []) phones.set(m.replace(/\D/g, '').replace(/^998/, ''), m.trim());
  add('phone', [...phones.values()]);
  return out;
}

export const PII_LABELS: Record<PiiType, string> = {
  email: 'email manzil',
  phone: 'telefon raqami',
  passport: 'pasport raqami',
  card: 'bank kartasi raqami',
  pinfl: 'JShShIR (PINFL) shaklidagi raqam',
};
