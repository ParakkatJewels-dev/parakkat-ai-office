import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  instagramWebhookToken, instagramVerificationChallenge, instagramSignatureValid, readInstagramWebhookBody,
  parseInstagramWebhook, normaliseInstagramMessage, instagramReplyAllowed, validateInstagramReply,
  instagramGraphRequest, sendInstagramMessage,
} from '../src/lib/connectors/instagram-inbox-core.mjs';

const now=Date.parse('2026-10-26T10:00:00Z'), account={igId:'111111',pageId:'222222'}, sender='333333';
const fakeSecret='unit-test-secret-not-a-provider-key';
const makePayload=(message={mid:'message-1',text:'Could you help me select a gift?'},overrides={})=>({object:'instagram',entry:[{id:account.igId,messaging:[{
  sender:{id:sender},recipient:{id:account.igId},timestamp:now-1000,message,...overrides,
}]}]});
const code=expected=>error=>error.code===expected;
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('webhook verification uses a deterministic app-secret-derived token without exposing the secret',()=>{
  const token=instagramWebhookToken(fakeSecret);
  assert.ok(token); assert.notEqual(token,fakeSecret);
  assert.equal(token,instagramWebhookToken(fakeSecret));
  assert.notEqual(token,instagramWebhookToken(`${fakeSecret}-different`));
  assert.equal(instagramWebhookToken('short'),null);
  assert.equal(instagramWebhookToken(fakeSecret,'dedicated-test-verification-token'),'dedicated-test-verification-token');
  const params=new URLSearchParams({'hub.mode':'subscribe','hub.challenge':'12345','hub.verify_token':token});
  assert.equal(instagramVerificationChallenge(params,token),'12345');
  params.set('hub.verify_token',`${token}x`); assert.equal(instagramVerificationChallenge(params,token),null);
  params.set('hub.verify_token',token); params.set('hub.challenge','<script>'); assert.equal(instagramVerificationChallenge(params,token),null);
  params.set('hub.challenge','123');params.set('hub.mode','unsubscribe');assert.equal(instagramVerificationChallenge(params,token),null);
});

test('only the exact raw body and SHA256 signature authenticate a webhook',()=>{
  const raw=Buffer.from(JSON.stringify(makePayload())),signature=`sha256=${createHmac('sha256',fakeSecret).update(raw).digest('hex')}`;
  assert.equal(instagramSignatureValid(raw,signature,fakeSecret),true);
  assert.equal(instagramSignatureValid(Buffer.concat([raw,Buffer.from(' ')]),signature,fakeSecret),false);
  assert.equal(instagramSignatureValid(raw,signature,'other-fixture-secret'),false);
  for(const invalid of [null,'','sha1=123',`sha256=${'z'.repeat(64)}`,`sha256=${'a'.repeat(63)}`])assert.equal(instagramSignatureValid(raw,invalid,fakeSecret),false);
});

test('body limits cover declared lengths and streamed bytes before buffering the whole request',async()=>{
  const valid=new Request('https://example.test',{method:'POST',body:'hello'});
  assert.equal((await readInstagramWebhookBody(valid,5)).toString(),'hello');
  await assert.rejects(readInstagramWebhookBody(new Request('https://example.test',{method:'POST',body:'hello!',headers:{'content-length':'6'}}),5),code('body_too_large'));
  await assert.rejects(readInstagramWebhookBody(new Request('https://example.test',{method:'POST',body:'hello!',headers:{'content-length':'1'}}),5),code('body_too_large'));
});

test('inbound webhooks preserve real IDs and timestamps without inventing customer details',()=>{
  const parsed=parseInstagramWebhook(makePayload(),account,now);
  assert.equal(parsed.events.length,1);
  assert.deepEqual(parsed.events[0],{accountId:account.igId,messageId:'message-1',senderId:sender,receivedAt:new Date(now-1000).toISOString(),body:'Could you help me select a gift?',contactName:'',conversationRef:null,deleted:false});
  assert.equal(parsed.ignored,0);
});

