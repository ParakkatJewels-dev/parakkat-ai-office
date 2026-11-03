import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled=ts.transpileModule(readFileSync(new URL('../src/app/api/agents/tick/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

test('a minute tick advances human workflows even when autopilot chose another job',async()=>{
  const called=[];
  const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,then:(resolve,reject)=>Promise.resolve({data:[],error:null}).then(resolve,reject)};
  const db={rpc:async name=>({data:name==='acquire_job_lock'}),from:()=>q};
  const modules={
    'node:crypto':{randomUUID:()=> 'holder'},'next/server':{NextResponse:{json:body=>body}},
    '@/lib/supabase/admin':{supabaseAdmin:()=>db},'@/lib/agents/campaign':{advance:async()=>''},
    '@/lib/agents/autopilot':{runAutopilot:async()=>({job:'instagram_inbox'})},
    '@/lib/agents/design':{drainDesignQueue:async()=>({idle:true})},
    '@/lib/auth/session':{isCron:()=>true},'@/lib/errors':{errText:error=>String(error)},
    '@/lib/pause':{isPaused:async()=>false},'@/lib/outcomes/service':{refreshOutcomeMonitoring:async()=>({idle:true})},
    '@/lib/automation/runner':{runAutomationQueue:async()=>{called.push('workflow');return {id:'task',status:'queued'};}},
  };
  const api={};new Function('exports','require',compiled)(api,name=>{assert.ok(name in modules,`Unexpected import ${name}`);return modules[name];});
  const result=await api.POST(new Request('https://office.example/api/agents/tick',{method:'POST'}));
  assert.deepEqual(called,['workflow']);
  assert.deepEqual(result.workflows,{id:'task',status:'queued'});
});
