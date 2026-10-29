import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../src/app/api/studio/artwork/[source]/[id]/chatgpt-generation/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const id='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222';
const context={params:Promise.resolve({source:'design',id})};
function harness(options={}) {
  const calls={access:0,admin:0,read:0,start:[],sign:[]};
  class ArtworkError extends Error {constructor(message,status=400){super(message);this.status=status;}}
  const access={source:'design',id,row:{artwork_request_id:requestId,image_path:'saved.png'},session:{role:'creative_head',user:{id:'actor'}}};
  const modules={
    '@/lib/supabase/admin':{supabaseAdmin:()=>{calls.admin++;return {storage:{from:()=>({createSignedUrl:async path=>{calls.sign.push(path);return{data:{signedUrl:'https://office.test/image'}};}})}};}},
    '@/lib/artwork/server':{ArtworkError,artworkError:error=>Response.json({error:error.message},{status:error.status||503}),accessArtwork:async()=>{calls.access++;if(options.denied)throw new ArtworkError('Denied',403);return access;}},
    '@/lib/artwork/import-core.mjs':{validId:value=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value),validOrigin:request=>request.headers.get('origin')==='https://office.test'},
    '@/lib/artwork/chatgpt-worker':{chatGPTImageWorkerEnabled:()=>options.enabled!==false,chatGPTWorkerJobForArtwork:async()=>{calls.read++;return options.job||null;},publicChatGPTImageJob:raw=>raw?{id:raw.id,state:raw.state}:null,startChatGPTArtwork:async value=>{calls.start.push(value);return {started:true,job:{id:'job-1',state:'queued'}};}},
  };
  const exports={};new Function('exports','require',code)(exports,name=>{assert.ok(name in modules,`Unexpected provider dependency ${name}`);return modules[name];});return {api:exports,calls};
}
const request=(body={requestId},origin='https://office.test')=>new Request('https://office.test/api/generation',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('status authorizes the artwork before privileged reads and never starts a job',async()=>{
  const denied=harness({denied:true});assert.equal((await denied.api.GET(new Request('https://office.test'),context)).status,403);assert.equal(denied.calls.admin,0);
  const h=harness({job:{id:'job-1',state:'succeeded',lease_holder:'private',output_sha256:'private'}});const response=await h.api.GET(new Request('https://office.test'),context),body=await response.json();
  assert.equal(h.calls.start.length,0);assert.equal(body.job.imageUrl,'https://office.test/image');assert.deepEqual(h.calls.sign,['saved.png']);assert.doesNotMatch(JSON.stringify(body),/private|lease_holder/);assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('POST rejects cross-origin, excessive and stale requests before reservation',async()=>{
  for(const [body,origin,status] of [[{requestId},'https://evil.test',403],[{requestId:'33333333-3333-4333-8333-333333333333'},'https://office.test',409],[{requestId,extra:'x'.repeat(5000)},'https://office.test',413]]){
    const h=harness();assert.equal((await h.api.POST(request(body,origin),context)).status,status);assert.equal(h.calls.start.length,0);
  }
});
test('an explicit valid request queues using the authenticated actor and does not invoke a generator',async()=>{
  const h=harness(),response=await h.api.POST(request(),context);assert.equal(response.status,202);
  assert.deepEqual(h.calls.start,[{source:'design',id,userId:'actor',role:'creative_head',requestId}]);assert.equal(h.calls.sign.length,0);assert.equal(h.calls.read,0);
});
test('disabled worker status does not read an unapplied job table',async()=>{
  const h=harness({enabled:false}),response=await h.api.GET(new Request('https://office.test'),context);
  assert.equal((await response.json()).enabled,false);assert.equal(h.calls.read,0);assert.equal(h.calls.start.length,0);
});
