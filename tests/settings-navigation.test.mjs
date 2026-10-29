import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
function load(file,modules,environment={}) {
  const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports={};
  new Function('exports','require',...Object.keys(environment),code)(exports,name=>{if(name==='react/jsx-runtime')return jsx;assert.ok(name in modules,`Unmocked import ${name}`);return modules[name];},...Object.values(environment));return exports;
}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');if(tree&&typeof tree==='object')return text(tree.props.children);return tree==null||typeof tree==='boolean'?'':String(tree);}
async function expand(tree){if(!tree||typeof tree!=='object')return tree;if(Array.isArray(tree))return Promise.all(tree.map(expand));if(typeof tree.type==='function')return expand(await tree.type(tree.props));return {...tree,props:{...tree.props,children:await expand(tree.props.children)}};}
class Redirect extends Error{constructor(href){super(href);this.href=href;}}
function harness({role='super_admin',paused=false,systemError=null,data={}}={}){
  const queries=[],calls={ai:0,business:0,liveRuns:0};
  const db={from(table){const query={table,operations:[]};queries.push(query);let single=false;const builder={};
    for(const method of ['select','eq','order','range','limit','in','maybeSingle'])builder[method]=(...args)=>{query.operations.push([method,...args]);if(method==='maybeSingle')single=true;return builder;};
    builder.then=(resolve,reject)=>Promise.resolve(table==='system_state'?{data:systemError?null:{paused},error:systemError}:{data:data[table]??(single?null:[]),count:Array.isArray(data[table])?data[table].length:0,error:null}).then(resolve,reject);return builder;
  }};
  const modules={
    'next/link':{default:'Link'},'next/navigation':{redirect:href=>{throw new Redirect(href);}},'@/lib/auth/session':{requireUser:async()=>({db,role})},
    '@/lib/roles':{ROLE_LABEL:{super_admin:'Super admin',viewer:'Viewer'}},'@/lib/agents/campaign':{liveRuns:async()=>{calls.liveRuns++;return new Set();},runSteps:()=>({steps:[],pill:['Done','good']})},
    '@/office/roster.mjs':{BUILDINGS:[]},'@/components/Icon':{Icon:'Icon'},
    '@/components/ui':{PageHead:'PageHead',Avatar:'Avatar',Stepper:'Stepper',Pager:'Pager',pageOf:(sp,key)=>Math.max(1,Number(sp[key])||1),rangeOf:(page,size)=>[(page-1)*size,page*size-1],when:String},
    './Integrations':{Integrations:()=>{calls.business++;return {type:'BusinessProviders',props:{}};},AIIntegrations:()=>{calls.ai++;return {type:'AIProviders',props:{}};}},
    './ModelRouting':{ModelRouting:()=>({type:'ModelRouting',props:{}})},
    './HiggsfieldCard':{HiggsfieldCard:()=>({type:'HiggsfieldCard',props:{}})},
    '@/lib/agents/publish-core.mjs':{publicationBlock:()=>null,hasConfirmedPublication:()=>false},'./SyncButton':{SyncButton:'SyncButton'},'@/components/forms':{Locked:'Locked',Submit:'Submit'},
    './OpportunityRefresh':{OpportunityRefresh:'OpportunityRefresh'},'@/lib/agents/seo-status.mjs':{latestSeoJob:()=>null},'./SettingsDraftGuard':{SettingsDraftGuard:'SettingsDraftGuard'},'./SettingsAnchor':{SettingsAnchor:'SettingsAnchor'},
    './Settings.module.css':{default:new Proxy({},{get:(_,key)=>String(key)})},'./actions':Object.fromEntries(['setRole','setHead','addCompetitor','runCampaign','nextStep','syncNow','togglePause','publishAgain','saveBrandBook','addLesson','retireLesson','findOpportunitiesNow'].map(name=>[name,name])),
  };
  const Admin=load('../src/app/(app)/admin/page.tsx',modules).default;
  return {queries,calls,render:async(sp={})=>expand(await Admin({searchParams:Promise.resolve(sp)}))};
}
const tables=h=>h.queries.map(query=>query.table);
const selectedNav=tree=>nodes(tree,n=>n.type==='Link'&&n.props['aria-current']==='page').map(n=>n.props.href);

test('settings rejects non-admins before any settings, provider or operations reads',async()=>{
  for(const role of ['viewer','creative_head','ecom_manager','perf_marketer']){
    const h=harness({role});await assert.rejects(()=>h.render({tab:'ai'}),error=>error instanceof Redirect&&error.href==='/office');
    assert.deepEqual(h.queries,[]);assert.deepEqual(h.calls,{ai:0,business:0,liveRuns:0});
  }
});

