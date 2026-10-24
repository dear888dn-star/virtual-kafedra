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
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
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
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
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
    // Fikrlovchi modellarda "fikrlash" tokenlari ham chegaraga kiradi: oldindan zaxira beramiz,
    // javob chegaraga urilsa (kesilgan yoki bo'sh) chegarani oshirib bir marta qayta uriniladi.
    const thinking = this.opts.reasoningEffort && this.opts.reasoningEffort !== 'none' ? 2048 : 0;
    const first = await this.once(req, req.maxTokens + thinking);
    if (!first.truncated) return first.result!;
    const second = await this.once(req, Math.min((req.maxTokens + thinking) * 3, 12000));
    if (second.result && (second.result.text !== '' || !first.result)) return second.result;
    if (first.result && first.result.text !== '') return first.result; // kesilgan bo'lsa ham bor javobni qaytaramiz
    throw new TransientError(`${this.id}: model bo'sh javob qaytardi (token chegarasi)`);
  }

  /** Bitta so'rov. finish_reason=length bo'lsa truncated=true (matn bo'sh yoki kesilgan bo'lishi mumkin). */
  private async once(req: CompleteRequest, maxTokens: number): Promise<{ result: CompleteResult | null; truncated: boolean }> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      temperature: req.temperature,
      [this.opts.maxTokensField ?? 'max_tokens']: maxTokens,
    };
    if (this.opts.reasoningEffort) body.reasoning_effort = this.opts.reasoningEffort;
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
    const truncated = data.choices?.[0]?.finish_reason === 'length';
    if (typeof text !== 'string' && !truncated) throw new TransientError(`${this.id}: javobda matn yo'q`);
    if (typeof text !== 'string') return { result: null, truncated: true };
    const result: CompleteResult = {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? Math.ceil((req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0)) / 4),
        outputTokens: data.usage?.completion_tokens ?? Math.ceil(text.length / 4),
      },
      provider: this.id,
      model: data.model ?? req.model!,
    };
    return { result, truncated };
  }
}
