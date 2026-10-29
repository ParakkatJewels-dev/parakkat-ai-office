import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {openIncidentInitiativeIds} from '../src/lib/outcomes/attention.mjs';
import * as display from '../src/app/(app)/outcomes/outcomes-ui.mjs';
import * as brief from '../src/app/(app)/outcomes/outcome-brief.mjs';

const code=ts.transpileModule(readFileSync(new URL('../src/app/(app)/outcomes/Outcomes.tsx',import.meta.url),'utf8')+'\nexport const testedCampaignHealth=CampaignHealth;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const row={id:'initiative-1',revision:1,source_kind:'manual',department_id:'creative',owner_agent:'designer',title:'Launch result',summary:'Recorded brief',approval_state:'proposed',execution_state:'not_started',outcome_state:'awaiting_data',can_manage:true,metric_config:null,baseline:null,warnings:[],evidence:[],notes:[],observation:{}};
const snapshot=(initiatives=[row])=>({initiatives,incidents:[],experiments:[],campaigns:[],coverage:[],departments:[{id:'creative',name:'Creative',human_head_role:'creative_head'}],agents:[{id:'designer',name:'Designer',department_id:'creative',enabled:true}],summary:{total:initiatives.length,awaiting_human:0,approved_not_executed:0,needs_attention:0,awaiting_data:initiatives.length,due_reviews:0},paused:true,isAdmin:true,role:'super_admin',limits:{initiatives:300,campaigns:500,experiments:200},monitoring:{limited:false}});
const find=(node,predicate)=>{if(!node)return null;if(Array.isArray(node)){for(const item of node){const hit=find(item,predicate);if(hit)return hit;}return null;}if(typeof node!=='object')return null;if(predicate(node))return node;return find(node.props?.children,predicate);};
const textOf=node=>Array.isArray(node)?node.map(textOf).join(''):typeof node==='object'&&node?textOf(node.props?.children):node==null||typeof node==='boolean'?'':String(node);

/** Execute the actual client component with controlled requests, effects and account changes. */
function harness(options={}){
  let cursor=0,dirty=false,mounted=true,nextTimer=0,now=0,tree,authCallback,unsubscribed=false,writesAfterUnmount=0;
  const states=[],effects=[],pending=[],timers=new Map(),requests=[],listeners=new Map();
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>{if(!mounted){writesAfterUnmount++;return;}const value=typeof next==='function'?next(states[i]):next;if(!Object.is(value,states[i])){states[i]=value;dirty=true;}}];},
    useRef(initial){const i=cursor++;if(!(i in states))states[i]={current:initial};return states[i];},
    useCallback(fn,deps){const i=cursor++;if(!states[i]||!same(states[i].deps,deps))states[i]={deps,fn};return states[i].fn;},
    useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||!same(old.deps,deps))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
  };
  const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'next/link':{default:'Link'},'@/components/ui':{Avatar:'Avatar',PageHead:'PageHead',Tile:'Tile',when:x=>x},'@/components/Icon':{Icon:'Icon'},'@/components/Pagination':{Pagination:'Pagination'},'@/lib/roles':{ROLE_LABEL:{}},'./OutcomeForms':{default:'OutcomeForm'},'./outcomes-ui.mjs':display,'./outcome-brief.mjs':brief,'@/lib/outcomes/attention.mjs':{openIncidentInitiativeIds},'./Outcomes.module.css':{default:new Proxy({},{get:(_,key)=>key})},'@/lib/supabase/browser':{supabaseBrowser:()=>({auth:{onAuthStateChange:fn=>{authCallback=fn;return {data:{subscription:{unsubscribe:()=>{unsubscribed=true;}}}};}}})}};
  const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
  const exports={},fetch=(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));
  const schedule=(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;};
  new Function('exports','require','fetch','document','window','setTimeout','clearTimeout','AbortSignal',code)(exports,id=>{assert.ok(id in modules,`Unmocked import ${id}`);return modules[id];},fetch,document,{location:{href:'https://office.example/outcomes'},history:{replaceState(){}}},schedule,id=>timers.delete(id),{any:AbortSignal.any,timeout:()=>new AbortController().signal});
  const render=()=>{cursor=0;dirty=false;tree=options.campaignProps?exports.testedCampaignHealth(options.campaignProps):exports.default({initialRole:'super_admin',initialInitiative:'initiative-1'});while(pending.length)pending.shift()();};
  const flush=async()=>{for(let i=0;i<15;i++){await Promise.resolve();if(dirty&&mounted)render();}};
  const advance=async ms=>{const end=now+ms;let count=0;while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;if(++count>100)throw Error('Unexpected poll loop');const [id,timer]=next;now=timer.at;timers.delete(id);timer.fn();await flush();}now=end;await flush();};
  render();
  return {requests,timers,flush,advance,rerender:render,get tree(){return tree;},get writesAfterUnmount(){return writesAfterUnmount;},get unsubscribed(){return unsubscribed;},
    node:type=>find(tree,node=>node.type===type||node.type?.name===type),
    click:async label=>{const button=find(tree,node=>node.type==='button'&&textOf(node).includes(label));assert.ok(button,`No button ${label}`);button.props.onClick();await flush();},
    respond:async(i,data,status=200)=>{requests[i].resolve({ok:status>=200&&status<300,status,json:async()=>data});await flush();},
    fail:async i=>{requests[i].reject(Error('Network unavailable'));await flush();},
    auth:async(event,id)=>{authCallback(event,id?{user:{id}}:null);await flush();},
    visibility:async state=>{document.visibilityState=state;listeners.get('visibilitychange')?.();await flush();},
    unmount:()=>{mounted=false;for(const effect of effects)effect?.cleanup?.();},
  };
}

