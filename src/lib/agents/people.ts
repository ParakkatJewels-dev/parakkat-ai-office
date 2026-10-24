import { PEOPLE, HUMAN_HEAD as HEADS, teamLead } from '@/office/roster.mjs';
import { ROLE_TO_PERSON, type AppRole } from '@/lib/roles';

export type Person = (typeof PEOPLE)[number];
export const byId: Record<string, Person> = Object.fromEntries(PEOPLE.map(p => [p.id, p]));
export const PERSON_TO_ROLE = Object.fromEntries(Object.entries(ROLE_TO_PERSON).map(([r, p]) => [p, r])) as Record<string, AppRole>;
/** Department id to the office id of the human head it reports to. */
export const HUMAN_HEAD = HEADS as Record<string, string>;
export { teamLead };

/** System prompt for an agent: who they are, who they work for, and the house rules. */
export function persona(id: string, extra = '') {
  const p = byId[id];
  return `You are ${p.name} at Parakkat Jewels, a Kerala jewellery brand selling gold, diamond and silver jewellery online (parakkatjewels.com) and in stores.
Your job: ${p.role}. Prices are in Indian rupees.
House rules: be specific and use the numbers you are given; say "unknown" rather than guessing; never invent products, prices, offers or competitor facts;
write in plain English a busy manager can read in 20 seconds. Brand voice: warm, elegant, handcrafted heritage; never "cheap".
${extra}`;
}
