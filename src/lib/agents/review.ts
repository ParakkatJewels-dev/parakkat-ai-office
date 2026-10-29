import 'server-only';
import { randomUUID } from 'node:crypto';
import type { CampaignCheckpoint } from './campaign-checkpoint-core.mjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reportReviewDecision } from './quality-core.mjs';
import { chatJSON } from '@/lib/llm/openai';
import { emit } from './events';
import { byId, persona, teamLead, HUMAN_HEAD } from './people';

export type Draft = { title: string; body: string; data?: unknown };
type Verdict = { decision: 'forward' | 'revise' | 'reject'; note: string };

/**
 * A staff agent files a report. Their AI team lead re-checks it and forwards it to the human head,
 * allows one focused correction, or rejects it. Returns the stored report.
 */
export async function fileReport(db: SupabaseClient, runId: string | null, author: string, draft: Draft, context: string, resume?: {checkpoint:CampaignCheckpoint;key:string}) {
  const dept = byId[author].room, lead = teamLead(dept) || 'cmo', head = HUMAN_HEAD[dept];
  const reviewSystem = await persona(db, lead, `You are the AI team lead. Review a report from ${byId[author].name} before it reaches the human head.
Check each product, quantity, date and numerical comparison against the supplied source data. Missing rows mean unknown, not zero. Forward it only if its claims are supported and useful for a decision. Send it back to revise if a claim is unsupported or fixable (missing source, vague, wrong comparison).
Reject it if it is not worth a human's time (duplicate, too little data, off-topic). Shape: {"decision": "forward"|"revise"|"reject", "note": "one sentence"}`);
  const revisionSystem = resume ? await persona(db, author, 'Revise your report to address the note. Shape: {"title": "...", "body": "..."}') : null;
  const fields = { run_id: runId, department_id: dept, author_agent: author, lead_agent: lead, title: draft.title, body: draft.body, data: draft.data ?? null };
  let report: any;
  if (resume) {
    // Reserve the row identity before inserting: a retry can safely adopt the same row.
    const id = await resume.checkpoint.memo(`${resume.key}.id`, {fields,context,reviewSystem,revisionSystem}, randomUUID);
    const inserted = await db.from('reports').upsert({id,...fields}, {onConflict:'id',ignoreDuplicates:true});
    if (inserted.error) throw inserted.error;
    const existing = await db.from('reports').select().eq('id',id).single();
    if (existing.error || !existing.data) throw existing.error || new Error('The saved report could not be read.');
    report = existing.data;
    if (!['lead_review','revise'].includes(report.status)) return report;
  } else {
    const inserted = await db.from('reports').insert(fields).select().single();
    if (inserted.error) throw inserted.error;
    report = inserted.data;
  }
  const save = async (change: Record<string,unknown>) => {
    const update = db.from('reports').update(change).eq('id',report.id);
    const saved = resume ? await update.in('status',['lead_review','revise']).select('id').maybeSingle() : await update;
    if (saved.error) throw saved.error;
    if (resume && !saved.data) throw new Error('The report was already decided; its saved decision was preserved.');
  };
  await emit(db, runId, 'say', author, draft.title, lead, { report_id: report.id });
  let cur = draft, revision = 1;
  for (;;) {
    await emit(db, runId, 'think', lead, `Reviewing the report from ${byId[author].name}`);
    const input = `Data the author had:\n${context}\n\nReport (revision ${revision}):\nTitle: ${cur.title}\n${cur.body}`;
    const review = () => chatJSON<Verdict>('manager',reviewSystem,input,{maxOutputTokens:800,useCase:'review'});
    const verdict = resume ? await resume.checkpoint.run(`${resume.key}.review.${revision}`, {reportId:report.id,system:reviewSystem,input}, review) : await review();
    const v = reportReviewDecision(verdict, revision);
    if (v.decision === 'revise' && revision < 2) {
      await emit(db, runId, 'feedback', lead, `Send back: ${v.note}`, author, { report_id: report.id });
      await save({ status: 'revise', lead_note: v.note, updated_at: new Date().toISOString() });
      const system = revisionSystem || await persona(db, author, 'Revise your report to address the note. Shape: {"title": "...", "body": "..."}');
      const input = `Data:\n${context}\n\nYour report:\nTitle: ${cur.title}\n${cur.body}\n\nNote from ${byId[lead].name}: ${v.note}`;
      const rewrite = async () => {
        const revised = await chatJSON<Draft>('worker',system,input,{useCase:'reviewed_draft'});
        if (!revised || typeof revised.title!=='string' || !revised.title.trim() || typeof revised.body!=='string' || !revised.body.trim()) throw new Error('The analyst returned an incomplete correction.');
        return revised;
      };
      cur = resume ? await resume.checkpoint.run(`${resume.key}.revision`, {reportId:report.id,system,input}, rewrite) : await rewrite();
      revision++;
      await emit(db, runId, 'say', author, `Revised: ${cur.title}`, lead, { report_id: report.id });
      await save({ title: cur.title, body: cur.body, revision });
      continue;
    }
    if (v.decision === 'reject') {
      await emit(db, runId, 'feedback', lead, `Rejected: ${v.note}`, author, { report_id: report.id });
      await save({ status: 'rejected_by_lead', lead_note: v.note, updated_at: new Date().toISOString() });
      return { ...report, ...cur, status: 'rejected_by_lead' as const };
    }
    await emit(db, runId, 'report', lead, `Forwarded to the ${byId[head].name}: ${cur.title}`, head, { report_id: report.id });
    await save({ status: 'with_head', lead_note: v.note, updated_at: new Date().toISOString() });
    return { ...report, ...cur, status: 'with_head' as const };
  }
}
