import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/automation/runner.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source+'\nexport const testCampaign=campaign;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(status) {
  let run=null,checks=0,events=0;const interrupted=new Error(status==='cancelled'?'Ownership changed':'Paused');
  const db={from(table){let operation='read',payload;const q={select:()=>q,eq:()=>q,insert:value=>{operation='insert';payload=value;return q;},update:value=>{operation='update';payload=value;return q;},single:()=>q,maybeSingle:()=>q,then:(resolve,reject)=>Promise.resolve().then(()=>{
    if(table==='agent_runs'){if(operation==='insert')run={id:'run',status:'running',...payload};if(operation==='update')Object.assign(run,payload);return {data:run,error:null};}
    if(table==='automation_tasks')return {data:{status},error:null};throw new Error(`Unexpected table ${table}`);
  }).then(resolve,reject)};return q;}};
  const exports={};new Function('exports','require',compiled)(exports,()=>({}));
  const context={db,task:{id:'task',title:'Campaign',brief:'Prepare',owner_agent:'creativeDirector'},assertActive:async()=>{if(++checks===2)throw interrupted;},event:async()=>{events++;}};
  return {start:()=>exports.testCampaign(context),run:()=>run,events:()=>events};
}
test('cancellation between campaign ownership check and run insert cancels that new run',async()=>{
  const h=harness('cancelled');await assert.rejects(h.start(),/Ownership changed/);assert.equal(h.run().status,'cancelled');assert.equal(h.events(),0);
});
test('a pause after campaign insert preserves its durable run for resume',async()=>{
  const h=harness('running');await assert.rejects(h.start(),/Paused/);assert.equal(h.run().status,'running');assert.equal(h.events(),0);
});