test('outcomes polling is deduplicated, pauses in hidden tabs and only reads saved state',async()=>{
  const h=harness();assert.equal(h.requests.length,1);await h.visibility('visible');assert.equal(h.requests.length,1);
  await h.respond(0,snapshot());assert.match(textOf(h.tree),/at most every five minutes/);await h.advance(30000);assert.equal(h.requests.length,2);await h.advance(90000);assert.equal(h.requests.length,2);
  await h.respond(1,snapshot());await h.visibility('hidden');await h.advance(60000);assert.equal(h.requests.length,2);
  await h.visibility('visible');assert.equal(h.requests.length,3);assert.ok(h.requests.every(r=>r.url==='/api/outcomes'&&!r.options.method));h.unmount();
});

test('routine refresh preserves captured draft version; scope loss closes the form',async()=>{
  const h=harness();await h.respond(0,snapshot());h.node('InitiativeDetail').props.onDialog({kind:'note',initiative:row});await h.flush();
  assert.equal(h.node('OutcomeForm').props.dialog.initiative.revision,1);
  await h.advance(30000);await h.respond(1,snapshot([{...row,revision:2,title:'Updated source'}]));
  assert.equal(h.node('OutcomeForm').props.dialog.initiative.revision,1,'polling must not silently approve edits against a new version');
  await h.advance(30000);await h.respond(2,snapshot([]));assert.equal(h.node('OutcomeForm'),null);h.unmount();
});

test('server errors retain visibly stale saved data, while authentication failure clears it',async()=>{
  const h=harness();await h.respond(0,snapshot());await h.advance(30000);await h.respond(1,{error:'Temporarily unavailable'},503);
  assert.ok(h.node('InitiativeDetail'));assert.match(textOf(h.tree),/last successfully loaded data/);
  await h.advance(30000);await h.respond(2,{error:'Sign in required'},401);assert.equal(h.node('InitiativeDetail'),null);h.unmount();
});

test('account switches invalidate slow prior-account requests and sign-out immediately clears scope',async()=>{
  const h=harness();await h.auth('INITIAL_SESSION','old');await h.auth('SIGNED_IN','new');
  assert.equal(h.requests[0].options.signal.aborted,true);await h.respond(0,snapshot());assert.equal(h.node('InitiativeDetail'),null);
  await h.advance(0);assert.equal(h.requests.length,2);await h.respond(1,snapshot());await h.click('Track new work');assert.ok(h.node('OutcomeForm'));
  await h.auth('SIGNED_OUT',null);assert.equal(h.node('OutcomeForm'),null);assert.equal(h.node('InitiativeDetail'),null);h.unmount();
});

