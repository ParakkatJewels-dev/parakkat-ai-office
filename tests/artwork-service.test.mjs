import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as core from '../src/lib/artwork/import-core.mjs';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
const id='11111111-1111-4111-8111-111111111111', requestId='22222222-2222-4222-8222-222222222222';
const code=ts.transpileModule(readFileSync(new URL('../src/lib/artwork/server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function harness(options={}) {
  const calls={uploaded:[],removed:[],committed:[],signed:[],provider:0,adminReads:[]};
  const row={id,status:'awaiting_import',art_status:'awaiting_import',artwork_request_id:requestId,requested_by:'owner',versions:[],image_path:null,ref_ids:[],...options.row};
  const query=(admin)=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:options.invisible&&!admin?null:admin?{...row,image_path:options.committedPath?calls.uploaded[0]:null,versions:options.superseded?[{image_path:calls.uploaded[0]}]:row.versions}:row,error:options.checkError&&admin?{}:null})});
  const bucket={upload:async(path)=>{calls.uploaded.push(path);return{error:null};},remove:async(paths)=>{calls.removed.push(...paths);return{error:null};},createSignedUrl:async(path)=>{calls.signed.push(path);return{data:{signedUrl:'https://storage.test/image'},error:null};}};
  const admin={from:name=>{calls.adminReads.push(name);return query(true);},storage:{from:()=>bucket},rpc:async(name,args)=>{calls.committed.push({name,args});return options.rpcError?{error:{message:'stale'},data:null}:{data:{version:1},error:null};}};
  const modules={
    'server-only':{},'node:crypto':{randomUUID},sharp,
    '@/lib/supabase/admin':{supabaseAdmin:()=>admin},
    '@/lib/agents/conversation-api':{conversationUser:async()=>options.signedOut?null:{db:{from:()=>query(false)},user:{id:options.userId||'owner'},role:options.role||'ecom_manager'}},
    '@/lib/agents/design':{FORMATS:{}},'@/lib/agents/library-core.mjs':{},'@/lib/agents/carousel-card.mjs':{},'@/lib/connectors/drive':{},
    '@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>true},'./import-core.mjs':core,
  };
  const exports={};new Function('exports','require',code)(exports,name=>{assert.ok(name in modules,`Unexpected import ${name}`);return modules[name];});
  return {api:exports,calls};
}
const context={params:Promise.resolve({source:'design',id})};
async function uploadRequest(token=requestId,origin='https://office.test',provider) {
  const bytes=await sharp({create:{width:320,height:400,channels:3,background:'blue'}}).png().toBuffer();
  const form=new FormData();form.set('requestId',token);form.set('file',new File([bytes],'finished.png',{type:'image/png'}));if(provider!==undefined)form.set('provider',provider);
  return new Request('https://office.test/api/import',{method:'POST',headers:{origin},body:form});
}
test('RLS miss, missing session and wrong requester cannot upload or invoke admin',async()=>{
  for(const options of [{invisible:true},{signedOut:true},{userId:'other'}]) {
    const h=harness(options);await assert.rejects(h.api.importArtwork(await uploadRequest(),context));
    assert.equal(h.calls.uploaded.length,0);assert.equal(h.calls.committed.length,0);assert.equal(h.calls.adminReads.length,0);
  }
});
test('cross-origin and stale request IDs fail before storage',async()=>{
  for(const [token,origin] of [[requestId,'https://evil.test'],['33333333-3333-4333-8333-333333333333','https://office.test']]) {
    const h=harness();await assert.rejects(h.api.importArtwork(await uploadRequest(token,origin),context));assert.deepEqual(h.calls.uploaded,[]);
  }
});
test('valid import uses immutable scoped path and transaction before preview',async()=>{
  const h=harness();const result=await h.api.importArtwork(await uploadRequest(),context);
  assert.equal(result.status,'ready');assert.equal(result.version,1);
  assert.match(h.calls.uploaded[0],new RegExp(`^chatgpt-imports/design/${id}/${requestId}/[a-f0-9-]+\\.png$`));
  assert.equal(h.calls.committed[0].name,'commit_external_artwork_import');
  assert.equal(h.calls.committed[0].args.p_user_id,'owner');assert.equal(h.calls.removed.length,0);
});
test('lost CAS removes only newly uploaded orphan, never a preserved old version',async()=>{
  const h=harness({rpcError:true,row:{image_path:'previous.png'}});
  await assert.rejects(h.api.importArtwork(await uploadRequest(),context),/request changed/);
  assert.deepEqual(h.calls.removed,h.calls.uploaded);assert.ok(!h.calls.removed.includes('previous.png'));
});
test('ambiguous RPC response retains committed asset and recovers preview',async()=>{
  const h=harness({rpcError:true,committedPath:true});const result=await h.api.importArtwork(await uploadRequest(),context);
  assert.equal(result.status,'ready');assert.deepEqual(h.calls.removed,[]);
});
test('unknown commit state never deletes a possibly committed image',async()=>{
  const h=harness({rpcError:true,checkError:true});await assert.rejects(h.api.importArtwork(await uploadRequest(),context));assert.deepEqual(h.calls.removed,[]);
});
test('approved campaign artwork refuses import before reading upload',async()=>{
  const h=harness({role:'super_admin',row:{campaigns:{status:'approved'}}});
  await assert.rejects(h.api.importArtwork(await uploadRequest(),{params:Promise.resolve({source:'creative',id})}),/frozen/);assert.deepEqual(h.calls.uploaded,[]);
});

test('superseded committed image in history is retained but never returned as current success',async()=>{
 const h=harness({rpcError:true,superseded:true});await assert.rejects(h.api.importArtwork(await uploadRequest(),context),/request changed/);assert.deepEqual(h.calls.removed,[]);assert.deepEqual(h.calls.signed,[]);
});

test('Higgsfield imports bind the selected provider to the path, transaction and returned preview',async()=>{
  const h=harness();const result=await h.api.importArtwork(await uploadRequest(requestId,'https://office.test','higgsfield'),context);
  assert.equal(result.provider,'higgsfield');assert.ok(h.calls.uploaded[0].startsWith(`higgsfield-imports/design/${id}/${requestId}/`));
  assert.equal(h.calls.committed[0].args.p_provider,'higgsfield');assert.equal(h.calls.committed[0].args.p_path,h.calls.uploaded[0]);
});
test('unknown providers are rejected before writing storage or recording provenance',async()=>{
  for(const provider of ['gemini','Higgsfield','','../../chatgpt']) {
    const h=harness();await assert.rejects(h.api.importArtwork(await uploadRequest(requestId,'https://office.test',provider),context),/Choose ChatGPT or Higgsfield/);
    assert.deepEqual(h.calls.uploaded,[]);assert.deepEqual(h.calls.committed,[]);
  }
});
