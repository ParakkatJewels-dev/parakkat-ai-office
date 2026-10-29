import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinateConversation, conversationDialogueEvent, normalizeConversationPlan, normalizeConversationReply, conversationFailure } from '../src/lib/agents/conversation-core.mjs';
import { createChatGPTClient } from '../src/lib/llm/chatgpt.mjs';

const agents = [
  { id: 'host', name: 'Host', department_id: 'creative', role_desc: 'Creative lead', enabled: true, is_lead: true },
  { id: 'copy', name: 'Copywriter', department_id: 'creative', role_desc: 'Copywriter', enabled: true, is_lead: false },
  { id: 'brand', name: 'Brand', department_id: 'creative', role_desc: 'Brand review', enabled: true, is_lead: false },
  { id: 'off', name: 'Off', department_id: 'creative', role_desc: 'Disabled', enabled: false, is_lead: false },
];

test('model routing filters inaccessible colleagues and caps ordinary work at one specialist, explicit meetings at two', () => {
  const roster = [...agents, { id: 'seo', name: 'SEO', department_id: 'creative', enabled: true }];
  const request = { meetingRequested: true, delegations: [
    { agentId: 'hidden', task: 'read hidden reports' }, { agentId: 'host', task: 'self delegate' },
    { agentId: 'off', task: 'disabled' }, { agentId: 'copy', task: 'Write' },
    { agentId: 'copy', task: 'Again' }, { agentId: 'brand', task: 'Review' },
    { agentId: 'seo', task: 'Third specialist' },
  ] };
  assert.deepEqual(normalizeConversationPlan(request, roster, 'host').delegations,
    [{ agentId: 'copy', task: 'Write' }], 'the model cannot upgrade an ordinary task to a meeting');
  assert.deepEqual(normalizeConversationPlan(request, roster, 'host', true).delegations,
    [{ agentId: 'copy', task: 'Write' }, { agentId: 'brand', task: 'Review' }]);
  const scoped = normalizeConversationPlan({ delegations: [{ agentId: 'brand', task: 'Hidden department' }] }, agents.slice(0, 2), 'host');
  assert.equal(scoped.delegations.length, 0, 'an agent absent from requester scope cannot receive a task');
});

test('a requested meeting uses an available colleague and never adds an inaccessible one', () => {
  assert.equal(normalizeConversationPlan({}, agents, 'host', true).delegations[0].agentId, 'copy');
  assert.deepEqual(normalizeConversationPlan({}, [agents[0]], 'host', true).delegations, []);
});

test('invalid or empty model replies cannot be posted as successful work', () => {
  for (const value of [null, [], 'text', {}, { reply: {} }, { reply: '   ' }]) assert.throws(() => normalizeConversationReply(value), /invalid_reply/);
  assert.equal(normalizeConversationReply({ reply: 'A'.repeat(100_000) }).length, 6000);
});

