import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/pause.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(paused=false){
  const state={paused,reads:0,writes:[],spendChecks:0};
  const db={rpc:async()=>{state.spendChecks++;return {data:{budget_inr:1000,spent_inr:2000},error:null};},from:table=>{
    assert.equal(table,'system_state');
    const q={select:()=>q,eq:()=>q,maybeSingle:async()=>{state.reads++;return {data:{paused:state.paused},error:null};},upsert:async row=>{state.writes.push(row);state.paused=row.paused;return {error:null};}};return q;
  }};
  const exports={};new Function('exports','require',compiled)(exports,id=>id==='@/lib/supabase/admin'?{supabaseAdmin:()=>db}:{});
  return {state,api:exports};
}

test('provider admission no longer auto-pauses work at an estimated monthly spending target',async()=>{
  const h=harness();await h.api.checkPause();await h.api.checkPause();
  assert.equal(h.state.spendChecks,0,'scheduled spend monitoring owns alerts without a per-call spend query');
  assert.deepEqual(h.state.writes,[]);assert.equal(h.state.paused,false);
});

test('explicit manual pause and resume still control provider work',async()=>{
  const h=harness(true);await assert.rejects(h.api.checkPause(),{name:'Paused'});
  await h.api.setPaused(false,'admin');await h.api.checkPause();
  await h.api.setPaused(true,'admin');await assert.rejects(h.api.checkPause(),{name:'Paused'});
  assert.equal(h.state.writes.at(-1).reason,'manual');assert.equal(h.state.writes.at(-1).paused_by,'admin');
});
