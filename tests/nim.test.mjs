import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nimJSON,NimError,resolveNimConfig} from '../src/lib/llm/nim-core.mjs';
import {createNimStore} from '../src/lib/llm/nim-store.mjs';

const KEY='nvapi-test-secret-do-not-send';
test('NIM sends a bounded JSON-only request and records provider token usage',async()=>{
  let request;
  const answer=await nimJSON({apiKey:KEY,model:'nvidia/nemotron-3.5-lightning-30b-a3b',system:'You are an analyst.',user:'Summarize.',maxOutputTokens:500,
    fetch:async(url,options)=>{request={url,options};return new Response(JSON.stringify({model:'nvidia/nemotron-3.5-lightning-30b-a3b',choices:[{message:{content:'{"summary":"ready"}'}}],usage:{prompt_tokens:32,completion_tokens:7}}),{status:200});}});
  assert.equal(request.url,'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(request.options.redirect,'error');
  assert.equal(request.options.headers.authorization,`Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(request.options.body).messages.map(m=>m.role),['system','user']);
  assert.equal(JSON.parse(request.options.body).max_tokens,500);
  assert.equal(JSON.parse(request.options.body).reasoning_budget,0);
  assert.deepEqual(answer.value,{summary:'ready'});
  assert.deepEqual(answer.usage,{inputTokens:32,outputTokens:7,usageKnown:true});
});

test('NIM failures are safe and do not expose provider text or secrets',async()=>{
  await assert.rejects(nimJSON({apiKey:KEY,model:'nvidia/nemotron-3.5-lightning-30b-a3b',system:'s',user:'u',fetch:async()=>new Response('private upstream response',{status:401})}),error=>{
    assert.equal(error.code,'authentication');assert.ok(!error.message.includes(KEY));assert.ok(!error.message.includes('private upstream'));return true;
  });
  await assert.rejects(nimJSON({apiKey:KEY,model:'nvidia/nemotron-3.5-lightning-30b-a3b',system:'s',user:'u',fetch:async()=>new Response(JSON.stringify({choices:[{message:{content:'not JSON'}}]}))}),error=>error.code==='invalid_json');
});

test('NIM key stays private and only the tested key/model is enabled',async()=>{
  const directory=await mkdtemp(join(realpathSync(tmpdir()),'ai-office-nim-'));
  try{
    const store=createNimStore({directory,env:{}});
    await store.saveKey(KEY);
    const saved=await store.getConfig();assert.equal(saved.apiKey,KEY);
    assert.equal((await store.getStatus()).status,'configured');
    assert.equal((await stat(join(directory,'nim.json'))).mode&0o777,0o600);
    await store.recordResult(saved);
    assert.equal((await store.getStatus()).status,'connected');
    await store.recordResult(saved,new NimError('Synthetic provider failure','invalid_json'));
    assert.notEqual((await store.getStatus()).status,'connected');
    await store.recordResult(saved);
    assert.equal((await store.getStatus()).status,'connected');
    await store.saveKey('nvapi-another-secret-do-not-send');
    assert.equal((await store.getStatus()).status,'configured');
    assert.ok(!(await readFile(join(directory,'nim.json'),'utf8')).includes('nvapi-test-secret-do-not-send'));
    assert.equal(resolveNimConfig(null,{}).model,'nvidia/nemotron-3.5-lightning-30b-a3b');
  }finally{await rm(directory,{recursive:true,force:true});}
});
