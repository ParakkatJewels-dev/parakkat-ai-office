import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const code=ts.transpileModule(readFileSync(new URL('../src/app/api/studio/artwork/[source]/[id]/generation/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context={params:Promise.resolve({source:'design',id:'11111111-1111-4111-8111-111111111111'})};
function harness(job,denied=false){
  const calls={scheduled:[],collected:[]};
  const modules={
    'next/server':{after:callback=>calls.scheduled.push(callback)},
    '@/lib/artwork/generation':{
      artworkGenerationStatus:async()=>{if(denied)throw new Error('Denied');return{job,requestId:'request-1'};},
      collectSubmittedHiggsfieldGeneration:async id=>calls.collected.push(id),
      startArtworkGeneration:async()=>{throw new Error('GET cannot submit');},
      drainHiggsfieldGenerations:async()=>{throw new Error('GET cannot drain queued jobs');},
    },
    '@/lib/artwork/server':{artworkError:error=>Response.json({error:error.message},{status:403}),ArtworkError:Error},
    '@/lib/artwork/import-core.mjs':{validOrigin:()=>true},
  };
  const exports={};new Function('exports','require',code)(exports,name=>{assert.ok(name in modules,`Unexpected dependency ${name}`);return modules[name];});
  return{GET:exports.GET,calls};
}
test('status checks collect only due, already submitted Higgsfield images',async()=>{
  const due={id:'job-1',state:'submitted',nextPollAt:new Date(Date.now()-1000).toISOString()};
  const h=harness(due),response=await h.GET(new Request('https://office.test'),context);
  assert.equal(response.status,200);assert.equal(h.calls.scheduled.length,1);
  await h.calls.scheduled[0]();assert.deepEqual(h.calls.collected,['job-1']);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  for(const job of [{...due,state:'queued'},{...due,nextPollAt:new Date(Date.now()+60_000).toISOString()},null]){
    const other=harness(job);await other.GET(new Request('https://office.test'),context);
    assert.equal(other.calls.scheduled.length,0);
  }
  const denied=harness(due,true);assert.equal((await denied.GET(new Request('https://office.test'),context)).status,403);assert.equal(denied.calls.scheduled.length,0);
});
