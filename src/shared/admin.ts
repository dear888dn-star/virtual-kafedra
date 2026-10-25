/** Boshqaruv paneli: server va brauzer uchun umumiy turlar. Kalit qiymatlari hech qachon brauzerga yuborilmaydi. */

export interface AdminProvider {
  id: string;
  kind: string;
  enabled: boolean;
  trains_on_data: boolean | 'unknown';
  /** models.default (yoki bo'sh) */
  model: string;
  rpm: number | null;
  rpd: number | null;
  tpm: number | null;
  /** Kalit saqlanadigan .env o'zgaruvchisi (mock/ollama uchun yo'q) */
  key_env: string | null;
  /** Kalit .env da bor-yo'qligi. Qiymati yuborilmaydi. */
  key_set: boolean;
}

export interface AdminAgent {
  id: string;
  gender: 'male' | 'female';
  role: 'mudir' | 'uslubchi' | 'oqituvchi';
  name: string;
  title: string;
  color: string;
}

export interface AdminLimits {
  max_revisions: number;
  concurrency: number;
  max_input_chars: number;
  max_material_chars: number;
  max_plan_tasks: number;
  max_requests_per_run: number;
}

export interface AdminSettings {
  kafedra: { name: string; audience: string };
  limits: AdminLimits;
  agents: AdminAgent[];
  providers: AdminProvider[];
  chains: Record<string, string[]>;
  /** .env dagi MOCK=1: real provayderlar ishlatilmaydi */
  mock_forced: boolean;
  /** Hozir topshiriq bajarilyapti: saqlash mumkin emas */
  running: boolean;
}

export interface AdminUpdate {
  kafedra: { name: string; audience: string };
  limits: AdminLimits;
  agents: { id: string; name: string; title: string; color: string; gender?: 'male' | 'female' }[];
  providers: {
    id: string;
    enabled: boolean;
    model: string;
    rpm: number | null;
    rpd: number | null;
    tpm: number | null;
  }[];
  chains: Record<string, string[]>;
  mock_forced: boolean;
  /** Yangi kalitlar: { GROQ_API_KEY: "..." }. Bo'sh/yo'q = o'zgartirilmaydi. */
  keys: Record<string, string>;
}