test('post waits for confirmed response and refreshed record; unknown failures do not discard the form',async()=>{
  const h=harness();await h.respond(0,snapshot());await h.click('Track new work');
  const save=h.node('OutcomeForm').props.send({action:'create_manual',title:'New plan'});await h.flush();assert.equal(h.requests[1].options.method,'POST');
  await h.respond(1,{ok:true,id:'new'});assert.equal(h.requests.length,3);await h.respond(2,snapshot());assert.deepEqual(await save,{ok:true,id:'new'});
  const failed=h.node('OutcomeForm').props.send({action:'note',id:'initiative-1',revision:1,note:'Update'});const rejection=assert.rejects(failed,/Network unavailable/);await h.fail(3);await rejection;
  assert.ok(h.node('OutcomeForm'));h.unmount();
});

test('unmount aborts pending read, timers and auth listeners; late reads cannot set state',async()=>{
  const h=harness();h.unmount();assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.unsubscribed,true);assert.equal(h.timers.size,0);
  await h.respond(0,snapshot());assert.equal(h.writesAfterUnmount,0);
});

test('an account change during post-save refresh cannot confirm the prior session’s edit',async()=>{
  const h=harness();await h.auth('INITIAL_SESSION','old');await h.respond(0,snapshot());await h.click('Track new work');
  const save=h.node('OutcomeForm').props.send({action:'create_manual',title:'New plan'});
  const rejection=assert.rejects(save,/sign-in changed/);await h.flush();await h.respond(1,{ok:true,id:'created'});
  assert.equal(h.requests.length,3);await h.auth('SIGNED_IN','new');await h.respond(2,snapshot());await rejection;
  assert.equal(h.node('OutcomeForm'),null);assert.equal(h.node('InitiativeDetail'),null);h.unmount();
});

test('actual attention filter matches the summary for 201 historic and 15 current initiatives with 18 open incidents',async()=>{
  const historic=Array.from({length:201},(_,i)=>({...row,id:`historic-${i}`,outcome_state:'inconclusive'}));
  const current=Array.from({length:15},(_,i)=>({...row,id:`current-${i}`,outcome_state:'awaiting_data'}));
  const open=current.map(item=>({initiative_id:item.id,status:'open'}));
  const incidents=[...open,...open.slice(0,3),...historic.map(item=>({initiative_id:item.id,status:'resolved'})),{initiative_id:'outside-snapshot',status:'open'},{initiative_id:'historic-0',status:'snoozed'},{initiative_id:'historic-1',status:'unknown'}];
  const data=snapshot([...historic,...current]);data.incidents=incidents;data.summary.needs_attention=openIncidentInitiativeIds(data.initiatives,incidents).size;
  const h=harness();await h.respond(0,data);h.node('select').props.onChange({target:{value:'attention'}});await h.flush();
  const cards=[];const collect=node=>{if(Array.isArray(node)){node.forEach(collect);return;}if(!node||typeof node!=='object')return;if(node.type?.name==='InitiativeCard')cards.push(node);collect(node.props?.children);};collect(h.tree);
  assert.equal(cards.length,15);assert.ok(cards.every(card=>card.props.row.id.startsWith('current-')));
  const tile=find(h.tree,node=>node.type==='Tile'&&node.props.label==='Needs attention');assert.equal(tile.props.value,cards.length);
  assert.equal(data.incidents.filter(incident=>incident.status==='resolved').length,201);h.unmount();
});


