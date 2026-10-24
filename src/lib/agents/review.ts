import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chatJSON } from '@/lib/llm/openai';
import { emit } from './events';
import { byId, persona, teamLead, HUMAN_HEAD } from './people';

export type Draft = { title: string; body: string; data?: unknown };
type Verdict = { decision: 'forward' | 'revise' | 'reject'; note: string };

/**
 * A staff agent files a report. Their AI team lead re-checks it and forwards it to the human head,
 * sends it back to revise (at most twice), or rejects it. Returns the stored report.
 */
export async function fileReport(db: SupabaseClient, runId: string | null, author: string, draft: Draft, context: string) {
  const dept = byId[author].room, lead = teamLead(dept) || 'cmo', head = HUMAN_HEAD[dept];
  const { data: report, error } = await db.from('reports').insert({ run_id: runId, department_id: dept, author_agent: author, lead_agent: lead, title: draft.title, body: draft.body, data: draft.data ?? null }).select().single();
  if (error) throw error;
  await emit(db, runId, 'say', author, draft.title, lead, { report_id: report.id });

  let cur = draft, revision = 1;
  for (;;) {
    await emit(db, runId, 'think', lead, `Reviewing the report from ${byId[author].name}`);
    const v = await chatJSON<Verdict>('manager', persona(lead, `You are the AI team lead. Review a report from ${byId[author].name} before it reaches the human head.
Forward it if it is accurate, backed by the data, and useful for a decision. Send it back to revise if it is fixable (missing source, vague, wrong comparison).
Reject it if it is not worth a human's time (duplicate, too little data, off-topic). Shape: {"decision": "forward"|"revise"|"reject", "note": "one sentence"}`),
      `Data the author had:\n${context}\n\nReport (revision ${revision}):\nTitle: ${cur.title}\n${cur.body}`);
    if (v.decision === 'revise' && revision < 3) {
      await emit(db, runId, 'feedback', lead, `Send back: ${v.note}`, author, { report_id: report.id });
      await db.from('reports').update({ status: 'revise', lead_note: v.note, updated_at: new Date().toISOString() }).eq('id', report.id);
      cur = await chatJSON<Draft>('worker', persona(author, 'Revise your report to address the note. Shape: {"title": "...", "body": "..."}'),
        `Data:\n${context}\n\nYour report:\nTitle: ${cur.title}\n${cur.body}\n\nNote from ${byId[lead].name}: ${v.note}`);
      revision++;
      await emit(db, runId, 'say', author, `Revised: ${cur.title}`, lead, { report_id: report.id });
      await db.from('reports').update({ title: cur.title, body: cur.body, revision }).eq('id', report.id);
      continue;
    }
    if (v.decision === 'reject') {
      await emit(db, runId, 'feedback', lead, `Rejected: ${v.note}`, author, { report_id: report.id });
      await db.from('reports').update({ status: 'rejected_by_lead', lead_note: v.note, updated_at: new Date().toISOString() }).eq('id', report.id);
      return { ...report, ...cur, status: 'rejected_by_lead' as const };
    }
    await emit(db, runId, 'report', lead, `Forwarded to the ${byId[head].name}: ${cur.title}`, head, { report_id: report.id });
    await db.from('reports').update({ status: 'with_head', lead_note: v.note, updated_at: new Date().toISOString() }).eq('id', report.id);
    return { ...report, ...cur, status: 'with_head' as const };
  }
}
