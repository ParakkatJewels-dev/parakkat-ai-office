import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeResponsesStream, createChatGPTClient, chatGPTJSON } from '../src/lib/llm/chatgpt.mjs';

const encode = new TextEncoder();
const event = value => `data: ${JSON.stringify(value)}\n\n`;
function stream(value, chunkSize = 17) {
  const bytes = encode.encode(value);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}
const complete = (text, extra = {}) => ({
  type: 'response.completed', response: {
    status: 'completed', model: 'account-model',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 51, output_tokens: 12 }, ...extra,
  },
});
const context = () => Promise.resolve({ accessToken: 'test-token', accountId: 'account-1', models: { manager: null, worker: null } });
const models = () => Response.json({ models: [
  { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' },
  { slug: 'account-model', display_name: 'Account model', visibility: 'list' },
  { slug: 'worker-model', display_name: 'Worker model', visibility: 'list' },
] });
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test('reads split UTF-8, CRLF, comments, multiline data, and completed usage', async () => {
  const result = await consumeResponsesStream(stream([
    ': heartbeat\r\n\r\n',
    event({ type: 'response.output_text.delta', delta: '{"name":"' }),
    event({ type: 'response.output_text.delta', delta: 'പറക്കാട്ട്"}' }),
    `event: response.completed\r\ndata: {"type":"response.completed",\r\ndata: "response":${JSON.stringify(complete('{"name":"പറക്കാട്ട്"}').response)}}\r\n\r\n`,
  ].join(''), 1));
  assert.equal(JSON.parse(result.text).name, 'പറക്കാട്ട്');
  assert.equal(result.inputTokens, 51);
  assert.equal(result.outputTokens, 12);
  assert.equal(result.model, 'account-model');
});

test('uses authoritative final output and supports completion without text deltas', async () => {
  const result = await consumeResponsesStream(stream(event({ type: 'response.output_text.delta', delta: '{"partial":' }) + event(complete('{"done":true}'))));
  assert.deepEqual(JSON.parse(result.text), { done: true });
  assert.deepEqual(JSON.parse((await consumeResponsesStream(stream(event(complete('{"answer":42}'))))).text), { answer: 42 });
});

test('partial JSON and DONE without completed cannot become a successful answer', async () => {
  const partial = event({ type: 'response.output_text.delta', delta: '{"answer":42}' });
  await rejectsCode(consumeResponsesStream(stream(partial)), 'interrupted');
  await rejectsCode(consumeResponsesStream(stream(partial + 'data: [DONE]\n\n')), 'interrupted');
});

test('plan failures after deltas produce actionable errors without remote text', async () => {
  const partial = event({ type: 'response.output_text.delta', delta: '{"answer":42}' });
  const failure = event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'secret-upstream-detail' } } });
  await assert.rejects(consumeResponsesStream(stream(partial + failure)), error => error.code === 'usage_limit' && !error.message.includes('secret-upstream-detail'));
  await rejectsCode(consumeResponsesStream(stream(event({ type: 'error', code: 'subscription_sharing_usage_unavailable' }))), 'usage_unavailable');
});

test('rejects incomplete, refusal, missing completion status, empty, and corrupt streams', async () => {
  await rejectsCode(consumeResponsesStream(stream(event({ type: 'response.incomplete', response: { status: 'incomplete' } }))), 'incomplete');
  await rejectsCode(consumeResponsesStream(stream(event({ type: 'response.refusal.delta', delta: 'No' }) + event(complete('{}')))), 'refusal');
  await rejectsCode(consumeResponsesStream(stream(event(complete('{}', { output: [{ content: [{ type: 'refusal', refusal: 'No' }] }] })))), 'refusal');
  await rejectsCode(consumeResponsesStream(stream(event(complete('{}', { status: 'failed' })))), 'incomplete');
  await rejectsCode(consumeResponsesStream(stream(event(complete('', { output: [] })))), 'empty_response');
  await rejectsCode(consumeResponsesStream(stream('data: {broken}\n\n')), 'invalid_stream');
  await rejectsCode(consumeResponsesStream(stream('data: null\n\n')), 'invalid_stream');
  await rejectsCode(consumeResponsesStream(null), 'interrupted');
});

test('bounds response text and overall stream bytes', async () => {
  await rejectsCode(consumeResponsesStream(stream(event({ type: 'response.output_text.delta', delta: '12345' })), { maxTextBytes: 4 }), 'response_too_large');
  await rejectsCode(consumeResponsesStream(stream(': heartbeat\n\n'.repeat(100)), { maxBytes: 30 }), 'response_too_large');
});

