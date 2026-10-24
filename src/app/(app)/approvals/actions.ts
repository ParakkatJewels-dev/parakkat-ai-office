'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { publishApproved } from '@/lib/agents/publish';

const back = (msg: string) => redirect(`/approvals?error=${encodeURIComponent(msg)}`);

/** A head accepts, sends back or rejects a report their AI team lead forwarded. The database checks the department. */
export async function decideReport(form: FormData) {
  const db = await supabaseServer();
  const { error } = await db.rpc('decide_report', { p_report: form.get('id'), p_decision: form.get('decision'), p_note: String(form.get('note') || '') || null });
  if (error) back(error.message);
  revalidatePath('/approvals');
}

/** A head or the Super Admin signs a plan. When the Super Admin approves, the campaign is published. */
export async function decideApproval(form: FormData) {
  const db = await supabaseServer();
  const id = String(form.get('id'));
  const { data: status, error } = await db.rpc('decide_approval', { p_approval: id, p_decision: form.get('decision'), p_note: String(form.get('note') || '') || null });
  if (error) back(error.message);
  if (status === 'approved') {
    try { await publishApproved(supabaseAdmin(), id); }
    catch (e) { back(`Approved, but publishing failed: ${e instanceof Error ? e.message : e}. Fix the connection on the Admin page and approve again from there.`); }
  }
  revalidatePath('/approvals');
}
