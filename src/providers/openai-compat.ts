import {
  AuthError,
  BadRequestError,
  RateLimitError,
  TransientError,
  type CompleteRequest,
  type CompleteResult,
  type Provider,
} from './types';

export interface OpenAICompatOptions {
  baseUrl: string;
  /** Kalit; mahalliy Ollama uchun har qanday qiymat */
  apiKey: string;
  timeoutMs?: number;
  /** 'json_object' bo'lsa req.json uchun response_format yuboriladi */
  jsonMode?: 'json_object' | 'none';
  /** Ba'zi provayderlar `max_completion_tokens` talab qiladi */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  fetchFn?: typeof fetch;
}

/** Retry-After: soniya yoki HTTP sana. Millisekundga aylantiradi. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

/** Groq, Cerebras, OpenRouter, Mistral, DeepSeek, Gemini (OpenAI-mos endpoint) va Ollama uchun umumiy adapter. */
export class OpenAICompatProvider implements Provider {
  private fetchFn: typeof fetch;

  constructor(
    readonly id: string,
    private opts: OpenAICompatOptions,
  ) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    if (!req.model) throw new BadRequestError(`${this.id}: model tanlanmagan`);
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      temperature: req.temperature,
      [this.opts.maxTokensField ?? 'max_tokens']: req.maxTokens,
    };
    if (req.json && this.opts.jsonMode === 'json_object') body.response_format = { type: 'json_object' };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 60000);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      throw new TransientError(`${this.id}: ${aborted ? 'vaqt tugadi (timeout)' : 'tarmoq xatosi'}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const snippet = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      const msg = `${this.id}: HTTP ${res.status} ${snippet}`;
      if (res.status === 429) {
        throw new RateLimitError(msg, parseRetryAfter(res.headers.get('retry-after')) ?? 2000);
      }
      if (res.status === 401 || res.status === 403) throw new AuthError(msg);
      if (res.status === 408 || res.status >= 500) throw new TransientError(msg);
      throw new BadRequestError(msg);
    }

    let data: ChatResponse;
    try {
      data = (await res.json()) as ChatResponse;
    } catch {
      throw new TransientError(`${this.id}: javob JSON emas`);
    }
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new TransientError(`${this.id}: javobda matn yo'q`);
    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? Math.ceil((req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0)) / 4),
        outputTokens: data.usage?.completion_tokens ?? Math.ceil(text.length / 4),
      },
      provider: this.id,
      model: data.model ?? req.model,
    };
  }
}
