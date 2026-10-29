import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { G, metaConfig } from './meta';
import { withAgentWork } from '@/lib/agents/agent-work';
import {
  INSTAGRAM_INBOX_PERMISSIONS, instagramGraphRequest, instagramInboxError,
  normaliseInstagramMessage, sendInstagramMessage, validateInstagramReply,
  type InstagramInboundMessage,
} from './instagram-inbox-core.mjs';

export type InstagramInboxStatus = { connected:boolean; accountId?:string; canRead:boolean; canSend:boolean; reason:string; webhookConfigured?:boolean };
type Context = { status:InstagramInboxStatus; pageId?:string; igId?:string; pageToken?:string };
const validId = (id:unknown):id is string => typeof id === 'string' && /^\d{1,50}$/.test(id);
let checked: { at:number; key:string; value:Context } | null = null;
let checking: { key:string; promise:Promise<Context> } | null = null;

/**
 * Facebook Login route, using the already selected Page and IG account. Derive a
 * Page token in memory; never replace the existing Meta token used by advertising.
 * Official contracts checked 26 Oct 2026:
 * developers.facebook.com/documentation/business-messaging/instagram-messaging/get-started
 * developers.facebook.com/documentation/business-messaging/messenger-platform/conversations
 */
async function inboxContext(force = false): Promise<Context> {
  const config = await metaConfig();
  if (!config?.token || !validId(config.page) || !validId(config.ig)) return { status: {
    connected:false, canRead:false, canSend:false, reason:'Connect Meta and choose the Instagram professional account and its linked Facebook Page in Admin.',
  } };
  const pageId=config.page,igId=config.ig,token=config.token;
  const key = `${pageId}:${igId}:${token}`;
  if (!force && checked?.key === key && Date.now() - checked.at < 60000) return checked.value;
  if (checking?.key === key) return checking.promise;
  const pending=(async ():Promise<Context>=>{
  const base:InstagramInboxStatus = { connected:true, accountId:igId, canRead:false, canSend:false, reason:'Instagram inbox access has not been checked.' };
  const signal=AbortSignal.timeout(9000);
  let value:Context;
  try {
    const request = (path:string, token:string, params:Record<string,string> = {}) => instagramGraphRequest({ graphBase:G(), path, token, params,signal });
    const permissions = await request('me/permissions', token, { limit:'100' });
    const granted = new Set((Array.isArray(permissions.data) ? permissions.data : []).filter((p:any) => p.status === 'granted').map((p:any) => p.permission));
    const missing = INSTAGRAM_INBOX_PERMISSIONS.filter(permission => !granted.has(permission));
    if (missing.length) value = { status: { ...base, reason:`Reconnect Meta with Instagram messaging access. Missing permissions: ${missing.join(', ')}.` } };
    else {
      const page = await request(pageId, token, { fields:'id,access_token,instagram_business_account{id}' });
      if (String(page.id) !== pageId || String(page.instagram_business_account?.id) !== igId || typeof page.access_token !== 'string' || !page.access_token) {
        value = { status:{ ...base, reason:'The selected Instagram account could not be verified against its linked Facebook Page. Check the Meta account selection.' } };
      } else {
        await request(`${pageId}/conversations`, page.access_token, { platform:'instagram', limit:'1', fields:'id' });
        let webhookConfigured = false;
        try {
          const subscriptions = await request(`${pageId}/subscribed_apps`, page.access_token, { fields:'id,subscribed_fields', limit:'100' });
          webhookConfigured = !!process.env.META_APP_ID && (subscriptions.data || []).some((app:any) => String(app.id) === process.env.META_APP_ID && app.subscribed_fields?.includes('messages'));
        } catch { /* Polling can work even when webhook subscription inspection is unavailable. */ }
        value = { pageId, igId, pageToken:page.access_token, status:{ ...base, canRead:true, canSend:true, webhookConfigured,
          reason: webhookConfigured ? 'Inbox access and message subscription verified. Replies require a reviewed draft and an open 24-hour window.'
            : 'Inbox access verified. Polling is available; configure the Instagram messages webhook for immediate delivery. Replies require review.' } };
      }
    }
  } catch (error) {
    const message = error instanceof Error && 'code' in error ? error.message : 'Instagram inbox access could not be checked. Retry or reconnect Meta with messaging access.';
    value = { status:{ ...base, reason:message } };
  }
  checked = { at:Date.now(), key, value };
  return value;
  })();
  checking={key,promise:pending};
  try{return await pending;}finally{if(checking?.promise===pending)checking=null;}
}

export async function instagramInboxStatus(): Promise<InstagramInboxStatus> {
  try { return (await inboxContext()).status; }
  catch { return { connected:false, canRead:false, canSend:false, reason:'The saved Meta connection could not be read. Check Admin connections.' }; }
}

export async function ingestInstagramMessages(db:SupabaseClient, messages:InstagramInboundMessage[]) {
  let imported = 0, duplicates = 0, deleted = 0;
  if (messages.length > 200) throw instagramInboxError('invalid_payload', 'Too many Instagram messages in one delivery.');
  for (const message of messages) {
    const { data, error } = await db.rpc('ingest_instagram_message', {
      p_account_id:message.accountId, p_message_id:message.messageId, p_sender_id:message.senderId,
      p_received_at:message.receivedAt, p_body:message.body, p_contact_name:message.contactName || '',
      p_conversation_ref:message.conversationRef, p_deleted:message.deleted,
    });
    if (error) throw instagramInboxError('instagram_storage', 'The Instagram message could not be saved. The provider can retry this delivery safely.');
    if (data?.deleted) deleted++;
    else if (data?.created) imported++;
    else duplicates++;
  }
  return { imported, duplicates, deleted };
}