test('settings overview reads only office status and offers navigation instead of loading every settings workspace',async()=>{
  for(const tab of [undefined,'unknown']){
    const h=harness(),tree=await h.render({tab});assert.deepEqual(tables(h),['system_state']);assert.deepEqual(h.calls,{ai:0,business:0,liveRuns:0});
    assert.deepEqual(selectedNav(tree),['/admin']);assert.equal(nodes(tree,n=>n.type==='form').length,0);
    assert.match(text(tree),/Your AI office/);assert.ok(nodes(tree,n=>n.type==='Link'&&n.props.href==='/admin?tab=operations').length);
  }
  const unavailable=harness({systemError:{message:'unavailable'}}),tree=await unavailable.render();assert.match(text(tree),/Office status is unavailable/);assert.match(text(tree),/Status could not be loaded/);assert.doesNotMatch(text(tree),/Scheduled work is enabled/);
});

test('each settings section loads only its intended workspace and highlights the selected navigation',async()=>{
  const cases=[
    ['ai',['system_state','connections'],{ai:1,business:0,liveRuns:0}],
    ['connections',['system_state','connections'],{ai:0,business:1,liveRuns:0}],
    ['team',['system_state','profiles','departments','agents'],{ai:0,business:0,liveRuns:0}],
    ['competitors',['system_state','competitors'],{ai:0,business:0,liveRuns:0}],
    ['operations',['system_state','agent_runs','approvals','autopilot_jobs','agent_runs','agent_runs'],{ai:0,business:0,liveRuns:1}],
  ];
  for(const [tab,expectedTables,expectedCalls] of cases){const h=harness(),tree=await h.render({tab});assert.deepEqual(selectedNav(tree),[`/admin?tab=${tab}`]);assert.deepEqual(tables(h),expectedTables);assert.deepEqual(h.calls,expectedCalls);}
  const h=harness(),tree=await h.render({reviewRequested:'123',msg:'Review requested'});assert.deepEqual(selectedNav(tree),['/admin?tab=operations']);assert.match(text(tree),/Review requested/);assert.equal(h.calls.liveRuns,1);
});

test('brand guidance and learning memory have independent reads, controls and retained filter pagination',async()=>{
  const brand=harness({data:{brand_book:{voice:'Warm and clear',updated_at:'2026-10-27'}}}),brandTree=await brand.render({tab:'brand'});
  assert.deepEqual(tables(brand),['system_state','brand_book']);assert.deepEqual(selectedNav(brandTree),['/admin?tab=brand']);
  assert.deepEqual(nodes(brandTree,n=>n.type==='textarea').map(n=>n.props.name),['voice','always','never','notes']);assert.equal(nodes(brandTree,n=>n.type==='Locked')[0].props.action,'saveBrandBook');
  const memory=harness(),sp={tab:'memory',dept:'creative',lp:'2'},memoryTree=await memory.render(sp);
  assert.deepEqual(tables(memory),['system_state','lessons','departments']);assert.deepEqual(selectedNav(memoryTree),['/admin?tab=memory']);
  const query=memory.queries.find(q=>q.table==='lessons');assert.ok(query.operations.some(op=>op[0]==='eq'&&op[1]==='department_id'&&op[2]==='creative'));assert.deepEqual(query.operations.find(op=>op[0]==='range'),['range',15,29]);
  assert.equal(nodes(memoryTree,n=>n.type==='textarea'&&n.props.name==='voice').length,0);
  const pager=nodes(memoryTree,n=>n.type==='Pager')[0];assert.equal(pager.props.param,'lp');assert.equal(pager.props.page,2);assert.deepEqual(pager.props.sp,sp);
  const filter=nodes(memoryTree,n=>n.type==='form'&&n.props['data-settings-filter']==='true')[0];assert.equal(filter.props.method,'get');assert.equal(nodes(filter,n=>n.type==='input'&&n.props.name==='tab')[0].props.value,'memory');assert.equal(nodes(filter,n=>n.type==='input'&&n.props.name==='lp').length,0);
});

function legacy(search,hash){const routes=[];load('../src/app/(app)/admin/SettingsAnchor.tsx',{'react':{useEffect:callback=>callback()},'next/navigation':{useRouter:()=>({replace:href=>routes.push(href)})}},{window:{location:{search,hash}}}).SettingsAnchor();return routes;}
test('legacy settings anchors retain feedback and review flags while respecting explicit sections',()=>{
  const campaign=legacy('?msg=Saved&reviewRequested=123','#campaign');assert.equal(campaign.length,1);const url=new URL(campaign[0],'https://office.example');assert.equal(url.searchParams.get('tab'),'operations');assert.equal(url.searchParams.get('reviewRequested'),'123');assert.equal(url.searchParams.get('msg'),'Saved');assert.equal(url.hash,'#campaign');
  assert.equal(legacy('','#sync')[0],'/admin?tab=connections#sync');assert.equal(legacy('','#opportunities')[0],'/admin?tab=operations#opportunities');
  assert.equal(legacy('?tab=connections&error=Expired','#chatgpt')[0],'/admin?tab=ai&error=Expired#chatgpt');assert.equal(legacy('','#gemini')[0],'/admin?tab=ai#gemini');
  assert.deepEqual(legacy('?tab=brand','#campaign'),[]);assert.deepEqual(legacy('?tab=ai','#chatgpt'),[]);assert.deepEqual(legacy('','#unrelated'),[]);
});

