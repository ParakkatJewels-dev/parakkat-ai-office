import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PEOPLE,ROOMS,BUILDINGS} from '../src/office/roster.mjs';
import {ROLE_GUIDANCE} from '../src/lib/agents/role-guidance.mjs';
import {campaignVerdict,campaignArtifact,campaignQualityCurrent,reportReviewDecision} from '../src/lib/agents/quality-core.mjs';
import {headQualityArtifact,headQualityCurrent,validateHeadQuality,headTaskRoster} from '../src/lib/automation/head-task-core.mjs';

test('campaign claims, policy and CMO must each explicitly pass; missing or malformed never passes',()=>{
  const good={claims:{choice:'clean'},policy:{choice:'ok'}};
  assert.equal(campaignVerdict(good,{ok:true,note:'Supported.'}).passed,true);
  for(const c of [null,{}, {...good,claims:{choice:'risky'}},{...good,policy:{choice:'reject'}}]) assert.equal(campaignVerdict(c,{ok:true,note:'Fine'}).passed,false);
  for(const h of [null,{}, {ok:'true',note:'Fine'},{ok:false,note:'Fails'},{ok:true,note:''}]) assert.equal(campaignVerdict(good,h).passed,false);
});
test('one correction is allowed; a second revise and malformed verdict reject rather than forward',()=>{
  assert.equal(reportReviewDecision({decision:'revise',note:'Fix it'},1).decision,'revise');
  assert.equal(reportReviewDecision({decision:'revise',note:'Fix it'},2).decision,'reject');
  assert.equal(reportReviewDecision({decision:'revise',note:'Fix it'},3).decision,'reject');
  for(const v of [null,{}, {decision:'approve',note:'Fine'},{decision:'forward',note:''}])assert.equal(reportReviewDecision(v,1).decision,'reject');
  assert.equal(reportReviewDecision({decision:'forward',note:'Checked'},3).decision,'forward');
});
test('campaign quality binds copy, image path, artifact status and proposed budget',()=>{
  const rows=[{id:'a',headline:'Supported',body:'Copy',image_path:'immutable-v1.png',art_status:'ready'}];
  const plan={name:'Campaign',budget_daily:100,channels:['meta']};
  plan.quality={version:1,passed:true,claims:'clean',policy:'ok',cmoApproved:true,artifact:campaignArtifact(plan,rows)};
  assert.equal(campaignQualityCurrent(plan,rows),true);
  for(const patch of [{headline:'Changed'},{image_path:'v2.png'},{art_status:'needs_fix'}])assert.equal(campaignQualityCurrent(plan,[{...rows[0],...patch}]),false);
  assert.equal(campaignQualityCurrent({...plan,budget_daily:101},rows),false);assert.equal(campaignQualityCurrent({...plan,quality:undefined},rows),false);
});
test('independent QC binds all criteria, evidence and versions, and cannot approve its own work',()=>{
  const s={headAgentId:'head',humanRevision:0,revisionRound:0,plan:{successCriteria:['Accurate'],assignments:[{agentId:'worker'}]},outputs:{worker:{body:'Deliverable',blocked:false,missing:[]}},review:{decision:'approve',note:'Ready',finalMarkdown:'Candidate'},evidenceSnapshot:{known:'fact'},evidence:[]};
  s.quality=validateHeadQuality({decision:'pass',note:'Verified',findings:[]},s,'2026-10-26T00:00:00Z');assert.ok(headQualityCurrent(s));
  for(const mutate of [x=>x.review.finalMarkdown+='new',x=>x.outputs.worker.body+='new',x=>x.plan.successCriteria.push('New requirement'),x=>x.evidenceSnapshot.known='changed',x=>x.humanRevision++,x=>x.revisionRound++]) {const x=structuredClone(s);mutate(x);assert.equal(headQualityCurrent(x),false);}
  const reordered={...s,quality:{...s.quality,artifact:Object.fromEntries(Object.entries(headQualityArtifact(s)).reverse())}};assert.ok(headQualityCurrent(reordered));
  assert.throws(()=>validateHeadQuality({decision:'pass',note:'Fine',findings:[]},{...s,headAgentId:'outputQc'},'now'),/own output/);
});
test('exactly three additions have distinct finite usable map seats, remain real conversation roles, and QC cannot be a worker',()=>{
  assert.equal(PEOPLE.filter(p=>!p.human).length,70);assert.deepEqual(Object.keys(ROLE_GUIDANCE).sort(),['funnelCro','outcomesAnalyst','outputQc']);
  const source=readFileSync(new URL('../src/office/engine.mjs',import.meta.url),'utf8');
  const ast=ts.createSourceFile('engine.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const seats=ast.statements.flatMap(n=>ts.isVariableStatement(n)?n.declarationList.declarations:[]).find(n=>n.name.getText(ast)==='SEAT');
  const offsets=new Function(`return ${seats.initializer.getText(ast)}`)();const occupied=new Set();
  for(const p of PEOPLE) {const r=ROOMS.find(r=>r.id===p.room),b=BUILDINGS.find(b=>b.id===r.building),seat=offsets[p.seat];assert.ok(seat,`${p.id} needs a seat`);const x=b.ox-b.cols*6+6+12*r.col+seat[0],z=(r.row?9:-9)+seat[1];assert.ok(Number.isFinite(x)&&Number.isFinite(z));const key=`${p.room}:${x}:${z}`;assert.equal(occupied.has(key),false,`overlap ${p.id}`);occupied.add(key);}
  const agents=PEOPLE.filter(p=>!p.human).map(p=>({id:p.id,name:p.name,role_desc:p.role,department_id:p.dept,is_lead:!!p.head,enabled:true}));
  const pool=headTaskRoster(agents,PEOPLE,'analyticsLead',['insights','perf','qa']).specialists.map(a=>a.id);
  assert.ok(pool.includes('funnelCro')&&pool.includes('outcomesAnalyst'));assert.equal(pool.includes('outputQc'),false);
});
