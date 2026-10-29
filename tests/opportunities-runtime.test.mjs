import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as core from '../src/lib/agents/opportunities-core.mjs';
import * as schedule from '../src/lib/agents/autopilot-core.mjs';

const source=readFileSync(new URL('../src/lib/agents/opportunities.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness() {
  const lead=(id,department_id)=>({id,name:id,role_desc:'Review recorded business data',department_id,is_lead:true,enabled:true});
  const tables={agents:[lead('cmo','board'),lead('analyticsLead','insights'),lead('perfLead','perf')],departments:[],agent_runs:[],autopilot_jobs:[],job_locks:[],sync_cursors:[],reports:[],agent_events:[],
    agent_instructions:[{agent_id:'cmo',revision:1}],brand_book:[{id:1,voice:'Clear',always:'Use facts',never:'Invent',notes:''}],lessons:[],ad_insights_daily:[],social_posts:[],seo_keywords:[],competitor_moves:[],connections:[{provider:'shopify',status:'connected',last_synced_at:'2026-10-26T01:00:00Z'}],campaigns:[]};
  const state={calls:0,cmoCalls:0,fail:false,pause:false,stock:7};
  function from(table) {
    let operation='select',payload,one=false,limit=Infinity;const filters=[];
    const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},neq:(k,v)=>{filters.push(r=>r[k]!==v);return q;},
      in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},gt:(k,v)=>{filters.push(r=>r[k]>v);return q;},gte:(k,v)=>{filters.push(r=>r[k]>=v);return q;},
      lt:(k,v)=>{filters.push(r=>r[k]<v);return q;},lte:(k,v)=>{filters.push(r=>r[k]<=v);return q;},contains:(k,v)=>{filters.push(r=>Object.entries(v).every(([a,b])=>r[k]?.[a]===b));return q;},
      order:()=>q,limit:n=>{limit=n;return q;},maybeSingle:()=>{one=true;return q;},single:()=>{one=true;return q;},abortSignal:()=>q,
      insert:v=>{operation='insert';payload=v;return q;},update:v=>{operation='update';payload=v;return q;},upsert:v=>{operation='upsert';payload=v;return q;},
      then:(resolve,reject)=>Promise.resolve().then(()=>{
        let rows=tables[table].filter(r=>filters.every(f=>f(r))).slice(0,limit);
        if(operation==='insert'){rows=[{id:randomUUID(),created_at:new Date().toISOString(),started_at:new Date().toISOString(),...structuredClone(payload)}];tables[table].push(...rows);}
        if(operation==='upsert'){const existing=tables[table].find(row=>row.name===payload.name);if(existing){Object.assign(existing,structuredClone(payload));rows=[existing];}else{rows=[structuredClone(payload)];tables[table].push(...rows);}}
        if(operation==='update')for(const row of rows)Object.assign(row,structuredClone(payload));
        return {data:structuredClone(one?rows[0]||null:rows),error:null};
      }).then(resolve,reject)};return q;
  }
  const db={from,rpc:(name,args)=>{const q={abortSignal:()=>q,then:(resolve,reject)=>Promise.resolve().then(()=>{
    if(name==='acquire_job_lock'){tables.job_locks=[{name:args.p_name,holder:args.p_holder,until:new Date(Date.now()+200000).toISOString()}];return {data:true,error:null};}
    if(name==='release_job_lock'){tables.job_locks=[];return {data:null,error:null};}
    return {data:{revenue:100,units:5,spend:20,ad_revenue:70},error:null};
  }).then(resolve,reject)};return q;}};
  const modules={
    'server-only':{},'node:crypto':{randomUUID},
    '@/lib/llm/openai':{canWrite:async()=>true,chatJSON:async(_tier,_system,user)=>{state.calls++;assert.ok(tables.sync_cursors[0]?.state.attemptFingerprint,'attempt is durable before inference');if(state.fail)throw new Error('provider failed');const step=JSON.parse(user);if(step.phase==='cmo')state.cmoCalls++;return step.phase==='lead'?{summary:'No defensible new opportunities.',opportunities:[]}:{summary:'No recommendation to forward.',decisions:[]};}},
    '@/lib/pause':{checkPause:async()=>{if(state.pause)throw Object.assign(new Error('paused'),{name:'Paused'});}},
    '@/lib/usage':{withUsage:(_scope,fn)=>fn()},'@/lib/roles':{ROLE_TO_PERSON:{}},
    './people':{byId:Object.fromEntries(tables.agents.map(a=>[a.id,{...a,room:a.department_id}]))},
    './agent-instructions':{agentPrompt:async(_db,id,prompt)=>`Agent identity: ${id}\n${prompt}`},'./occasions.mjs':{upcoming:()=>[]},
    './autopilot-core.mjs':schedule,'./opportunities-core.mjs':core,
    './conversation-sales.mjs':{conversationProductSales:async()=>({available:true,data:[{product_id:'42',title:'Bangle',units:5,revenue:100,stock:state.stock,stock_source:'shopify'}],summary:{units_all_recorded_products:5},sample:{shown:1},coverage:{complete:false}})},
  };
  const exports={};new Function('exports','require',compiled)(exports,name=>{assert.ok(name in modules,`Unmocked dependency ${name}`);return modules[name];});
  return {tables,state,run:now=>exports.runOpportunityReview(db,{trigger:'manual',now:new Date(now||'2026-10-26T10:00:00Z')})};
}