test('terminal validation failures retain usage without retaining response content', async () => {
  for (const [terminal, options, code] of [
    [complete('private-output', { status: 'incomplete' }), {}, 'incomplete'],
    [complete('private-output'), { maxTextBytes: 4 }, 'response_too_large'],
    [complete({ private: 'output' }), {}, 'invalid_stream'],
  ]) {
    await assert.rejects(consumeResponsesStream(stream(event(terminal)), options), error => {
      assert.equal(error.code, code);
      assert.deepEqual(error.usage, { model: 'account-model', inputTokens: 51, outputTokens: 12, usageKnown: true, reasoningTokens: null });
      assert.equal(JSON.stringify(error).includes('private'), false);
      return true;
    });
  }
});

test('selects the signed-in catalog default and sends the supported OAuth Responses request', async () => {
  const requests = [];
  let contextReads = 0;
  const client = createChatGPTClient({
    getAuthContext: async () => { contextReads++; return context(); }, env: {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      return url.endsWith('/models') ? models() : new Response(stream(event(complete('{"answer":42}'))));
    },
  });
  const result = await client.chatGPTJSON('manager', 'Help the team.', 'Report.');
  assert.deepEqual(result, { value: { answer: 42 }, model: 'account-model', inputTokens: 51, outputTokens: 12, usageKnown:true, reasoningTokens:null });
  assert.equal(contextReads, 1);
  assert.deepEqual(requests.map(request => request.url), ['https://api.openai.com/v1/models', 'https://api.openai.com/v1/responses']);
  assert.ok(requests.every(request => request.options.headers.authorization === 'Bearer test-token'));
  assert.ok(requests.every(request => request.options.redirect === 'error' && request.options.cache === 'no-store'));
  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.model, 'account-model');
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.deepEqual(body.input, [{ role: 'user', content: 'Report.' }]);
  assert.match(body.instructions, /^Help the team\./);
  assert.equal(body.max_output_tokens,2400);
  assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'max_output_tokens', 'model', 'store', 'stream']);
});

test('environment overrides account model selection and unavailable models stop before inference', async () => {
  let inferenceCalls = 0, chosen;
  const client = createChatGPTClient({
    getAuthContext: async () => ({ ...await context(), models: { manager: 'account-model', worker: 'worker-model' } }),
    env: { CHATGPT_MANAGER_MODEL: 'worker-model', CHATGPT_WORKER_MODEL: 'not-for-this-account' },
    fetch: async (url, options) => {
      if (url.endsWith('/models')) return models();
      inferenceCalls++; chosen = JSON.parse(options.body).model;
      return new Response(stream(event(complete('{}'))));
    },
  });
  await client.chatGPTJSON('manager', 'System', 'User');
  assert.equal(chosen, 'worker-model');
  await rejectsCode(client.chatGPTJSON('worker', 'System', 'User'), 'model_unavailable');
  assert.equal(inferenceCalls, 1);
});

test('model picker filters hidden models, retains server ordering, and detects a switched account', async () => {
  let calls = 0;
  const client = createChatGPTClient({ getAuthContext: context, fetch: async () => { calls++; return models(); } });
  assert.deepEqual(await client.listChatGPTModels('account-1'), [
    { slug: 'account-model', display_name: 'Account model' }, { slug: 'worker-model', display_name: 'Worker model' },
  ]);
  await rejectsCode(client.listChatGPTModels('account-2'), 'account_changed');
  assert.equal(calls, 1);
});

test('completed answers must contain a JSON object', async () => {
  for (const text of ['null', '[]', '42', '"hello"', '```json\n{}\n```', '{broken}']) {
    const client = createChatGPTClient({ getAuthContext: context, env: {}, fetch: async url => url.endsWith('/models') ? models() : new Response(stream(event(complete(text)))) });
    await rejectsCode(client.chatGPTJSON('worker', 'System', 'User'), 'invalid_json');
  }
});
test('incomplete and invalid JSON responses retain measured usage without exposing response content',async()=>{
  const usage={input_tokens:321,output_tokens:800,output_tokens_details:{reasoning_tokens:200}};
  const incomplete={type:'response.incomplete',response:{status:'incomplete',model:'account-model',usage,output:[{text:'private unfinished content'}]}};
  await assert.rejects(consumeResponsesStream(stream(event(incomplete))),error=>{
    assert.equal(error.code,'incomplete');assert.deepEqual(error.usage,{model:'account-model',inputTokens:321,outputTokens:800,usageKnown:true,reasoningTokens:200});
    assert.ok(!JSON.stringify(error).includes('private unfinished'));return true;
  });
  const client=createChatGPTClient({getAuthContext:context,env:{},fetch:async url=>url.endsWith('/models')?models():new Response(stream(event(complete('private invalid answer',{usage}))))});
  await assert.rejects(client.chatGPTJSON('worker','System','User'),error=>{
    assert.equal(error.code,'invalid_json');assert.equal(error.usage.inputTokens,321);assert.equal(error.usage.outputTokens,800);
    assert.ok(!JSON.stringify(error).includes('private invalid answer'));return true;
  });
  await assert.rejects(consumeResponsesStream(stream(event({...incomplete,response:{...incomplete.response,usage:{input_tokens:321}}}))),error=>error.code==='incomplete'&&error.usage===undefined);
});

