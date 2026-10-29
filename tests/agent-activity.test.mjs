import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { activityState, isWorkingStatus } from '../src/lib/agents/activity-core.mjs';

const now=Date.parse('2026-10-26T12:00:00Z');
const lease={state:'working',label:'Preparing a response',expiresAt:new Date(now+12_000).toISOString()};

test('a recent completed event is active today, never working without a fresh lease',()=>{
  assert.equal(activityState(new Date(now-60_000).toISOString(),null,now),'today');
  assert.equal(activityState(new Date(now-60_000).toISOString(),{},now),'today');
  assert.equal(activityState(null,lease,now),'now','work can start before an activity event is written');
});

test('today changes at India midnight and ignores future or invalid history',()=>{
  const midnight=Date.parse('2026-10-26T18:30:00Z');
  assert.equal(activityState(midnight-1,null,midnight),'quiet');
  assert.equal(activityState(midnight,null,midnight),'today');
  assert.equal(activityState('2026-10-26T18:29:59.999Z',null,midnight-1),'today');
  for(const value of ['invalid','',null,undefined,Infinity,midnight+1])assert.equal(activityState(value,null,midnight),'quiet');
  assert.equal(activityState('2026-10-25T19:00:00Z',null,now),'today','same India day even though UTC date differs');
  assert.equal(activityState('2026-10-25T18:29:59Z',null,now),'quiet','yesterday stays quiet even within the last 24 hours');
});

test('only executing unexpired leases count; waiting, blocked and animation states do not',()=>{
  assert.equal(isWorkingStatus(lease,now),true);
  assert.equal(isWorkingStatus({...lease,expiresAt:now+1},now),true);
  for(const expiresAt of [now,now-1,'bad',null,Infinity,undefined])assert.equal(isWorkingStatus({...lease,expiresAt},now),false);
  for(const state of ['waiting','blocked','thinking','walking','talking','idle'])assert.equal(isWorkingStatus({...lease,state},now),false);
  assert.equal(activityState(now-1000,lease,now+12000),'today');
  assert.equal(isWorkingStatus(lease,NaN),false);
});

// Execute the real engine stats method without constructing a WebGL renderer.
const engineSource=readFileSync(new URL('../src/office/engine.mjs',import.meta.url),'utf8');
const tree=ts.createSourceFile('engine.mjs',engineSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let statsMethod;
function visit(node){if(ts.isMethodDeclaration(node)&&node.name.getText(tree)==='stats')statsMethod=node.getText(tree);ts.forEachChild(node,visit);}
visit(tree);
const stats=(people,statuses)=>new Function('people','B','workStatuses','isWorkingStatus','Date',`return ({${statsMethod}}).stats();`)(people,{hq:{id:'hq',short:'HQ',people,rooms:[]}},statuses,isWorkingStatus,{now:()=>now});

test('real office occupancy excludes speech, walking, meetings and pending approvals',()=>{
  assert.ok(statsMethod);
  const people=[{id:'speaker',bubble:'A completed result',status:'talking'},{id:'walker',path:[{x:1,z:1}]},{id:'meeting',meetingId:'meeting'},{id:'approval',quest:true},{id:'worker'},{id:'human',human:true}];
  const empty=stats(people,{});assert.equal(empty.active,0);assert.equal(empty.total,5);assert.equal(empty.buildings[0].active,0);
  const actual=stats(people,{worker:lease,human:lease,approval:{...lease,state:'waiting'}});
  assert.equal(actual.active,1);assert.equal(actual.buildings[0].active,1);
  assert.equal(stats(people,{worker:{...lease,expiresAt:now}}).active,0);
});

const scorecardCompiled=ts.transpileModule(readFileSync(new URL('../src/lib/agents/scorecard.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function scorecardHarness(){
  const at=Date.now();
  const agents=[{id:'recent',enabled:true},{id:'live',enabled:true},{id:'disabled',enabled:false},{id:'otherDepartment',enabled:true}];
  const rows=agents.map(agent=>({agent_id:agent.id,last_at:agent.id==='live'?null:new Date(at).toISOString(),last_text:'Finished a job.',actions:1,reports:0,forwarded:0,accepted:0,pushed_back:0}));
  let fail=false;const requested=[];
  const db={rpc:async(name,args)=>({data:name==='agent_activity'?rows.filter(row=>args.p_ids.includes(row.agent_id)):[],error:null}),from(table){assert.equal(table,'agents');const filters=[];const q={select:()=>q,in:(key,values)=>{filters.push(row=>values.includes(row[key]));return q;},eq:(key,value)=>{filters.push(row=>row[key]===value);return q;},then:(resolve,reject)=>Promise.resolve(fail?{data:null,error:new Error('Roster unavailable')}:{data:agents.filter(row=>filters.every(filter=>filter(row))),error:null}).then(resolve,reject)};return q;}};
  const modules={'server-only':{},'./design':{FORMATS:{}},'./activity-core.mjs':{activityState},'./agent-work':{readAgentWork:(ids,time)=>{requested.push(ids);return Object.fromEntries(ids.filter(id=>['live','disabled','otherDepartment'].includes(id)).map(id=>[id,{state:'working',expiresAt:new Date(time+12000).toISOString()}]));}}};
  const exports={};new Function('exports','require',scorecardCompiled)(exports,name=>{assert.ok(name in modules,`Unmocked import ${name}`);return modules[name];});
  return {run:()=>exports.scorecards(db,['recent','live','disabled']),requested,fail:()=>{fail=true;}};
}

test('real scorecards separate completed history from live work and exclude disabled or unscoped agents',async()=>{
  const h=scorecardHarness(),{cards}=await h.run();
  assert.equal(cards.recent.state,'today');assert.equal(cards.live.state,'now');assert.equal(cards.disabled.state,'today');
  assert.equal(cards.otherDepartment,undefined);assert.deepEqual(h.requested,[['recent','live']]);
});

test('scorecards fail closed when enabled-agent visibility cannot be verified',async()=>{
  const h=scorecardHarness();h.fail();await assert.rejects(h.run(),/Roster unavailable/);assert.equal(h.requested.length,0);
});
