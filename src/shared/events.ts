// Server va brauzer ulashadigan turlar. Hech qanday bog'liqliksiz.

export const EVENT_TYPES = [
  'run_started',
  'plan_ready',
  'task_assigned',
  'agent_state',
  'handoff',
  'review_result',
  'revision_requested',
  'provider_switch',
  'usage_update',
  'run_finished',
  'run_failed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const AGENT_STATES = [
  'idle',
  'thinking',
  'writing',
  'reviewing',
  'waiting_rate_limit',
  'done',
  'error',
] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export interface KafedraEvent {
  seq: number;
  ts: string;
  type: EventType;
  /** Hodisa egasi (yoki handoff'da yuboruvchi) */
  agent?: string;
  /** handoff'da qabul qiluvchi */
  to?: string;
  task_id?: string;
  state?: AgentState;
  /** Nutq pufagi va jurnal uchun qisqa matn */
  text?: string;
  data?: Record<string, unknown>;
}

export type AgentRole = 'mudir' | 'uslubchi' | 'oqituvchi';

export interface AgentInfo {
  id: string;
  gender: 'male' | 'female';
  name: string;
  role: AgentRole;
  title: string;
  color: string;
  deliverable_type?: string;
}

export interface ProviderInfo {
  id: string;
  kind: string;
  enabled: boolean;
  trains_on_data: boolean | 'unknown';
  rpm?: number;
  rpd?: number;
}

export interface PublicConfig {
  kafedra: { name: string; audience: string; languages: string[]; default_language: string };
  limits: { max_revisions: number; concurrency: number; max_input_chars: number; max_material_chars: number; max_plan_tasks: number; max_requests_per_run: number };
  agents: AgentInfo[];
  providers: ProviderInfo[];
  chains: Record<string, string[]>;
  mock: boolean;
  problems: string[];
}

export interface PlanTaskInfo {
  id: string;
  assignee: string;
  title: string;
  instructions: string;
  deliverable_type: string;
  depends_on: string[];
  acceptance_criteria: string[];
}

export interface ReviewInfo {
  attempt: number;
  verdict: 'approve' | 'revise' | 'reject';
  score: number;
  issues: { place: string; problem: string; fix: string }[];
  /** Uslubchi javobi o'qilmadi */
  unreviewed: boolean;
  /** Avtomatik format tekshiruvi topgan muammolar soni */
  lint: number;
}

export interface RunSnapshot {
  runId: string | null;
  status: 'idle' | 'running' | 'finished' | 'failed';
  task: string;
  plan: PlanTaskInfo[];
  deliverables: Record<string, string>;
  final: string | null;
  reviews: Record<string, ReviewInfo[]>;
}