test('foreign accounts, recipients, malformed message IDs and timestamps are rejected',()=>{
  const foreign=makePayload();foreign.entry[0].id='999999';
  assert.throws(()=>parseInstagramWebhook(foreign,account,now),code('account_mismatch'));
  assert.throws(()=>parseInstagramWebhook(makePayload(undefined,{recipient:{id:'999999'}}),account,now),code('account_mismatch'));
  assert.throws(()=>parseInstagramWebhook(makePayload({text:'Missing ID'}),account,now),code('invalid_payload'));
  assert.throws(()=>parseInstagramWebhook(makePayload(undefined,{timestamp:now+3600000}),account,now),code('invalid_payload'));
  assert.throws(()=>parseInstagramWebhook(makePayload(undefined,{sender:{id:'https://evil.test'}}),account,now),code('invalid_payload'));
  assert.throws(()=>parseInstagramWebhook({object:'page',entry:[]},account,now),code('invalid_payload'));
});

test('echoes, self messages and non-message notifications never create customer work',()=>{
  for(const [message,overrides] of [
    [{mid:'echo',text:'Our reply',is_echo:true},{}],
    [{mid:'self',text:'Test',is_self:true},{}],
    [{mid:'sent',text:'Our reply'},{sender:{id:account.igId},recipient:{id:sender}}],
    [undefined,{message:undefined,read:{mid:'read'}}],
  ])assert.equal(parseInstagramWebhook(makePayload(message,overrides),account,now).events.length,0);
});

test('attachments use an explicit limitation note and deletion notifications become tombstones',()=>{
  const attached=parseInstagramWebhook(makePayload({mid:'attached',attachments:[{type:'image',payload:{url:'http://internal.example/secret'}}]}),account,now).events[0];
  assert.match(attached.body,/attachment or unsupported/);assert.doesNotMatch(attached.body,/internal/);
  const deleted=parseInstagramWebhook(makePayload({mid:'deleted',text:'Do not retain this',is_deleted:true}),account,now).events[0];
  assert.equal(deleted.deleted,true);assert.doesNotMatch(deleted.body,/retain/);
  const payload=makePayload();payload.entry[0].messaging.push(payload.entry[0].messaging[0]);
  assert.equal(parseInstagramWebhook(payload,account,now).events.length,1);
});

test('polled message normalization accepts only inbound messages to the selected IG account',()=>{
  const sample={id:'graph-message',created_time:new Date(now-2000).toISOString(),from:{id:sender,username:'actual_user'},to:{data:[{id:account.igId}]},message:'Hello'};
  const result=normaliseInstagramMessage(sample,account,'real-conversation',now);
  assert.equal(result.contactName,'actual_user');assert.equal(result.conversationRef,'real-conversation');
  assert.equal(normaliseInstagramMessage({...sample,from:{id:account.igId}},account,null,now),null);
  assert.equal(normaliseInstagramMessage({...sample,to:{data:[{id:'999999'}]}},account,null,now),null);
  assert.equal(normaliseInstagramMessage({...sample,created_time:'not a date'},account,null,now),null);
  const unnamed=normaliseInstagramMessage({...sample,from:{id:sender}},account,null,now);
  assert.equal(unnamed.contactName,'');
});

test('reply authorization uses the provider timestamp, exact 24-hour boundary, and UTF-8 bytes',()=>{
  const input={recipientId:sender,text:'Reviewed reply',inquiryReceivedAt:new Date(now-1000).toISOString(),accountId:account.igId,pageId:account.pageId};
  assert.deepEqual(validateInstagramReply(input,now),{recipient:{id:sender},message:{text:'Reviewed reply'}});
  assert.equal(instagramReplyAllowed(new Date(now-86400000+1).toISOString(),now),true);
  assert.equal(instagramReplyAllowed(new Date(now-86400000).toISOString(),now),false);
  assert.equal(instagramReplyAllowed(new Date(now+1).toISOString(),now),false);
  assert.throws(()=>validateInstagramReply({...input,inquiryReceivedAt:'not known'},now),code('reply_window_closed'));
  assert.throws(()=>validateInstagramReply({...input,text:'അ'.repeat(334)},now),code('invalid_reply'));
  assert.throws(()=>validateInstagramReply({...input,recipientId:account.igId},now),code('invalid_recipient'));
  assert.equal(validateInstagramReply({...input,text:'a'.repeat(1000)},now).message.text.length,1000);
});

