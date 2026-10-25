import { extractText, getDocumentProxy } from 'unpdf';

export class PdfError extends Error {}

export interface PdfText {
  text: string;
  pages: number;
  chars: number;
  truncated: boolean;
}

/** PDF kitobdan matn qatlamini oladi (OCR yo'q: skaner qilingan rasm-PDF'dan matn chiqmaydi). */
export async function extractPdfText(bytes: Uint8Array, maxChars: number): Promise<PdfText> {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 8));
  if (!head.startsWith('%PDF-')) throw new PdfError("Bu PDF fayl emas (fayl boshi '%PDF-' bilan boshlanmaydi).");
  let pages = 0;
  let raw = '';
  try {
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    const r = await extractText(doc, { mergePages: true });
    pages = r.totalPages;
    raw = r.text;
  } catch (e) {
    throw new PdfError(`PDF'ni o'qib bo'lmadi: ${(e as Error).message.slice(0, 100)}`);
  }
  const text = raw.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 20) {
    throw new PdfError("PDF'da matn qatlami topilmadi (skaner qilingan rasm bo'lishi mumkin). Matnli PDF yoki .txt yuklang, yoki kerakli bo'limni qo'lda qo'ying.");
  }
  const truncated = text.length > maxChars;
  return { text: truncated ? text.slice(0, maxChars) : text, pages, chars: text.length, truncated };
}
