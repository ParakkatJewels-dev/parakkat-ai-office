import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, chmod, symlink, readFile, readdir, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildJevBody, checkJevModels, cleanJevKey, JevError, jevFailure, jevRequest, jevUsage, publicJevConfig, resolveJevConfig, validateJevAnswers } from '../src/lib/llm/jev-core.mjs';
import { createJevStore } from '../src/lib/llm/jev-store.mjs';

const serverKey='jev-server-test-key-not-real-12345',savedKey='jev-saved-test-key-not-real-67890';
const questions={category:{instructions:'Choose the topic.',criteria:{stock:'Inventory',delivery:'Shipping'}}};
const answer={type:'choice',choice:'stock',confidence:.8,probabilities:{stock:.9,delivery:.1}};
async function temporary(fn) {const directory=await mkdtemp(join(realpathSync(tmpdir()),'parakkat-jev-test-'));try {await fn(directory);}finally {await rm(directory,{recursive:true,force:true});}}

test('saved Jev keys override environment and never appear in public metadata',()=>{
  assert.equal(cleanJevKey(` ${savedKey} `),savedKey);assert.throws(()=>cleanJevKey('short'));assert.throws(()=>cleanJevKey(`${savedKey}\nAuthorization: x`));
  const config=resolveJevConfig({apiKey:savedKey},{JEV_API_KEY:serverKey});assert.equal(config.apiKey,savedKey);assert.equal(config.source,'saved');assert.ok(!JSON.stringify(publicJevConfig(config)).includes(savedKey));assert.ok(!Object.hasOwn(publicJevConfig(config),'apiKey'));
  assert.throws(()=>resolveJevConfig(null,{JEV_MODEL:'https://unsafe/'}),e=>e.code==='invalid_model');
});

test('Jev shared state contains full guidance once, never per question',()=>{
  const guidance='Agent identity: sales\nPRIVATE-SAVED-GUIDANCE';
  const body=buildJevBody(guidance,'Recorded facts',{...questions,urgency:{instructions:'Choose urgency.',criteria:{low:'Routine',high:'Immediate'}}},'jev-latest');
  assert.equal(JSON.stringify(body).split('PRIVATE-SAVED-GUIDANCE').length-1,1);assert.equal(body.state.agentGuidance,guidance);assert.equal(body.state.evidence,'Recorded facts');
  assert.equal(body.questions.category.type,'choice');assert.doesNotMatch(body.questions.category.instructions,/PRIVATE/);assert.deepEqual(body.questions.category.criteria,questions.category.criteria);
  assert.throws(()=>buildJevBody(guidance,'facts',{},'jev-latest'),e=>e.code==='invalid_request');
});

test('save checks GET models.name only and never submits a classification',async()=>{
  let count=0;
  await checkJevModels(serverKey,'jev-latest',async(url,options)=>{
    count++;assert.equal(url,'https://api.typesafe.ai/v1/models');assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.headers.authorization,`Bearer ${serverKey}`);assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');return Response.json({models:[{name:'jev-latest'}]});
  });assert.equal(count,1);
  await assert.rejects(checkJevModels(serverKey,'jev-latest',async()=>Response.json({models:[{id:'jev-latest'}]})),e=>e.code==='model_unavailable');
});

