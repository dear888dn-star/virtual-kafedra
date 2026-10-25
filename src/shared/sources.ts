// Manba kitoblari: server (qidiruv, so'rovlar) va brauzer (tanlash) uchun umumiy.

export interface Book {
  title: string;
  authors?: string[];
  year?: string;
  publisher?: string;
  isbn?: string;
  url?: string;
  languages?: string[];
  subjects?: string[];
  /** Qisqa tavsif yoki annotatsiya (topilsa) */
  summary?: string;
  /** Foydalanuvchi o'zi kiritgan yoki qidiruv xizmatidan topilgan */
  origin?: 'user' | 'openlibrary' | 'googlebooks';
  /** Kitob haqiqatan mavjudligi katalogda tasdiqlangan (qidiruv natijasi) */
  verified?: boolean;
  /** Model tavsiyasi bo'yicha topilgan kitob (ishonchli deb baholangan) */
  recommended?: boolean;
}

export type SourceMode = 'books' | 'none';

/** "Muallif. Nomi (yil). Nashriyot. ISBN" ko'rinishidagi bir qator. */
export function formatBook(b: Book): string {
  const parts = [
    b.authors?.length ? `${b.authors.join(', ')}.` : '',
    `${b.title}${b.year ? ` (${b.year})` : ''}.`,
    b.publisher ? `${b.publisher}.` : '',
    b.isbn ? `ISBN ${b.isbn}.` : '',
  ];
  return parts.filter(Boolean).join(' ').replace(/\.\./g, '.');
}

export function formatBooks(books: Book[]): string {
  return books.map((b, i) => `${i + 1}. ${formatBook(b)}`).join('\n');
}

/** Dublikatlarni aniqlash kaliti: nom + birinchi muallif familiyasi */
export function bookKey(b: Book): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const last = norm(b.authors?.[0] ?? '').split(' ').pop() ?? '';
  return `${norm(b.title)}|${last}`;
}