test('real meeting turns see earlier contributions and only completed calls are saved', async () => {
  const calls = [], saved = [], finished = [];
  const result = await coordinateConversation({ host: agents[0], agents, prompt: 'Write a campaign concept', meetingRequested: true,
    ask: async (agent, step) => {
      calls.push({ agent: agent.id, step: structuredClone(step) });
      if (step.phase === 'plan') return { title: 'Campaign', opening: 'Compare copy and brand fit.', delegations: [{ agentId: 'copy', task: 'Write the headline' }, { agentId: 'brand', task: 'Review the headline' }] };
      if (agent.id === 'copy') return { reply: 'Headline: Made for Every Day.' };
      if (agent.id === 'brand') {
        assert.ok(step.transcript.some(t => t.agentId === 'copy' && t.content.includes('Made for Every Day')));
        return { reply: 'The headline fits our warm brand voice.' };
      }
      assert.deepEqual(step.transcript.map(t => t.agentId), ['host', 'copy', 'brand']);
      return { reply: 'Draft headline: Made for Every Day. Copywriter drafted it; Brand reviewed the wording.' };
    },
    message: async m => saved.push(structuredClone(m)),
    startMeeting: async (_, participants) => { assert.deepEqual(participants, ['host', 'copy', 'brand']); return 'meeting1'; },
    finishMeeting: async (id, summary) => finished.push({ id, summary }),
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(saved.filter(m => m.role === 'meeting').map(m => m.agentId), ['host', 'copy', 'brand']);
  assert.equal(saved.at(-1).role, 'assistant');
  assert.equal(finished[0].summary, result.reply);
});

test('a simple status answer makes one call without fake handoffs or a fake meeting', async () => {
  let calls = 0;
  const saved = [];
  const result = await coordinateConversation({ host: agents[0], agents, prompt: 'What are you doing?', meetingRequested: false,
    ask: async () => { calls++; return { answer: 'My latest recorded work was reviewing a product image. No active task is confirmed.', delegations: [] }; },
    message: async m => saved.push(m), startMeeting: async () => { throw new Error('must not meet'); }, finishMeeting: async () => { throw new Error('must not finish meeting'); },
  });
  assert.equal(calls, 1); assert.equal(result.meetingId, null);
  assert.deepEqual(saved.map(m => m.role), ['progress', 'assistant']);
});

test('ordinary delegation uses one directed desk exchange and synthesizes only its actual reply without creating a meeting', async () => {
  const calls=[],saved=[],events=[];
  const result=await coordinateConversation({host:agents[0],agents,prompt:'Ask Copywriter for a headline and Brand for a review',meetingRequested:false,
    ask:async(agent,step)=>{
      calls.push({agent:agent.id,step:structuredClone(step)});assert.equal(step.meetingRequested,false);
      if(step.phase==='plan')return {title:'Headline',opening:'Unused meeting agenda',answer:'Premature answer must not bypass coordination',delegations:[{agentId:'copy',task:'Draft the headline'},{agentId:'brand',task:'Review the draft'}]};
      if(agent.id==='copy'){assert.deepEqual(step.transcript,[{agentId:'host',name:'Host',content:'Draft the headline'}]);return {reply:'Made for Every Day.'};}
      assert.equal(agent.id,'host','the second specialist must not be called');
      assert.deepEqual(step.transcript.map(t=>t.agentId),['host','copy']);return {reply:'The copywriter drafted Made for Every Day. A separate brand review has not been performed.'};
    },
    message:async m=>{saved.push(structuredClone(m));const event=conversationDialogueEvent(m,{taskId:'task1',threadId:'thread1',hostAgentId:'host',messageId:`message${saved.length}`});if(event)events.push(event);},
    startMeeting:async()=>{throw new Error('ordinary coordination must not summon a meeting');},finishMeeting:async()=>{throw new Error('no meeting exists');},
  });
  assert.equal(calls.length,3);assert.equal(result.meetingId,null);assert.deepEqual(result.participants,['host','copy']);
  assert.equal(saved.some(m=>m.role==='meeting'||m.meetingId),false);
  assert.deepEqual(saved.filter(m=>m.metadata?.interaction_mode==='direct').map(m=>[m.agentId,m.recipientAgentId,m.metadata.dialogue_phase]),[
    ['host','copy','request'],['copy','host','response'],
  ]);
  assert.deepEqual(events.map(e=>[e.kind,e.from,e.to]),[['walk','host','copy'],['report','copy','host']]);
  assert.deepEqual(events.map(e=>e.payload.dialogue_id),['task1:copy','task1:copy']);
  assert.ok(events.every(e=>e.payload.visitor_agent_id==='host'&&e.payload.host_agent_id==='host'));
  assert.deepEqual(events.map(e=>e.payload.recipient_agent_id),['copy','copy']);
  assert.equal(saved.at(-1).metadata.phase,'answer');assert.equal(saved.at(-1).content,result.reply);
});

test('shared dialogue events expose exact message routing, never private task or response text',()=>{
  const message={role:'assistant',agentId:'copy',recipientAgentId:'host',content:'PRIVATE product margin and manager request',metadata:{interaction_mode:'direct',dialogue_phase:'response',private_extra:'PRIVATE'}};
  const context={taskId:'task-uuid',threadId:'thread-uuid',hostAgentId:'host',messageId:'exact-saved-message-uuid'};
  const event=conversationDialogueEvent(message,context);
  assert.equal(event.payload.message_id,context.messageId);assert.equal(event.payload.thread_id,context.threadId);assert.equal(event.payload.task_id,context.taskId);
  assert.doesNotMatch(JSON.stringify(event),/PRIVATE|margin/);
  assert.equal(conversationDialogueEvent({...message,meetingId:'meeting1'},context),null);
  assert.equal(conversationDialogueEvent({...message,metadata:{phase:'answer'}},context),null);
  assert.equal(conversationDialogueEvent({...message,recipientAgentId:undefined},context),null);
});

test('failed direct specialist never produces a reply event, synthesis, or group meeting',async()=>{
  const saved=[];
  await assert.rejects(coordinateConversation({host:agents[0],agents,prompt:'Ask Copywriter',meetingRequested:false,
    ask:async(_,step)=>{if(step.phase==='plan')return {delegations:[{agentId:'copy',task:'Draft'}]};throw new Error('provider unavailable');},
    message:async m=>saved.push(m),startMeeting:async()=>{throw new Error('must not create meeting');},finishMeeting:async()=>{throw new Error('must not finish meeting');},
  }),/provider unavailable/);
  assert.deepEqual(saved.map(m=>m.role),['progress','handoff']);
  assert.equal(saved.at(-1).metadata.dialogue_phase,'request');
});

test('a failed specialist leaves completed work intact and never fabricates its contribution or final summary', async () => {
  const saved = [];
  await assert.rejects(coordinateConversation({ host: agents[0], agents, prompt: 'Discuss', meetingRequested: true,
    ask: async (_, step) => {
      if (step.phase === 'plan') return { opening: 'Review the draft.', delegations: [{ agentId: 'copy', task: 'Write' }, { agentId: 'brand', task: 'Review' }] };
      if (step.assignment === 'Write') return { reply: 'Completed draft.' };
      throw new Error('provider unavailable');
    },
    message: async m => saved.push(m), startMeeting: async () => 'm1', finishMeeting: async () => { throw new Error('must not finish'); },
  }), /provider unavailable/);
  assert.ok(saved.some(m => m.agentId === 'copy' && m.content === 'Completed draft.'));
  assert.ok(!saved.some(m => m.agentId === 'brand' || m.role === 'assistant'));
});

test('provider secrets and raw error bodies are never included in public task failures', () => {
  const secret = 'secret-api-value';
  for (const error of [new Error(secret), { code: 'request_failed', message: secret }, { name: 'TimeoutError', message: secret }]) assert.ok(!conversationFailure(error).includes(secret));
  assert.match(conversationFailure({ code: 'usage_limit' }), /usage limit/);
});

test('app text-budget failures show a safe allowance or input-limit explanation without promising automatic chat retries',()=>{
  const error={code:'ai_budget',reason:'daily_tokens',retryAt:'2026-10-27T10:00:00Z',message:'secret provider detail'};
  assert.match(conversationFailure(error),/configured text-work allowance/);assert.match(conversationFailure(error),/2026-10-27T10:00:00.000Z/);
  assert.match(conversationFailure({...error,reason:'input_too_long',retryAt:null}),/Shorten the request/);
  assert.match(conversationFailure({...error,reason:'budget_unavailable',retryAt:null}),/could not be checked/);
  assert.doesNotMatch(conversationFailure({...error,retryAt:'secret-token'}),/secret|automatically/);
});

test('conversation timeout signal reaches the actual ChatGPT provider request', async () => {
  const controller = new AbortController();
  let providerSignal;
  const client = createChatGPTClient({
    getAuthContext: async () => ({ accountId: 'fake', accessToken: 'fake-token', models: { manager: 'test-model', worker: 'test-model' }, usageBlocked: false }),
    fetch: async (url, options) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ models: [{ slug: 'test-model', visibility: 'list' }] }), { status: 200 });
      providerSignal = options.signal;
      return new Promise((_, reject) => {
        providerSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        controller.abort();
      });
    },
  });
  await assert.rejects(client.chatGPTJSON('manager', 'System', 'Question', { signal: controller.signal, timeoutMs: 5000 }), /timed out/);
  assert.equal(providerSignal.aborted, true);
});
