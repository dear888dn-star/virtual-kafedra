import type { KafedraEvent, PlanTaskInfo, PublicConfig, RunSnapshot } from '../src/shared/events';

export type CardStatus = 'planned' | 'working' | 'reviewing' | 'revising' | 'done' | 'failed';

export interface TaskCard {
  id: string;
  title: string;
  assignee: string;
  status: CardStatus;
  score?: number;
  warned?: boolean;
}

export interface ProviderUsage {
  count: number;
  limit: number | null;
  model: string;
}

type Listener = () => void;

/** Hodisalardan hosil bo'ladigan UI holati. Hodisalar tartib bilan `apply` qilinadi. */
export class Store {
  config: PublicConfig | null = null;
  events: KafedraEvent[] = [];
  tasks = new Map<string, TaskCard>();
  usage = new Map<string, ProviderUsage>();
  currentProvider: string | null = null;
  lastSwitch: string | null = null;
  status: RunSnapshot['status'] = 'idle';
  runTask = '';
  runId: string | null = null;
  error: string | null = null;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<(e: KafedraEvent) => void>();

  onChange(l: Listener): void {
    this.listeners.add(l);
  }
  onEvent(l: (e: KafedraEvent) => void): void {
    this.eventListeners.add(l);
  }
  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  agentName(id: string | undefined): string {
    if (!id) return '';
    return this.config?.agents.find((a) => a.id === id)?.name ?? id;
  }

  get doneCount(): number {
    return [...this.tasks.values()].filter((t) => t.status === 'done' || t.status === 'failed').length;
  }

  apply(e: KafedraEvent): void {
    if (e.type === 'run_started') {
      this.events = [];
      this.tasks.clear();
      this.error = null;
      this.runTask = String(e.data?.task ?? '');
      this.runId = String(e.data?.run_id ?? '') || null;
      this.status = 'running';
    } else if (this.events.length > 0 && e.seq <= this.events[this.events.length - 1]!.seq) {
      // SSE qayta ulanganda takror kelgan hodisani o'tkazib yuboramiz
      return;
    }
    this.events.push(e);

    const card = e.task_id ? this.tasks.get(e.task_id) : undefined;
    switch (e.type) {
      case 'plan_ready': {
        const tasks = (e.data?.tasks ?? []) as PlanTaskInfo[];
        for (const t of tasks) {
          this.tasks.set(t.id, { id: t.id, title: t.title, assignee: t.assignee, status: 'planned' });
        }
        break;
      }
      case 'agent_state':
        if (card && e.state === 'writing') card.status = 'working';
        if (card && e.state === 'error') card.status = 'failed';
        break;
      case 'handoff':
        if (card && e.to === 'uslubchi') card.status = 'reviewing';
        break;
      case 'revision_requested':
        if (card) card.status = 'revising';
        break;
      case 'review_result':
        if (card) {
          card.score = Number(e.data?.score ?? 0);
          if (e.data?.accepted) {
            card.status = 'done';
            card.warned = e.data?.verdict !== 'approve';
          }
        }
        break;
      case 'usage_update': {
        const p = String(e.data?.provider ?? '');
        if (p) {
          this.usage.set(p, {
            count: Number(e.data?.requests_today ?? 0),
            limit: (e.data?.limit_per_day as number | null) ?? null,
            model: String(e.data?.model ?? ''),
          });
          this.currentProvider = p;
        }
        break;
      }
      case 'provider_switch':
        this.lastSwitch = e.text ?? null;
        break;
      case 'run_finished':
        this.status = 'finished';
        break;
      case 'run_failed':
        this.status = 'failed';
        this.error = e.text ?? 'Xato';
        break;
      default:
        break;
    }
    this.eventListeners.forEach((l) => l(e));
    this.notify();
  }
}
