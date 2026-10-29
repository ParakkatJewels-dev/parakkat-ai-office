import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/agents/carousel.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness({referenceError}={}) {
  const reference={id:'ref',name:'Past campaign',drive_id:'source_file',modified_at:'2026-10-27T11:00:00Z'};
  const imagePart={inlineData:{mimeType:'image/jpeg',data:'actual-reference-pixels'}};
  const parts=[{text:'Actual selected style reference with its fingerprint.'},imagePart];
  const state={set:{background_status:'queued',background_path:null,ref_ids:['ref']},referenceReads:0,images:[],uploads:[],columns:[]};
  const db={from(table){let update;const q={select:columns=>{state.columns.push([table,columns]);return q;},eq:()=>q,in:()=>q,maybeSingle:()=>q,
    update:value=>{update=value;return q;},then:(resolve,reject)=>Promise.resolve().then(()=>{
      if(table==='carousel_sets'){if(update)Object.assign(state.set,update);return {data:{...state.set},error:null};}
      if(table==='design_refs')return {data:[reference],error:null};
      if(table==='designs')return {data:{redo_note:'Keep the original deep blue palette.'},error:null};
      throw new Error(`Unexpected table ${table}`);
    }).then(resolve,reject)};return q;},storage:{from:()=>({
      upload:async(path,data,options)=>{state.uploads.push({path,data,options});return {error:null};},
      download:async()=>({data:new Blob([Buffer.from('generated style scene')]),error:null}),
    })}};
  const modules={'@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>false},'server-only':{},'node:crypto':{randomUUID},
    './library':{refParts:async(_db,refs)=>{state.referenceReads++;assert.deepEqual(refs,[reference]);if(referenceError)throw referenceError;return [{ref:reference,part:imagePart,parts}];}},
    '@/lib/llm/gemini':{carouselStyleBackground:async(...args)=>{state.images.push(args);return {data:Buffer.from('generated style scene'),mimeType:'image/png'};}},
    '@/lib/usage':{withUsage:(_scope,work)=>work()},
  };
  const exports={};new Function('exports','require',compiled)(exports,id=>modules[id]||{});
  return {state,parts,run:()=>exports.carouselBackgroundFor(db,'set')};
}

test('carousel style generation receives actual reference pixels once and stores only its generated scene',async()=>{
  const h=harness();const first=await h.run(),second=await h.run();
  assert.equal(first.bytes.toString(),'generated style scene');assert.deepEqual(second,first);
  assert.equal(h.state.referenceReads,1);assert.equal(h.state.images.length,1);
  assert.deepEqual(h.state.images[0][0],h.parts);assert.equal(h.state.images[0][2],'Keep the original deep blue palette.');
  assert.ok(h.state.columns.some(([table,columns])=>table==='design_refs'&&columns.includes('drive_id,modified_at')));
  assert.equal(h.state.uploads.length,1);assert.equal(h.state.uploads[0].data.toString(),'generated style scene');
  assert.equal(h.state.uploads[0].options.upsert,false);
});

test('an unavailable actual style reference stops before a carousel image request or storage write',async()=>{
  const h=harness({referenceError:new Error('Original reference revision could not be verified.')});
  await assert.rejects(h.run(),/Original reference revision/);
  assert.equal(h.state.images.length,0);assert.equal(h.state.uploads.length,0);assert.equal(h.state.set.background_status,'failed');
});