test('real opportunity runner skips unchanged evidence despite clock and own-report changes',async()=>{
  const h=harness();assert.equal((await h.run()).status,'completed');assert.equal(h.state.calls,2);assert.equal(h.state.cmoCalls,0);
  const fingerprint=h.tables.sync_cursors[0].state.completedFingerprint;assert.match(fingerprint,/^[a-f0-9]{64}$/);
  h.tables.connections[0].last_synced_at='2026-10-26T10:01:00Z';
  h.tables.reports.push({title:'Own new report',department_id:'insights',status:'with_head',head_note:null,data:{kind:'opportunity'},created_at:'2026-10-26T10:00:00Z'});
  const skipped=await h.run('2026-10-26T10:01:00Z');assert.equal(skipped.status,'skipped');assert.match(skipped.summary,/No substantive evidence/);assert.equal(h.state.calls,2);
  h.state.stock=0;assert.equal((await h.run()).status,'completed');assert.equal(h.state.calls,4,'a real stock change triggers lead review');
  h.tables.agent_instructions[0].revision++;assert.equal((await h.run()).status,'completed');assert.equal(h.state.calls,6,'new current instructions trigger lead review');
  assert.equal(h.state.cmoCalls,0,'empty lead findings never spend a CMO request');
});

test('real runner preserves failed-attempt backoff and never marks failed evidence complete',async()=>{
  const h=harness();h.state.fail=true;assert.equal((await h.run()).status,'failed');assert.equal(h.state.calls,1);
  assert.equal(h.tables.sync_cursors[0].state.completedFingerprint,undefined);
  h.state.fail=false;const delayed=await h.run();assert.equal(delayed.status,'skipped');assert.match(delayed.summary,/retry delay/);assert.equal(h.state.calls,1);
  h.tables.sync_cursors[0].state.retryAfter=new Date(Date.now()-1).toISOString();assert.equal((await h.run()).status,'completed');assert.equal(h.state.calls,3);assert.equal(h.state.cmoCalls,0);
});

test('paused office does not start an evidence attempt or any model work',async()=>{
  const h=harness();h.state.pause=true;const result=await h.run();assert.equal(result.status,'failed');assert.match(result.summary,/paused/);
  assert.equal(h.state.calls,0);assert.equal(h.tables.sync_cursors.length,0);assert.equal(h.tables.agent_runs.length,0);
});