type Cursor = { account_id?:string; pending?:{id:string;updated_time?:string}[]; after?:string|null; started_at?:string; done_at?:string };

/**
 * Bounded, resumable polling: one page of at most five conversations, at most
 * twenty recent messages per conversation (the provider's detail-read limit).
 * A saved pending conversation is removed only after all its messages commit.
 */
export async function syncInstagramInbox(db:SupabaseClient) {
  const holder = randomUUID();
  const { data:lock, error:lockError } = await db.rpc('acquire_job_lock', { p_name:'instagram_inbox', p_holder:holder, p_seconds:150 });
  if (lockError) throw instagramInboxError('instagram_storage', 'Instagram sync ownership could not be checked.');
  if (!lock) return { imported:0, duplicates:0, deleted:0, conversations:0, more:true, busy:true, summary:'Instagram inbox sync is already running.' };
  try {
    return await withAgentWork({ agentId:'crmLead', kind:'sync', timeoutMs:140000 }, async () => {
      const context = await inboxContext(true);
      if (!context.status.canRead || !context.pageId || !context.igId || !context.pageToken) throw instagramInboxError('instagram_permissions', context.status.reason);
      const pageId=context.pageId, igId=context.igId, pageToken=context.pageToken, name=`instagram_inbox:${igId}`, deadline=Date.now()+70000;
      const found = await db.from('sync_cursors').select('state').eq('name',name).maybeSingle();
      if (found.error) throw instagramInboxError('instagram_storage','Instagram sync progress could not be loaded.');
      let cursor:Cursor = found.data?.state || {};
      if (cursor.account_id !== igId || cursor.done_at) cursor={ account_id:igId, pending:[], after:null, started_at:new Date().toISOString() };
      const keep = async () => {
        const { error }=await db.from('sync_cursors').upsert({name,state:cursor,updated_at:new Date().toISOString()});
        if(error)throw instagramInboxError('instagram_storage','Instagram sync progress could not be saved.');
      };
      const request=(path:string,params:Record<string,string>)=>instagramGraphRequest({graphBase:G(),path,token:pageToken,params});
      if (!cursor.pending?.length) {
        const page=await request(`${pageId}/conversations`,{platform:'instagram',fields:'id,updated_time',limit:'5',...(cursor.after?{after:cursor.after}:{})});
        if(!Array.isArray(page.data))throw instagramInboxError('instagram_unavailable','Instagram returned an invalid conversation list.');
        cursor.pending=page.data.filter((row:any)=>typeof row.id==='string'&&row.id.length<=1024).map((row:any)=>({id:row.id,updated_time:row.updated_time}));
        cursor.after=page.paging?.next&&typeof page.paging?.cursors?.after==='string'?page.paging.cursors.after:null;
        await keep();
      }
      let imported=0,duplicates=0,deleted=0,conversations=0;
      while(cursor.pending?.length && Date.now()<deadline && conversations<5) {
        const current=cursor.pending[0];
        // Fields are expanded only for the twenty messages Meta allows us to inspect.
        const thread=await request(encodeURIComponent(current.id),{fields:'messages.limit(20){id,created_time,from,to,message}'});
        if(!Array.isArray(thread.messages?.data))throw instagramInboxError('instagram_unavailable','Instagram returned an invalid message list.');
        const incoming=thread.messages.data.map((row:any)=>normaliseInstagramMessage(row,{igId,pageId},current.id)).filter(Boolean) as InstagramInboundMessage[];
        const result=await ingestInstagramMessages(db,incoming);
        imported+=result.imported;duplicates+=result.duplicates;deleted+=result.deleted;conversations++;
        cursor.pending.shift();
        await keep();
      }
      const more=!!cursor.pending?.length || !!cursor.after;
      if(!more){cursor={account_id:igId,done_at:new Date().toISOString()};await keep();}
      const summary=`${imported} new Instagram enquiries saved; ${duplicates} already saved; ${conversations} conversations checked.${more?' More conversations remain for the next pass.':''} Coverage is limited to the latest 20 readable messages per conversation; older messages require manual handling.`;
      return { imported,duplicates,deleted,conversations,more,busy:false,summary };
    });
  } finally { await db.rpc('release_job_lock',{p_name:'instagram_inbox',p_holder:holder}); }
}

/** Call only after a reviewed action is durably claimed and the saved inquiry is rechecked. */
export async function sendInstagramReply(input:{recipientId:string;text:string;inquiryReceivedAt:string;accountId?:string;beforeSend?:()=>Promise<void>}) {
  validateInstagramReply(input);
  const context=await inboxContext(true);
  if(!context.status.canSend || !context.pageId || !context.igId || !context.pageToken)throw instagramInboxError('instagram_permissions',context.status.reason);
  if(input.accountId && input.accountId!==context.igId)throw instagramInboxError('account_mismatch','The saved enquiry belongs to a different Instagram account.');
  // Recheck the persisted inquiry/approval and pause state after provider reads.
  // The parent executor owns this callback and the durable outbound action claim.
  await input.beforeSend?.();
  return sendInstagramMessage({...input,accountId:context.igId,pageId:context.pageId,pageToken:context.pageToken,graphBase:G()});
}
