import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as core from '../src/lib/outcomes/core.mjs';
import * as attention from '../src/lib/outcomes/attention.mjs';
const source=readFileSync(new URL('../src/lib/outcomes/service.ts',import.meta.url),'utf8');
function loadService(){const exports={};const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const imports={'server-only':{},'@/lib/agents/conversation-api':{},'@/lib/supabase/admin':{},'@/lib/pause':{isPaused:async()=>true},'@/lib/automation/core.mjs':{},'./core.mjs':core,'./cadence.mjs':{OUTCOME_CADENCE_SECONDS:300},'./recent-activity.mjs':{},'./benchmarks.mjs':{},'./attention.mjs':attention};
 new Function('exports','require',compiled)(exports,name=>{assert.ok(Object.hasOwn(imports,name),`unexpected dependency ${name}`);return imports[name];});return exports;
}
test('read-only API snapshot counts distinct loaded initiatives with open incidents, matching the attention filter',async()=>{
 const initiatives=[...Array.from({length:201},(_,i)=>({id:`inactive-${i}`,source_kind:'provider_campaign',department_id:'perf',approval_state:'proposed',execution_state:'not_started',outcome_state:'inconclusive'})),...Array.from({length:15},(_,i)=>({id:`current-${i}`,source_kind:'provider_campaign',department_id:'perf',approval_state:'proposed',execution_state:'not_started',outcome_state:'awaiting_data'}))];
 const incidents=[...Array.from({length:15},(_,i)=>({initiative_id:`current-${i}`,status:'open'})),...Array.from({length:3},()=>({initiative_id:'current-0',status:'open'})),{initiative_id:'inactive-0',status:'resolved'},{initiative_id:'outside-loaded-scope',status:'open'}];
 const data={outcome_initiatives:initiatives,outcome_incidents:incidents,outcome_experiments:[],campaign_registry:[],campaign_sync_coverage:[],departments:[{id:'perf',name:'Performance',human_head_role:'perf_marketer'}],agents:[]};const reads=[];
 const db={from(table){assert.ok(Object.hasOwn(data,table));reads.push(table);const q={select(){return q;},order(){return q;},limit(){return q;},then(resolve,reject){return Promise.resolve({data:data[table],error:null}).then(resolve,reject);}};return q;},rpc:async(name)=>{assert.equal(name,'read_outcome_monitoring_status');return {data:{limited:false,last_refreshed_at:null},error:null};}};
 const result=await loadService().getOutcomes({db,role:'super_admin'});
 assert.equal(result.summary.needs_attention,15);assert.equal(result.summary.needs_attention,attention.openIncidentInitiativeIds(result.initiatives,result.incidents).size);assert.equal(result.summary.total,216);assert.equal(result.monitoring.limited,false);assert.equal(result.paused,true);assert.equal(reads.length,7);
});
