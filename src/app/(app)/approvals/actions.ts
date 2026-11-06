'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { publishApproved } from '@/lib/agents/publish';
import { requireUser } from '@/lib/auth/session';
import { UUID } from '@/lib/automation/core.mjs';

const back = (msg: string, tab = 'reports', focus = '') => redirect(`/approvals?tab=${tab}${focus}&error=${encodeURIComponent(msg)}`);
const done = (msg: string, tab: string) => redirect(`/approvals?tab=${tab}&msg=${encodeURIComponent(msg)}`);

/** Database refusals in words a reviewer can act on; anything unexpected gets a safe general message. */
function plain(error: { message?: string; code?: string }, what: 'report' | 'plan') {
  const m = error.message || '';
  if (error.code === '42501' || /Not your department/.test(m)) return `This ${what} belongs to another team, so you can’t decide it.`;
  if (/not waiting on/.test(m)) return `Someone already decided this ${what}. Refresh to see where it stands.`;
  if (error.code === '40001' || /revised|changed before/.test(m)) return `This ${what} changed while you were reading it. Read the new version, then decide again. Your note is kept.`;
  if (/Add a note/.test(m)) return 'Add a short note so the team knows what to change or why.';
  if (/already decided/.test(m)) return 'You have already decided on this plan.';
  if (/heads have not all approved|does not need your approval/.test(m)) return m.endsWith('.') ? m : `${m}.`;
  return `Your decision wasn’t saved. Your note is kept; try again in a moment.`;
}
const REPORT_DONE: Record<string, string> = { accept: 'Report accepted. The team has been told.', send_back: 'Sent back with your note. The team will revise it and send it again.', reject: 'Report rejected. The team has your note.' };

/** Queue a fresh version-bound review of existing assets; never advance or publish here. */
export async function requestCampaignReview(form: FormData) {
  const id=String(form.get('id')||'');
  if(!UUID.test(id))back('Choose a valid campaign approval.','plans');
  const {db}=await requireUser();
  const {data,error}=await db.rpc('request_campaign_rereview',{p_approval:id});
  if(error)back(error.code==='42501'?'Only a currently authorized campaign head or Super Admin can request this review.':error.code==='40001'?'This campaign has active work or its state changed. Refresh before requesting review.':error.code==='22023'?'This campaign is not eligible for a fresh review in its current state. Refresh its approval and saved work.':'The review request could not be confirmed. Refresh before trying again.','plans');
  if(typeof data!=='string'||!UUID.test(data))back('The review request could not be confirmed. Refresh before trying again.','plans');
  revalidatePath('/approvals');revalidatePath('/admin');revalidatePath('/automations');
  redirect('/approvals?tab=plans&msg=Fresh%20quality%20review%20queued.%20Existing%20assets%20and%20earlier%20votes%20are%20preserved.%20Work%20waits%20while%20the%20office%20is%20paused.#plans');
}

/** A head accepts, sends back or rejects a report their AI team lead forwarded. The database checks the department. */
export async function decideReport(form: FormData) {
  const db = await supabaseServer();
  const revision=Number(form.get('revision'));
  const id = String(form.get('id') || ''), decision = String(form.get('decision') || '');
  const { error } = await db.rpc('decide_report', { p_report: id, p_decision: decision, p_note: String(form.get('note') || '') || null, p_revision:Number.isSafeInteger(revision)&&revision>0?revision:null });
  if (error) back(plain(error, 'report'), 'reports', UUID.test(id) ? `&report=${id}` : '');
  revalidatePath('/approvals');
  revalidatePath('/automations');
  revalidatePath('/dashboard');
  done(REPORT_DONE[decision] || 'Decision saved.', 'reports');
}

/** A head or the Super Admin signs a plan. When the Super Admin approves, the campaign is published. */
export async function decideApproval(form: FormData) {
  const db = await supabaseServer();
  const id = String(form.get('id'));
  const decision = String(form.get('decision') || '');
  const { data: status, error } = await db.rpc('decide_approval', { p_approval: id, p_decision: decision, p_note: String(form.get('note') || '') || null });
  if (error) back(plain(error, 'plan'),'plans');
  if (status === 'approved') {
    const approved = await db.from('approvals').select('campaigns(channels)').eq('id', id).single();
    if (approved.error) back('Approved. Could not check publishing channels; no launch was started. Review this plan in Admin.','plans');
    if ((approved.data?.campaigns as any)?.channels?.includes('google')) {
      revalidatePath('/approvals');
      redirect('/approvals?tab=plans&msg=Approved%20for%20manual%20launch.%20No%20ads%20were%20created.');
    }
    try { await publishApproved(supabaseAdmin(), id); }
    catch (e) { back(`The plan is approved. ${e instanceof Error ? e.message : 'Publishing could not finish. Review its status in Admin.'}`,'plans'); }
    revalidatePath('/approvals'); revalidatePath('/dashboard');
    done('Approved and published to Meta. Follow it in Campaigns.', 'plans');
  }
  revalidatePath('/approvals'); revalidatePath('/dashboard');
  done(decision === 'approve' ? 'Approved. It now waits on the next sign-off.' : decision === 'changes' ? 'Changes requested. The team will revise the plan and send it back to you.' : 'Plan rejected. The team has your note.', 'plans');
}

const DESIGN_DONE: Record<string, string> = { approved: 'Design approved. The team can use it.', changes: 'Sent back with your note. The team will make a new version and send it again.', rejected: 'Design rejected. The team has your note.' };

/** The Super Admin signs off a design a head sent from Studio. The database checks who decides and keeps the exact image. */
export async function decideDesign(form: FormData) {
  const id = String(form.get('id') || ''), decision = String(form.get('decision') || '');
  if (!UUID.test(id)) back('Choose a design to decide.', 'designs');
  const db = await supabaseServer();
  const { error } = await db.rpc('decide_design_approval', { p_id: id, p_decision: decision, p_note: String(form.get('note') || '').trim() || null });
  if (error) {
    const m = error.message || '';
    back(error.code === '42501' || /Only the Super Admin/.test(m) ? 'Only the Super Admin signs off designs.'
      : /not waiting on anyone/.test(m) ? 'This design was already decided. Refresh to see where it stands.'
      : /Add a note/.test(m) ? 'Add a short note so the team knows what to change or why.'
      : 'Your decision wasn’t saved. Your note is kept; try again in a moment.', 'designs', `&design=${id}`);
  }
  revalidatePath('/approvals'); revalidatePath('/studio'); revalidatePath('/dashboard');
  done(DESIGN_DONE[decision] || 'Decision saved.', 'designs');
}