test('Graph requests pin the host, reject redirects and never put credentials in URLs',async()=>{
  let seen;
  const result=await instagramGraphRequest({graphBase:'https://graph.facebook.com/v26.0',path:'222222/conversations',token:'fake-page-token',params:{platform:'instagram'},fetchImpl:async(url,init)=>{
    seen={url:String(url),init};return response({data:[]});
  }});
  assert.deepEqual(result,{data:[]});assert.equal(seen.init.redirect,'error');
  assert.equal(seen.init.headers.authorization,'Bearer fake-page-token');assert.doesNotMatch(seen.url,/fake-page-token|access_token/);
  for(const options of [{graphBase:'https://evil.test/v26.0',path:'me'},{graphBase:'https://graph.facebook.com/v26.0',path:'../me'},{graphBase:'https://graph.facebook.com/v26.0',path:'%2e%2e/me'}]){
    await assert.rejects(instagramGraphRequest({...options,token:'test',fetchImpl:()=>{throw new Error('Must not fetch');}}),error=>['invalid_path','invalid_configuration'].includes(error.code));
  }
});

test('provider errors are sanitized, including errors containing credentials or customer data',async()=>{
  await assert.rejects(instagramGraphRequest({graphBase:'https://graph.facebook.com/v26.0',path:'me/permissions',token:'private-fixture-token',fetchImpl:async()=>response({error:{code:190,message:'private-fixture-token customer sensitive text'}},400)}),error=>{
    assert.equal(error.code,'instagram_auth');assert.doesNotMatch(error.message,/private-fixture-token|sensitive/);return true;
  });
});

test('sending uses exactly one Page-token POST with the saved recipient and returns a matching receipt',async()=>{
  let calls=0;
  const sent=await sendInstagramMessage({graphBase:'https://graph.facebook.com/v26.0',pageId:account.pageId,pageToken:'fake-page-token',recipientId:sender,text:'Reviewed reply',inquiryReceivedAt:new Date(now-1000).toISOString(),accountId:account.igId},{now,fetchImpl:async(url,init)=>{
    calls++;assert.equal(String(url),'https://graph.facebook.com/v26.0/222222/messages');assert.equal(init.method,'POST');
    assert.deepEqual(JSON.parse(init.body),{recipient:{id:sender},message:{text:'Reviewed reply'}});
    return response({recipient_id:sender,message_id:'provider-receipt'});
  }});
  assert.equal(calls,1);assert.deepEqual(sent,{messageId:'provider-receipt'});
});

test('ambiguous sends are never retried and require provider review',async()=>{
  const input={graphBase:'https://graph.facebook.com/v26.0',pageId:account.pageId,pageToken:'fake-page-token',recipientId:sender,text:'Reviewed reply',inquiryReceivedAt:new Date(now-1000).toISOString(),accountId:account.igId};
  for(const behaviour of [async()=>{throw new Error('Timeout with fake-page-token');},async()=>response({}),async()=>response({recipient_id:'999999',message_id:'receipt'}),async()=>response({error:{message:'Private provider detail'}},500)]){
    let calls=0;
    await assert.rejects(sendInstagramMessage(input,{now,fetchImpl:async()=>{calls++;return behaviour();}}),error=>{
      assert.equal(error.code,'instagram_send_review');assert.equal(error.requiresReview,true);assert.doesNotMatch(error.message,/fake-page-token|Private provider detail/);return true;
    });
    assert.equal(calls,1);
  }
});

test('expired or oversized replies cause no provider request',async()=>{
  const input={graphBase:'https://graph.facebook.com/v26.0',pageId:account.pageId,pageToken:'fake-page-token',recipientId:sender,text:'Reviewed reply',inquiryReceivedAt:new Date(now-86400001).toISOString(),accountId:account.igId};
  let calls=0;
  await assert.rejects(sendInstagramMessage(input,{now,fetchImpl:async()=>{calls++;return response({});}}),code('reply_window_closed'));
  assert.equal(calls,0);
});