test('image settings describe Higgsfield without a paid test or Gemini status reads by default',async()=>{
  let configReads=0,budgetReads=0;
  const base={
    '@/components/Icon':{Icon:'Icon'},'@/components/forms':{Locked:'Locked',Submit:'Submit'},'@/components/ui':{when:String},
    '@/lib/llm/gemini-config':{getGeminiStatus:async()=>{configReads++;return {configured:true,status:'connected',checkedAt:'2026-10-28',imageModel:'legacy-image',imageSize:'2K'};}},
    '@/lib/ai-budget':{getImageBudgetStatus:async()=>{budgetReads++;return {enabled:false,blocked:false,daily:2,weekly:4};}},
    './gemini-actions':{generateGeminiTest:'generateGeminiTest',saveGeminiKey:'saveGeminiKey',useGeminiServerKey:'useGeminiServerKey'},
    './Integrations.module.css':{default:{}},
  };
  const handoff=await load('../src/app/(app)/admin/GeminiCard.tsx',{...base,'@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>true}}).GeminiCard();
  assert.equal(configReads,0);assert.equal(budgetReads,0);
  assert.match(text(handoff),/Gemini image API disabled/);
  assert.match(text(handoff),/human review before approval/);
  assert.equal(nodes(handoff,n=>n.type==='form'||n.type==='Locked'||n.type==='Submit').length,0);
  assert.equal(nodes(handoff,n=>n.type==='a'&&n.props.href==='/studio').length,1);
  const legacy=await load('../src/app/(app)/admin/GeminiCard.tsx',{...base,'@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>false}}).GeminiCard();
  assert.equal(configReads,1);assert.equal(budgetReads,1);
  assert.match(text(legacy),/legacy-image/);
  assert.equal(nodes(legacy,n=>n.type==='form'&&n.props.action==='generateGeminiTest').length,1);
});

test('model routing distinguishes automatic Higgsfield and manual ChatGPT from legacy Gemini generation',async()=>{
  let geminiReads=0;
  const base={
    'next/link':{default:'Link'},'./ModelRouting.module.css':{default:{}},
    '@/lib/chatgpt/auth.mjs':{getChatGPTStatus:async()=>({enabled:true,connected:true,usageBlocked:false})},
    '@/lib/llm/nim-config':{getNimStatus:async()=>({status:'connected'})},
    '@/lib/llm/jev-config':{getJevStatus:async()=>({status:'connected'})},
    '@/lib/llm/gemini-config':{getGeminiStatus:async()=>{geminiReads++;return {configured:true};}},
  };
  const handoff=await load('../src/app/(app)/admin/ModelRouting.tsx',{...base,'@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>true}}).ModelRouting();
  assert.equal(geminiReads,0);assert.match(text(handoff),/Subscription credits/);assert.match(text(handoff),/Higgsfield → Studio → human review/);assert.match(text(handoff),/ChatGPT is a manual import option/);assert.doesNotMatch(text(handoff),/Image creation and visual checks use Gemini/);
  const legacy=await load('../src/app/(app)/admin/ModelRouting.tsx',{...base,'@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>false}}).ModelRouting();
  assert.equal(geminiReads,1);assert.match(text(legacy),/Image creation and visual checks use Gemini/);assert.doesNotMatch(text(legacy),/Manual handoff/);
});

test('Higgsfield Settings reads only sanitized local status and offers POST connection controls without generation',async()=>{
  for(const connected of [false,true]){
    let reads=0;
    const card=await load('../src/app/(app)/admin/HiggsfieldCard.tsx',{
      '@/lib/higgsfield/auth.mjs':{getHiggsfieldStatus:async()=>{reads++;return {connected,accountName:'Design team',workspaceName:'Parakkat'};}},
      '@/components/Icon':{Icon:'Icon'},'./Integrations.module.css':{default:{}},
    }).HiggsfieldCard();
    assert.equal(reads,1);assert.match(text(card),/Connecting does not generate images, upgrade your plan, or retry earlier requests/);
    const forms=nodes(card,n=>n.type==='form');
    assert.deepEqual(forms.map(n=>[n.props.method,n.props.action]),connected?[['post','/api/higgsfield/connect'],['post','/api/higgsfield/disconnect']]:[['post','/api/higgsfield/connect']]);
    assert.doesNotMatch(text(card),/Generate test|Upgrade now/);
    if(connected)assert.match(text(card),/Design team.*Parakkat/);
  }
});
