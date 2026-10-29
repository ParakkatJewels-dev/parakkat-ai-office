import type {SupabaseClient} from '@supabase/supabase-js';
export const OUTCOME_CADENCE_SECONDS:300;
export function withOutcomeMonitoringLease(db:SupabaseClient,sweep:(context:{scan:{monitor_after:string|null;last_attempt_at:string|null;last_refreshed_at:string|null};signal:AbortSignal;now:Date})=>Promise<any>,options?:{force?:boolean;now?:()=>Date}):Promise<any>;
