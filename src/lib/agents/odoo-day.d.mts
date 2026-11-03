import type { SupabaseClient } from '@supabase/supabase-js';
export function odooDayIntent(request: string): boolean;
export function odooDayForRequest(request: string, now?: Date): string;
export function summarizeOdooDay(rows: Record<string, unknown>[], options: { day: string; observedAt: string; cursor: Record<string, any> | null; syncedAt: string | null; limit?: number }): Record<string, any>;
export function readOdooDay(reader: SupabaseClient, signal: AbortSignal, request: string, observedAt?: string, excludedBranches?: string[]): Promise<Record<string, any>>;
