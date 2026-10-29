import { PEOPLE, HUMAN_HEAD as HEADS, teamLead } from '@/office/roster.mjs';
import { ROLE_TO_PERSON, type AppRole } from '@/lib/roles';
import type { SupabaseClient } from '@supabase/supabase-js';
import { agentPrompt } from './agent-instructions';

export type Person = (typeof PEOPLE)[number];
export const byId: Record<string, Person> = Object.fromEntries(PEOPLE.map(p => [p.id, p]));
export const PERSON_TO_ROLE = Object.fromEntries(Object.entries(ROLE_TO_PERSON).map(([r, p]) => [p, r])) as Record<string, AppRole>;
/** Department id to the office id of the human head it reports to. */
export const HUMAN_HEAD = HEADS as Record<string, string>;
export { teamLead };

/** Fresh role, saved instructions, brand guidance and scoped lessons for every agent call. */
export const persona = (db: SupabaseClient, id: string, extra = '') => agentPrompt(db, id, extra);
