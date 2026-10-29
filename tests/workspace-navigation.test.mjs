import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const jsx=require('react/jsx-runtime');
const component=name=>Object.assign(()=>null,{displayName:name});
const components=Object.fromEntries(['PageHead','Tile','Avatar','Pager','Icon','AgentActivityProvider','AgentActivitySummary','AgentActivityBadge','Link'].map(name=>[name,component(name)]));
function compile(path,modules){const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const exports={};new Function('exports','require',code)(exports,name=>{if(name==='react/jsx-runtime')return jsx;assert.ok(name in modules,`Unmocked import ${name}`);return modules[name];});return exports;}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(typeof tree==='string'||typeof tree==='number')return String(tree);if(!tree||typeof tree!=='object')return '';if(Array.isArray(tree))return tree.map(text).join(' ');return text(tree.props?.children);}
function agentPage(){
  const agents=Array.from({length:30},(_,index)=>({id:`agent-${index+1}`,name:`Agent ${String(index+1).padStart(2,'0')}`,role_desc:index%2?'Designer':'Sales analyst',department_id:index%2?'creative':'sales',is_lead:index%5===0}));
  const history=Object.fromEntries(agents.map(agent=>[agent.id,{id:agent.id,last:null,state:'quiet',actions:10,forwarded:2,accepted:1,reports:2,designs:0,runs:1}]));
  let scope;
  const query={select(){return this;},in(column,values){scope=values;return this;},order(){return this;},then(resolve){return Promise.resolve({data:agents}).then(resolve);}};
  const modules={
    'next/link':{default:components.Link},'@/lib/auth/session':{requireUser:async()=>({db:{from:()=>query},role:'creative_head'})},
    '@/lib/agents/scorecard':{myDepartments:async()=>[{id:'creative',name:'Creative House'},{id:'sales',name:'Sales'}],scorecards:async()=>({cards:history,totals:{live:3,spend:0,revenue:0}}),ago:()=>''},
    '@/components/Icon':{Icon:components.Icon},'@/components/ui':{...components,inr:String,pageOf:(sp)=>Math.max(1,Number(sp.page)||1)},
    './Agents.module.css':{default:{}},'@/components/AgentActivity':components,
  };
  const render=compile('../src/app/(app)/agents/page.tsx',modules).default;
  return {render,agents,get scope(){return scope;}};
}
const agentLinks=tree=>nodes(tree,n=>n.type===components.Link&&/^\/agents\/agent-/.test(n.props.href));
test('agent directory pages its rows while activity and totals retain all authorized agents',async()=>{
  const h=agentPage(),tree=await h.render({searchParams:Promise.resolve({page:'2'})});
  assert.deepEqual(h.scope,['creative','sales']);
  assert.equal(agentLinks(tree).length,12);assert.equal(agentLinks(tree)[0].props.href,'/agents/agent-13');
  const provider=nodes(tree,n=>n.type===components.AgentActivityProvider)[0];assert.equal(Object.keys(provider.props.history).length,30);
  const pager=nodes(tree,n=>n.type===components.Pager)[0];assert.equal(pager.props.total,30);assert.equal(pager.props.page,2);
  const reports=nodes(tree,n=>n.type===components.Tile&&n.props.label==='Reports forwarded')[0];
  assert.ok(reports,'The visible reports summary must remain available.');
  assert.equal(reports.props.value,60,'Reports include all 30 authorized agents, not just the current page.');
});
test('agent directory combines role, department and search filters before pagination',async()=>{
  const h=agentPage(),tree=await h.render({searchParams:Promise.resolve({q:'designer',dept:'creative',leads:'1',page:'999'})});
  assert.deepEqual(agentLinks(tree).map(n=>n.props.href),['/agents/agent-6','/agents/agent-16','/agents/agent-26']);
  const pager=nodes(tree,n=>n.type===components.Pager)[0];assert.equal(pager.props.page,1);assert.equal(pager.props.total,3);
});
test('agent directory empty search has useful recovery without showing another department',async()=>{
  const h=agentPage(),tree=await h.render({searchParams:Promise.resolve({q:'nothing matches'})});
  assert.equal(agentLinks(tree).length,0);assert.match(text(tree),/No matching agents/);assert.match(text(tree),/Clear filters/);
});
function legacyLocation(search,hash){const navigations=[];const original=globalThis.window;globalThis.window={location:{search,hash}};try{compile('../src/app/(app)/approvals/ApprovalAnchor.tsx',{'react':{useEffect:callback=>callback()},'next/navigation':{useRouter:()=>({replace:(...args)=>navigations.push(args)})}}).ApprovalAnchor();}finally{if(original===undefined)delete globalThis.window;else globalThis.window=original;}return navigations;}
test('old approval bookmarks open the corresponding queue without overriding explicit selection',()=>{
  assert.equal(legacyLocation('?pp=2','#plans')[0][0],'/approvals?pp=2&tab=plans#plans');
  assert.equal(legacyLocation('','#decided')[0][0],'/approvals?tab=decided#decided');
  assert.deepEqual(legacyLocation('?tab=reports','#plans'),[]);
  assert.deepEqual(legacyLocation('?report=id','#plans'),[]);
  assert.deepEqual(legacyLocation('','#unrelated'),[]);
});
test('old campaign links use a validated campaign ID and preserve existing feedback',()=>{
  const id='4b0474b7-3d5d-4e9e-8e47-2d52ab5ecab4';
  assert.equal(legacyLocation('?msg=Saved',`#c-${id}`)[0][0],`/approvals?msg=Saved&campaign=${id}#campaign-${id}`);
  assert.deepEqual(legacyLocation('','#c-invalid'),[]);
});
