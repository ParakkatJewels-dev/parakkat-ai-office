import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as libraryCore from '../src/lib/agents/library-core.mjs';
import * as scanCore from '../src/lib/agents/library-scan-core.mjs';

const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/connectors/drive.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const expected='2026-10-27T11:00:00.000Z';
function harness(modifiedTime) {
  const calls=[];
  const modules={'server-only':{},'./google':{googleConfig:async()=>({refresh:'fixture'}),accessToken:async()=>'fixture-token'},
    '@/lib/agents/library-core.mjs':libraryCore,'@/lib/agents/library-scan-core.mjs':scanCore};
  const fetcher=async(url)=>{calls.push(url);return url.startsWith('https://www.googleapis.com/')
    ? Response.json({id:'reference',name:'Reference',mimeType:'image/png',thumbnailLink:'https://example.test/preview=s220',size:'100',...(modifiedTime===undefined?{}:{modifiedTime})})
    :new Response(Buffer.from('fixture image'),{headers:{'content-type':'image/png'}});};
  const exports={};new Function('exports','require','fetch',compiled)(exports,id=>modules[id],fetcher);
  return {calls,run:()=>exports.designImageById('reference',undefined,expected)};
}

test('an unchanged Drive revision is read as a transient visual reference',async()=>{
  const h=harness('2026-10-27T11:00:00Z'),image=await h.run();
  assert.equal(h.calls.length,2);assert.equal(image.data.toString(),'fixture image');assert.equal(image.mimeType,'image/png');
});

test('changed, missing or invalid Drive revision metadata stops before image download',async()=>{
  for(const modified of ['2026-10-28T11:00:00Z',undefined,'not-a-date']){
    const h=harness(modified);await assert.rejects(h.run(),/revision could not be verified/);assert.equal(h.calls.length,1);
  }
});