test('provider failures make one request and never expose bodies, keys or network exception text',async()=>{
  let count=0;
  for(const [status,code] of [[401,'authentication'],[402,'credits'],[429,'rate_limit'],[503,'unavailable']]) {
    await assert.rejects(jevRequest({apiKey:serverKey,body:{},fetch:async(url,options)=>{count++;assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');return Response.json({error:serverKey},{status});}}),e=>e.code===code&&!e.message.includes(serverKey));
  }
  assert.equal(count,4);
  await assert.rejects(jevRequest({apiKey:serverKey,body:{},fetch:async()=>{throw new Error(`network ${serverKey}`);}}),e=>e.code==='network'&&!e.message.includes(serverKey));
  await assert.rejects(jevRequest({apiKey:serverKey,body:{},fetch:async()=>new Response(new ReadableStream({start(controller){controller.error(new Error(serverKey));}}))}),e=>e.code==='invalid_response'&&!e.message.includes(serverKey));
  await assert.rejects(jevRequest({apiKey:serverKey,body:{},fetch:async()=>new Response(serverKey)}),e=>e.code==='invalid_response'&&!e.message.includes(serverKey));
});

test('pre-aborted calls do not reach Jev and oversized responses fail safely',async()=>{
  const signal=AbortSignal.abort(new DOMException('Cancelled','AbortError'));let count=0;
  await assert.rejects(jevRequest({apiKey:serverKey,body:{},signal,fetch:async()=>{count++;return Response.json({});}}),e=>e.name==='AbortError');assert.equal(count,0);
  await assert.rejects(jevRequest({apiKey:serverKey,body:{},fetch:async()=>new Response('x'.repeat(1024*1024+1))}),e=>e.code==='invalid_response');
});

test('official choice answers validate all probabilities, confidence and selected maximum',()=>{
  assert.deepEqual(validateJevAnswers({answers:{category:answer}},questions),{category:{choice:'stock',confidence:.8,probabilities:{stock:.9,delivery:.1}}});
  for(const bad of [null,{...answer,type:'score'},{...answer,choice:'missing'},{...answer,confidence:2},{...answer,probabilities:{stock:1}},{...answer,probabilities:{stock:.9,delivery:.9}},{...answer,probabilities:{stock:.1,delivery:.9}}]) assert.throws(()=>validateJevAnswers({answers:{category:bad}},questions),e=>e.code==='invalid_response');
  assert.deepEqual(jevUsage({usage:{input_tokens:123,output_tokens:9}}),{inputTokens:123,outputTokens:9,usageKnown:true});
  for(const usage of [{input_tokens:'123',output_tokens:9},{input_tokens:-1,output_tokens:9},{input_tokens:123},{input_tokens:NaN,output_tokens:9}]) assert.equal(jevUsage({usage}).usageKnown,false);
});

test('Jev uses its own private 0600 file, with Gemini directory fallback and environment restoration',async()=>temporary(async directory=>{
  const env={GEMINI_CONFIG_DIR:directory,JEV_API_KEY:serverKey},store=createJevStore({env});
  assert.equal((await store.getConfig()).apiKey,serverKey);await store.saveKey(savedKey);
  assert.equal((await stat(join(directory,'jev.json'))).mode&0o777,0o600);assert.equal((await stat(directory)).mode&0o777,0o700);
  const reloaded=createJevStore({env});assert.equal((await reloaded.getConfig()).apiKey,savedKey);assert.equal((await reloaded.getStatus()).status,'configured');assert.ok(!JSON.stringify(await reloaded.getStatus()).includes(savedKey));
  await reloaded.useEnvironment();assert.equal((await store.getConfig()).apiKey,serverKey);assert.ok(!(await readFile(join(directory,'jev.json'),'utf8')).includes(savedKey));assert.deepEqual(await readdir(directory),['jev.json']);
}));

test('Jev health persists without exposing unknown errors and stale keys cannot overwrite it',async()=>temporary(async directory=>{
  const env={JEV_API_KEY:serverKey},store=createJevStore({directory,env}),old=await store.getConfig();
  await store.recordResult(old,jevFailure(429));assert.equal((await createJevStore({directory,env}).getStatus()).status,'error');
  await store.saveKey(savedKey);await store.recordResult(old);assert.equal((await store.getStatus()).status,'configured');
  await store.recordResult(await store.getConfig(),new Error(savedKey));assert.ok(!JSON.stringify(await store.getStatus()).includes(savedKey));
  await store.recordResult(await store.getConfig());assert.equal((await store.getStatus()).status,'connected');
  env.JEV_MODEL='jev-preview';assert.equal((await store.getStatus()).status,'configured');
}));

test('concurrent saves leave one private file and unsafe paths cannot be used',async()=>temporary(async root=>{
  const directory=join(root,'private'),store=createJevStore({directory,env:{JEV_API_KEY:serverKey}});
  await Promise.all([store.saveKey(savedKey),store.recordResult(resolveJevConfig(null,{JEV_API_KEY:serverKey}))]);assert.equal((await store.getConfig()).apiKey,savedKey);assert.deepEqual(await readdir(directory),['jev.json']);
  await chmod(join(directory,'jev.json'),0o644);await assert.rejects(store.getConfig(),e=>e.code==='storage');await chmod(join(directory,'jev.json'),0o600);
  await symlink(directory,join(root,'linked'));await assert.rejects(createJevStore({directory:join(root,'linked'),env:{}}).getConfig(),e=>e.code==='storage');
  await rm(join(directory,'jev.json'));await symlink(join(root,'outside'),join(directory,'jev.json'));await assert.rejects(store.getConfig(),e=>e.code==='storage');
}));

test('independent Jev module instances serialize key changes and stale health writes without lock files',async()=>temporary(async directory=>{
  const secondModule=await import(`../src/lib/llm/jev-store.mjs?mutex-test=${Date.now()}`);
  const first=createJevStore({directory,env:{}}),second=secondModule.createJevStore({directory,env:{}});
  for(let round=0;round<6;round++) {
    await first.saveKey(serverKey);const old=await first.getConfig();
    await Promise.all([second.saveKey(savedKey),...Array.from({length:12},(_,i)=>(i%2?first:second).recordResult(old))]);
    assert.equal((await first.getConfig()).apiKey,savedKey,'a stale check must never restore the earlier key');
    assert.equal((await second.getStatus()).status,'configured');
  }
  assert.deepEqual(await readdir(directory),['jev.json']);
  assert.equal((await stat(join(directory,'jev.json'))).mode&0o777,0o600);
}));

test('a failed Jev update releases the shared mutex and does not strand future configuration writes',async()=>temporary(async directory=>{
  const first=createJevStore({directory,env:{}}),second=createJevStore({directory,env:{}});
  await first.saveKey(serverKey);
  await writeFile(join(directory,'jev.json'),'invalid JSON',{mode:0o600});
  const failed=await Promise.allSettled([first.saveKey(savedKey),second.useEnvironment()]);
  assert.ok(failed.every(result=>result.status==='rejected'&&result.reason.code==='storage'));
  await writeFile(join(directory,'jev.json'),JSON.stringify({apiKey:serverKey}),{mode:0o600});
  await second.saveKey(savedKey);assert.equal((await first.getConfig()).apiKey,savedKey);
  assert.deepEqual(await readdir(directory),['jev.json']);
}));