test('HTTP failures and network errors do not expose upstream response text', async () => {
  const client = createChatGPTClient({ getAuthContext: context, fetch: async () => Response.json({ error: { message: 'token-value' } }, { status: 401 }) });
  await assert.rejects(client.listChatGPTModels(), error => error.code === 'authentication' && !error.message.includes('token-value'));
  const failed = createChatGPTClient({ getAuthContext: context, fetch: async () => { throw new Error('secret-url?token=value'); } });
  await assert.rejects(failed.listChatGPTModels(), error => error.code === 'network' && !error.message.includes('secret-url'));
});

test('a confirmed plan limit stops further requests for the captured account until explicit resume', async () => {
  let calls = 0, limited = true, usageBlocked = false;
  const marked = [], cleared = [];
  const client = createChatGPTClient({
    getAuthContext: async () => ({ ...await context(), usageBlocked }), env: {},
    markAccountUsageBlocked: async id => { marked.push(id); usageBlocked = true; },
    clearAccountUsageBlock: async id => { cleared.push(id); usageBlocked = false; },
    fetch: async url => {
      calls++;
      if (url.endsWith('/models')) return models();
      return new Response(stream(limited ? event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }) : event(complete('{}'))));
    },
  });
  await rejectsCode(client.chatGPTJSON('worker', 'System', 'User'), 'usage_limit');
  assert.deepEqual(marked, ['account-1']);
  await rejectsCode(client.chatGPTJSON('worker', 'System', 'User'), 'usage_paused');
  assert.equal(calls, 2, 'blocked attempts make no model or inference request');
  limited = false;
  await client.resumeChatGPTUsage('account-1');
  assert.deepEqual(cleared, ['account-1']);
  await client.chatGPTJSON('worker', 'System', 'User');
  assert.equal(calls, 3, 'resuming reuses the same account model catalog');
});

test('a failed usage-stop write backs off locally without preventing later recovery', async () => {
  let time = Date.now(), calls = 0;
  const client = createChatGPTClient({
    getAuthContext: context, now: () => time, env: {},
    markAccountUsageBlocked: async () => { throw new Error('disk unavailable'); },
    fetch: async () => { calls++; return Response.json({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, { status: 429 }); },
  });
  await rejectsCode(client.chatGPTJSON('worker', 'System', 'User'), 'usage_limit');
  await rejectsCode(client.chatGPTJSON('worker', 'System', 'User'), 'usage_paused');
  assert.equal(calls, 1);
  time += 5 * 60_000 + 1;
  await rejectsCode(client.chatGPTJSON('worker', 'System', 'User'), 'usage_limit');
  assert.equal(calls, 2);
});

test('a persisted account limit prevents inference after process restart', async () => {
  let calls = 0;
  const client = createChatGPTClient({ getAuthContext: async () => ({ ...await context(), usageBlocked: true }), fetch: async () => { calls++; return models(); } });
  await rejectsCode(client.chatGPTJSON('worker', 'System', 'User'), 'usage_paused');
  assert.equal(calls, 0);
  assert.equal((await client.listChatGPTModels()).length, 2, 'the model catalog remains available while usage is paused');
});

test('temporary rate limits and availability failures do not persistently stop the account', async () => {
  for (const [status, code, expected] of [[429, 'rate_limit_exceeded', 'rate_limit'], [503, 'subscription_sharing_usage_unavailable', 'usage_unavailable']]) {
    let marked = false, calls = 0;
    const client = createChatGPTClient({
      getAuthContext: context, markAccountUsageBlocked: async () => { marked = true; },
      fetch: async () => { calls++; return Response.json({ error: { code } }, { status }); },
    });
    await rejectsCode(client.chatGPTJSON('worker', 'System', 'User'), expected);
    await rejectsCode(client.chatGPTJSON('worker', 'System', 'User'), expected);
    assert.equal(marked, false);
    assert.equal(calls, 2);
  }
});

test('exported inference forwards caller cancellation before loading credentials or reaching the network',async()=>{
  const control=new AbortController(),reason=new Error('task lease ended');control.abort(reason);
  await assert.rejects(chatGPTJSON('worker','system','user',{signal:control.signal,timeoutMs:1,maxOutputTokens:256}),error=>error===reason);
});

test('output token caps are explicit and bounded, with low reasoning for supported models only',async()=>{
  const sent=[];
  const client=createChatGPTClient({getAuthContext:context,env:{},fetch:async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({models:[{slug:'gpt-6.1-sol',visibility:'list'}]});
    sent.push(JSON.parse(options.body));return new Response(stream(event(complete('{}'))));
  }});
  for(const maxOutputTokens of [undefined,1,99999,800,NaN])await client.chatGPTJSON('worker','System','User',{maxOutputTokens});
  assert.deepEqual(sent.map(row=>row.max_output_tokens),[2400,256,8000,800,2400]);
  assert.ok(sent.every(row=>row.reasoning.effort==='low'));
});

