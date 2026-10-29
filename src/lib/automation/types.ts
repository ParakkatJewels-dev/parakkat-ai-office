import type { SupabaseClient } from '@supabase/supabase-js';

export type AutomationKind = 'head_task' | 'briefing' | 'data_quality' | 'campaign' | 'inventory' | 'customer' | 'catalogue' | 'advertising' | 'follow_up';
export type AutomationStatus = 'queued' | 'running' | 'blocked' | 'review' | 'completed' | 'cancelled' | 'failed';
export type AutomationAction = { kind: string; label: string; payload: Record<string, unknown> };
export type AutomationOutcome = {
  status: 'review' | 'completed' | 'blocked' | 'queued';
  summary: string;
  markdown: string;
  evidence: Array<{ source: string; detail: string; at?: string }>;
  warnings: string[];
  actions?: AutomationAction[];
  metrics?: Record<string, number>;
  state?: Record<string, unknown>;
  nextRunAt?: string;
};
export type AutomationTask = {
  id: string; kind: AutomationKind; department_id: string; owner_agent: string;
  created_by: string | null; title: string; brief: string; priority: number; status: AutomationStatus;
  input: Record<string, any>; state: Record<string, any>; result: AutomationOutcome | null;
  source_key: string | null; parent_id: string | null; depends_on: string[]; due_at: string | null;
  next_run_at: string; claimed_by: string | null; lease_until: string | null; attempts: number;
  revision: number; error: string | null; started_at: string | null; finished_at: string | null;
  created_at: string; updated_at: string;
};
export type AutomationContext = {
  db: SupabaseClient; task: AutomationTask; signal: AbortSignal;
  checkpoint(state: Record<string, unknown>): Promise<void>;
  event(agentId: string, text: string, kind?: string): Promise<void>;
  assertActive(): Promise<void>;
};