test('initiative pagination bounds long snapshots, keeps selection and resets after a search',async()=>{
  const records=Array.from({length:45},(_,i)=>({...row,id:`initiative-${i}`,title:`Launch ${i}`}));
  const h=harness();await h.respond(0,snapshot(records));h.node('select').props.onChange({target:{value:'all'}});await h.flush();
  const collect=()=>{const cards=[];const visit=node=>{if(Array.isArray(node)){node.forEach(visit);return;}if(!node||typeof node!=='object')return;if(node.type?.name==='InitiativeCard')cards.push(node.props.row.id);visit(node.props?.children);};visit(h.tree);return cards;};
  assert.equal(collect().length,20);assert.equal(h.node('Pagination').props.total,45);
  h.node('Pagination').props.onPageChange(2);await h.flush();
  assert.equal(collect()[0],'initiative-20');assert.equal(collect().length,20);
  assert.equal(h.node('InitiativeDetail').props.row.id,'initiative-1','changing page preserves the selected detail');
  h.node('Pagination').props.onPageChange(3);await h.flush();assert.equal(collect().length,5);
  const search=find(h.tree,node=>node.type==='input'&&node.props['aria-label']==='Search initiatives');
  search.props.onChange({target:{value:'Launch 44'}});await h.flush();
  assert.deepEqual(collect(),['initiative-44']);assert.equal(h.node('Pagination').props.page,1);assert.equal(h.node('Pagination').props.total,1);
  h.unmount();
});

test('shrinking snapshots clamp the visible page without an empty phantom page or losing a draft',async()=>{
  const records=Array.from({length:45},(_,i)=>({...row,id:`initiative-${i}`}));
  const h=harness();await h.respond(0,snapshot(records));h.node('select').props.onChange({target:{value:'all'}});await h.flush();h.node('Pagination').props.onPageChange(3);await h.flush();
  h.node('InitiativeDetail').props.onDialog({kind:'note',initiative:records[1]});await h.flush();
  await h.advance(30000);await h.respond(1,snapshot(records.slice(0,8)));
  assert.equal(h.node('Pagination').props.page,1);assert.equal(h.node('Pagination').props.total,8);
  assert.equal(h.node('OutcomeForm').props.dialog.initiative.id,'initiative-1');h.unmount();
});


test('campaign inventory paginates actual table rows, preserves focused detail and resets on provider/search filters',async()=>{
  const records=Array.from({length:45},(_,i)=>({id:`campaign-${i}`,name:`Campaign ${i}`,provider:i<30?'meta':'google',campaign_id:`external-${i}`,account_id:'account-1',effective_status:'ACTIVE',daily_budget:25,currency:'INR',budget_scope:'campaign',last_seen_at:'2026-10-26T10:00:00Z'}));
  const data={...snapshot([]),campaigns:records};let h;
  const props={snapshot:data,names:{},campaignId:'',onCampaign:id=>{props.campaignId=id;h.rerender();},onInitiative(){}};
  h=harness({campaignProps:props});
  const rows=()=>{const body=find(h.tree,node=>node.type==='tbody');return body?.props.children||[];};
  assert.equal(rows().length,20);assert.equal(h.node('Pagination').props.total,45);
  h.node('Pagination').props.onPageChange(2);await h.flush();assert.equal(rows().length,20);assert.match(textOf(rows()[0]),/Campaign 20/);
  await h.click('Campaign 24');assert.equal(h.node('CampaignDetail').props.row.id,'campaign-24');
  h.node('Pagination').props.onPageChange(3);await h.flush();assert.equal(rows().length,5);assert.equal(h.node('CampaignDetail').props.row.id,'campaign-24');
  const selects=[];const visit=node=>{if(Array.isArray(node)){node.forEach(visit);return;}if(!node||typeof node!=='object')return;if(node.type==='select')selects.push(node);visit(node.props?.children);};visit(h.tree);selects[1].props.onChange({target:{value:'google'}});await h.flush();
  assert.equal(h.node('Pagination').props.page,1);assert.equal(rows().length,15);assert.match(textOf(rows()[0]),/Campaign 30/);
  assert.equal(h.node('CampaignDetail').props.row.id,'campaign-24','filtering the list does not silently swap the selected campaign');
  const search=find(h.tree,node=>node.type==='input'&&node.props['aria-label']==='Search campaign inventory');search.props.onChange({target:{value:'Campaign 44'}});await h.flush();
  assert.equal(rows().length,1);assert.equal(h.node('Pagination').props.total,1);assert.match(textOf(rows()[0]),/Campaign 44/);h.unmount();
});
