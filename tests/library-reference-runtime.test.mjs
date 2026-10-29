import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import ts from 'typescript';
import * as libraryCore from '../src/lib/agents/library-core.mjs';

const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/agents/library.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const ref=(id,extra={})=>({id,name:`Reference ${id}`,drive_id:`drive_${id}`,modified_at:'2026-10-27T11:00:00.000Z',image_path:null,
  fingerprint:{palette:'Midnight blue and gold',typography:'Quiet serif hierarchy'},occasion:'Festive',...extra});
const original=await sharp({create:{width:2000,height:1000,channels:3,background:'#123456'}}).png().toBuffer();
function harness({error,paused=false}={}) {
  const calls=[];
  const modules={
    'server-only':{},sharp,
    '@/lib/connectors/drive':{designImageById:async(...args)=>{calls.push(args);if(error)throw error;return {data:original,mimeType:'image/png'};}},
    '@/lib/pause':{checkPause:async()=>{if(paused)throw new Error('Office paused');}},
    './library-core.mjs':libraryCore,
  };
  const exports={};new Function('exports','require',compiled)(exports,id=>modules[id]||{});
  const noStorage=new Proxy({}, {get(){throw new Error('Source previews must not touch the database or storage.');}});
  return {calls,run:(refs,options)=>exports.refParts(noStorage,refs,options)};
}

test('actual selected reference pixels accompany fingerprint guidance without storing uploaded images',async()=>{
  const h=harness(),source=ref('one');
  const [result]=await h.run([source]);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0][0],source.drive_id);assert.equal(h.calls[0][2],source.modified_at);
  assert.ok(h.calls[0][1] instanceof AbortSignal);
  assert.equal(result.ref,source);assert.equal(result.parts[1],result.part);
  assert.match(result.parts[0].text,/Midnight blue and gold/);assert.match(result.parts[0].text,/never copy its jewellery, words, claims/i);
  assert.match(result.parts[0].text,/PRIMARY STYLE REFERENCE/);
  assert.equal(result.part.inlineData.mimeType,'image/jpeg');
  const decoded=Buffer.from(result.part.inlineData.data,'base64'),metadata=await sharp(decoded).metadata();
  assert.equal(metadata.width,1536);assert.equal(metadata.height,768);
  const pixel=[...await sharp(decoded).extract({left:700,top:300,width:1,height:1}).raw().toBuffer()];
  assert.ok(pixel.every((value,index)=>Math.abs(value-[18,52,86][index])<=2),'the source visual is retained rather than replaced by generated pixels');
});

test('only three distinct revisions are read once per request, with no cross-request image cache',async()=>{
  const h=harness(),one=ref('one');
  const result=await h.run([one,{...one,id:'duplicate'},ref('two'),ref('three'),ref('four')]);
  assert.deepEqual(result.map(item=>item.ref.id),['one','two','three']);
  assert.match(result[1].parts[0].text,/SUPPORTING FINISH REFERENCE/);assert.match(result[1].parts[0].text,/do not blend a conflicting palette/);
  assert.equal(h.calls.length,3);
  await h.run([one]);assert.equal(h.calls.length,4,'transient source bytes are not cached across requests');
});

test('unavailable originals fail visibly instead of silently using weaker text-only style guidance',async()=>{
  const h=harness({error:new Error('Drive source changed')});
  await assert.rejects(h.run([ref('one')]),/could not be verified or read.*No text-only substitute/);
  assert.equal(h.calls.length,1);
});

test('missing source revision, paused work and cancellation prevent reference downloads',async()=>{
  for(const changes of [{drive_id:undefined},{modified_at:null},{modified_at:'not-a-date'}]){
    const h=harness();await assert.rejects(h.run([ref('one',changes)]),/verified Drive source revision/);assert.equal(h.calls.length,0);
  }
  const paused=harness({paused:true});await assert.rejects(paused.run([ref('one')]),/Office paused/);assert.equal(paused.calls.length,0);
  const h=harness(),controller=new AbortController();controller.abort(new Error('Cancelled by caller'));
  await assert.rejects(h.run([ref('one')],{signal:controller.signal}),/Cancelled by caller/);assert.equal(h.calls.length,0);
});
