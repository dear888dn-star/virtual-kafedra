import { appendFileSync } from 'node:fs';
import type { KafedraEvent } from '../shared/events';

export type NewEvent = Omit<KafedraEvent, 'seq' | 'ts'>;
type Listener = (e: KafedraEvent) => void;

/** Hodisalar shinasi: xotirada saqlaydi (SSE qayta o'ynatish uchun) va events.jsonl ga yozadi. */
export class EventBus {
  private events: KafedraEvent[] = [];
  private listeners = new Set<Listener>();
  private sinkPath: string | null = null;
  /** Har yangi ishda oshadi: SSE qayta ulanganda eski ish hodisalari aralashmasligi uchun */
  epoch = 0;

  /** Yangi topshiriq boshlanganda eski hodisalarni tozalaydi. */
  reset(sinkPath: string | null): void {
    this.events = [];
    this.epoch++;
    this.sinkPath = sinkPath;
  }

  emit(e: NewEvent): KafedraEvent {
    const full: KafedraEvent = { seq: this.events.length, ts: new Date().toISOString(), ...e };
    this.events.push(full);
    if (this.sinkPath) {
      try {
        appendFileSync(this.sinkPath, JSON.stringify(full) + '\n');
      } catch {
        // jurnalga yozib bo'lmasa ishni to'xtatmaymiz
      }
    }
    for (const l of this.listeners) l(full);
    return full;
  }

  since(from: number): KafedraEvent[] {
    return this.events.slice(Math.max(0, from));
  }

  all(): KafedraEvent[] {
    return this.events;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