test('captured budget/cache account and model cannot be silently switched before inference',async()=>{
  let catalogCalls=0,inferenceCalls=0;
  const client=createChatGPTClient({getAuthContext:context,env:{},fetch:async url=>{
    if(url.endsWith('/models')){catalogCalls++;return models();}
    inferenceCalls++;return new Response(stream(event(complete('{}'))));
  }});
  await rejectsCode(client.chatGPTJSON('worker','system','user',{expectedAccountId:'previous-account'}),'account_changed');assert.equal(catalogCalls,0);
  await rejectsCode(client.chatGPTJSON('worker','system','user',{expectedAccountId:'account-1',expectedModel:'previous-model'}),'model_changed');assert.equal(catalogCalls,1);assert.equal(inferenceCalls,0);
  await client.chatGPTJSON('worker','system','user',{expectedAccountId:'account-1',expectedModel:'account-model'});assert.equal(inferenceCalls,1);
});

test('model catalog is cached five minutes, account/token isolated, refreshable, and copied for callers',async()=>{
  let time=1000,calls=0,accountId='first',accessToken='one';
  const client=createChatGPTClient({now:()=>time,getAuthContext:async()=>({...await context(),accountId,accessToken}),fetch:async()=>{calls++;return models();}});
  const first=await client.listChatGPTModels(undefined,{refresh:false});first[0].slug='mutated';
  assert.equal((await client.listChatGPTModels(undefined,{refresh:false}))[0].slug,'account-model');assert.equal(calls,1);
  time+=299999;await client.listChatGPTModels(undefined,{refresh:false});assert.equal(calls,1);
  time++;await client.listChatGPTModels(undefined,{refresh:false});assert.equal(calls,2);
  accountId='second';await client.listChatGPTModels(undefined,{refresh:false});assert.equal(calls,3);
  accessToken='rotated';await client.listChatGPTModels(undefined,{refresh:false});assert.equal(calls,4);
  await client.listChatGPTModels();assert.equal(calls,5,'explicit model picker refresh checks current provider availability');
});

test('parallel callers share catalog work but cancellation never cancels another caller',async()=>{
  let release,catalogCalls=0,inferenceCalls=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const client=createChatGPTClient({getAuthContext:context,env:{},fetch:async url=>{
    if(url.endsWith('/models')){catalogCalls++;await pending;return models();}
    inferenceCalls++;return new Response(stream(event(complete('{}'))));
  }});
  const control=new AbortController(),first=client.chatGPTJSON('worker','system','user',{signal:control.signal}),second=client.chatGPTJSON('worker','system','user');
  const rejected=assert.rejects(first,error=>error.name==='AbortError');
  await new Promise(resolve=>setImmediate(resolve));control.abort();await rejected;
  release();await second;assert.equal(catalogCalls,1);assert.equal(inferenceCalls,1);
});

test('caller timeout during catalog lookup prevents inference and failed catalogs are not cached',async()=>{
  let release,calls=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const client=createChatGPTClient({getAuthContext:context,env:{},fetch:async()=>{calls++;await pending;return models();}});
  const rejected=assert.rejects(client.chatGPTJSON('worker','system','user',{timeoutMs:5}),error=>error.name==='TimeoutError');
  await new Promise(resolve=>setTimeout(resolve,15));await rejected;release();assert.equal(calls,1);
  let attempts=0;
  const failing=createChatGPTClient({getAuthContext:context,fetch:async()=>{attempts++;return attempts===1?Response.json({error:{}},{status:503}):models();}});
  await rejectsCode(failing.listChatGPTModels(undefined,{refresh:false}),'unavailable');
  await failing.listChatGPTModels(undefined,{refresh:false});assert.equal(attempts,2);
});

test('missing or invalid usage stays explicitly unknown, while reported reasoning is preserved',async()=>{
  for(const usage of [undefined,null,{input_tokens:4},{input_tokens:-1,output_tokens:2}]){
    const result=await consumeResponsesStream(stream(event(complete('{}',{usage}))));assert.equal(result.usageKnown,false);assert.equal(result.reasoningTokens,null);
  }
  const result=await consumeResponsesStream(stream(event(complete('{}',{usage:{input_tokens:0,output_tokens:7,output_tokens_details:{reasoning_tokens:5}}}))));
  assert.equal(result.usageKnown,true);assert.equal(result.reasoningTokens,5);assert.equal(result.outputTokens,7);
});
