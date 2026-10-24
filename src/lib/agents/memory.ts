import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

type Memory = { brand: string; lessons: Record<string, string[]>; at: number };
let mem: Memory = { brand: '', lessons: {}, at: 0 };

/**
 * Load the brand book and the heads' latest lessons once per minute. Every entry point that runs agents calls this,
 * and persona() adds the result to each agent's instructions, so the next report, plan or design reflects them.
 */
export async function loadMemory(db: SupabaseClient) {
  if (Date.now() - mem.at < 60_000) return;
  const [{ data: book }, { data: rows }] = await Promise.all([
    db.from('brand_book').select('voice, always, never, notes').eq('id', 1).maybeSingle(),
    db.from('lessons').select('department_id, source, lesson').eq('active', true).order('created_at', { ascending: false }).limit(600),
  ]);
  // people's notes and what the numbers say are kept apart, so a month of data never pushes out what a head said
  const lessons: Record<string, string[]> = {}, said: Record<string, number> = {}, seen: Record<string, number> = {};
  (rows || []).forEach(r => {
    const fromData = r.source === 'results' || r.source === 'analytics', n = fromData ? seen : said, max = fromData ? 5 : 8;
    if ((n[r.department_id] || 0) >= max) return;
    n[r.department_id] = (n[r.department_id] || 0) + 1; (lessons[r.department_id] ||= []).push(r.lesson);
  });
  const b = book || { voice: '', always: '', never: '', notes: '' };
  const brand = [b.voice && `Brand voice: ${b.voice}`, b.always && `Always: ${b.always}`, b.never && `Never: ${b.never}`, b.notes && `Also know: ${b.notes}`].filter(Boolean).join('\n');
  mem = { brand, lessons, at: Date.now() };
}

/** Brand book plus what the heads have told this department (and the Super Admin's word, which applies everywhere). */
export function memoryFor(dept: string) {
  const own = mem.lessons[dept] || [], top = dept === 'board' ? [] : (mem.lessons.board || []).slice(0, 4);
  const lessons = [...own, ...top];
  return [mem.brand && `Parakkat's brand book:\n${mem.brand}`, lessons.length && `What your team has learned from the heads and from Parakkat's own results (follow these):\n- ${lessons.join('\n- ')}`].filter(Boolean).join('\n\n');
}

/** How past campaigns did and what the heads said about them, for the Campaign Strategist. */
export async function pastResults(db: SupabaseClient) {
  const { data: camps } = await db.from('campaigns').select('id, name, occasion, budget_daily, status, external_ids, created_at').order('created_at', { ascending: false }).limit(12);
  if (!camps?.length) return [];
  const metaIds = camps.map(c => c.external_ids?.meta?.campaign_id).filter(Boolean).map(String);
  const [{ data: ads }, { data: steps }] = await Promise.all([
    metaIds.length ? db.rpc('campaign_results', { p_ids: metaIds }) : Promise.resolve({ data: [] as any[] }),
    db.from('approvals').select('campaign_id, approval_steps(role, decision, note)').in('campaign_id', camps.map(c => c.id)),
  ]);
  return camps.map(c => {
    const id = String(c.external_ids?.meta?.campaign_id || ''), rows = ((ads || []) as { campaign_id: string; spend: number; revenue: number; purchases: number }[]).filter(a => a.campaign_id === id);
    const spend = rows.reduce((s, a) => s + Number(a.spend), 0), rev = rows.reduce((s, a) => s + Number(a.revenue), 0), buys = rows.reduce((s, a) => s + Number(a.purchases), 0);
    const notes = (steps || []).filter(s => s.campaign_id === c.id).flatMap(s => (s.approval_steps as { role: string; decision: string; note: string | null }[]).filter(x => x.note).map(x => `${x.role.replace('_', ' ')} ${x.decision}: ${x.note}`));
    return `${c.name} (${c.occasion}, ₹${c.budget_daily}/day, ${c.status})${spend ? `: spent ₹${Math.round(spend)}, ${buys} purchases, revenue ₹${Math.round(rev)}, ${(rev / spend).toFixed(1)}x return` : ''}${notes.length ? `. Heads said: ${notes.join('; ')}` : ''}`;
  });
}
