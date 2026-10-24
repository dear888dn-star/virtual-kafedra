export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Mock adapter kimligini va vazifasini bilishi uchun; haqiqiy adapterlar e'tibor bermaydi. */
export interface CallMeta {
  purpose: 'plan' | 'work' | 'review' | 'assemble';
  agentId: string;
  deliverableType?: string;
  taskTitle?: string;
  attempt?: number;
  roster?: { id: string; title: string; deliverable_type: string }[];
}

export interface CompleteRequest {
  system: string;
  messages: ChatMessage[];
  json?: boolean;
  maxTokens: number;
  temperature: number;
  /** Router rol bo'yicha tanlaydi; adapter shuni ishlatadi */
  model?: string;
  meta?: CallMeta;
}

export interface CompleteResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  provider: string;
  model: string;
}

export interface Provider {
  readonly id: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

/** 429 yoki limit tugadi. Kutib qayta urinish mumkin. */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs = 2000,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/** 5xx, timeout, tarmoq uzilishi. Kutib qayta urinish mumkin. */
export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

/** 401/403: kalit noto'g'ri yoki ruxsat yo'q. Bu provayderni o'tkazib yuboramiz. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Boshqa 4xx: so'rov shu provayderga mos emas. Keyingisiga o'tamiz. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** Zanjirdagi hamma provayder limitda yoki ishlamayapti. */
export class LimitExhaustedError extends Error {
  constructor(
    message: string,
    public readonly retryAt: number | null = null,
  ) {
    super(message);
    this.name = 'LimitExhaustedError';
  }
}

/** Maxfiy topshiriq uchun trains_on_data: false provayder yo'q. Ish boshlanmaydi/to'xtaydi. */
export class SensitiveRoutingError extends Error {
  constructor(public readonly roles: string[]) {
    super(
      `Maxfiy topshiriq bajarilmadi: ${roles.map((r) => `"${r}"`).join(', ')} roli uchun ma'lumotni o'qitishga ishlatmaydigan (trains_on_data: false) provayder yo'q. ` +
        `Hech narsa bepul modelga yuborilmadi. Yechim: mahalliy Ollama'ni yoqing (config/providers.yaml) yoki provayderning shartlarini tekshirib trains_on_data qiymatini o'zingiz belgilang.`,
    );
    this.name = 'SensitiveRoutingError';
  }
}

/** Pullik provayderning kunlik byudjeti tugadi. Foydalanuvchidan so'rash kerak. */
export class BudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
  ) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}
