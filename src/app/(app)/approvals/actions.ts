'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { publishApproved } from '@/lib/agents/publish';
import { requireUser } from '@/lib/auth/session';
import { UUID } from '@/lib/automation/core.mjs';

const back = (msg: string, tab = 'reports') => redirect(`/approvals?tab=${tab}&error=${encodeURIComponent(msg)}`);

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
  const { error } = await db.rpc('decide_report', { p_report: form.get('id'), p_decision: form.get('decision'), p_note: String(form.get('note') || '') || null, p_revision:Number.isSafeInteger(revision)&&revision>0?revision:null });
  if (error) back(error.message);
  revalidatePath('/approvals');
  revalidatePath('/automations');
}

/** A head or the Super Admin signs a plan. When the Super Admin approves, the campaign is published. */
export async function decideApproval(form: FormData) {
  const db = await supabaseServer();
  const id = String(form.get('id'));
  const { data: status, error } = await db.rpc('decide_approval', { p_approval: id, p_decision: form.get('decision'), p_note: String(form.get('note') || '') || null });
  if (error) back(error.message,'plans');
  if (status === 'approved') {
    const approved = await db.from('approvals').select('campaigns(channels)').eq('id', id).single();
    if (approved.error) back('Approved. Could not check publishing channels; no launch was started. Review this plan in Admin.','plans');
    if ((approved.data?.campaigns as any)?.channels?.includes('google')) {
      revalidatePath('/approvals');
      redirect('/approvals?tab=plans&msg=Approved%20for%20manual%20launch.%20No%20ads%20were%20created.');
    }
    try { await publishApproved(supabaseAdmin(), id); }
    catch (e) { back(`The plan is approved. ${e instanceof Error ? e.message : 'Publishing could not finish. Review its status in Admin.'}`,'plans'); }
  }
  revalidatePath('/approvals');
}
