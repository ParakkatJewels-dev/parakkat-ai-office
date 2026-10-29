import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as accounts from '../src/lib/connectors/accounts.mjs';

const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
function load(file,modules,env={}){
  const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports={};
  new Function('exports','require','process',code)(exports,name=>{if(name==='react/jsx-runtime')return jsx;assert.ok(name in modules,`Unmocked import ${name}`);return modules[name];},{env});return exports;
}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join('');if(tree&&typeof tree==='object')return text(tree.props.children);return tree==null||typeof tree==='boolean'?'':String(tree);}
function outsideDetails(tree){if(!tree||typeof tree!=='object')return tree;if(Array.isArray(tree))return tree.map(outsideDetails);return tree.type==='details'?null:{...tree,props:{...tree.props,children:outsideDetails(tree.props.children)}};}
const shared={'@/components/Icon':{Icon:'Icon'},'@/components/forms':{Locked:'Locked',Submit:'Submit',GoLink:'GoLink'},'@/components/ui':{when:String},'./Integrations.module.css':{default:new Proxy({},{get:(_,key)=>String(key)})}};
const card=(tree,id)=>nodes(tree,n=>n.type==='li'&&n.props.id===id)[0];

test('business connection cards preserve account controls, keep errors visible, and exclude AI providers',async()=>{
  let selected='';
  const saved=[{provider:'meta',settings:{ad_account_ids:['123'],ad_account_id:'123',page_id:'page1',choices:{ads:[{id:'123',name:'Sales'}],pages:[{id:'page1',name:'Parakkat'}]}},updated_at:'2026-10-26'},
    {provider:'google',settings:{customer_ids:['456'],customer_id:'456',ga4_property_id:'100',note:'Keyword Planner access denied',choices:{customers:[{id:'456',name:'Ads',manager:false}],properties:[{id:'100',name:'Store'}]}},updated_at:'2026-10-26'},
    {provider:'shopify',settings:{shop:'example.myshopify.com'},updated_at:'2026-10-26'},
    {provider:'odoo',settings:{url:'https://example.odoo.com',warehouses:['Main']},updated_at:'2026-10-26'}];
  const {Integrations,AIIntegrations}=load('../src/app/(app)/admin/Integrations.tsx',{
    ...shared,'@/lib/supabase/admin':{supabaseAdmin:()=>({from:()=>({select:async fields=>{selected=fields;return {data:saved,error:null};}})})},
    '@/lib/connectors/connect':{APP_KEYS:{meta:[],google:[],shopify:[]},appReady:()=>true},'@/lib/connectors/accounts.mjs':accounts,
    './actions':{chooseAccounts:'chooseAccounts',disconnect:'disconnect',connectOdoo:'connectOdoo',disconnectOdoo:'disconnectOdoo'},'./ChatGPTCard':{ChatGPTCard:'ChatGPTCard'},'./NimCard':{NimCard:'NimCard'},'./GeminiCard':{GeminiCard:'GeminiCard'},'./JevCard':{JevCard:'JevCard'},
  });
  const tree=await Integrations();
  assert.equal(selected,'provider, settings, expires_at, updated_at');
  const aiCards=['ChatGPTCard','NimCard','GeminiCard','JevCard'];
  assert.equal(nodes(tree,n=>aiCards.includes(n.type)).length,0);
  assert.deepEqual(nodes(AIIntegrations(),n=>aiCards.includes(n.type)).map(node=>node.type),aiCards);
  for(const id of ['meta','google','shopify']){
    const item=card(tree,id);assert.ok(item);assert.equal(nodes(item,n=>n.type==='details')[0].props.open,false);
    assert.match(nodes(item,n=>n.type==='Submit'&&n.props.confirm)[0].props.confirm,/installed server credentials/);
  }
  assert.match(text(outsideDetails(card(tree,'google'))),/Keyword Planner access denied/);
  assert.equal(nodes(card(tree,'google'),n=>n.type==='select'&&n.props.name==='ga4')[0].props.defaultValue,'100');
  assert.equal(nodes(card(tree,'meta'),n=>n.type==='select'&&n.props.name==='launch')[0].props.defaultValue,'123');
  assert.equal(nodes(card(tree,'shopify'),n=>n.type==='form'&&n.props.action==='/api/connect/shopify')[0].props.method,'get');
  const odooNode=nodes(tree,n=>typeof n.type==='function'&&n.type.name==='OdooCard')[0],odoo=odooNode.type(odooNode.props);
  assert.equal(odoo.props.id,'odoo');assert.equal(nodes(odoo,n=>n.type==='details')[0].props.open,false);
  assert.equal(nodes(odoo,n=>n.type==='input'&&n.props.name==='key')[0].props.required,false);
});

test('AI provider cards retain visible limits/errors with saved setup collapsed and paid tests explicit',async()=>{
  let modelCalls=0;
  const status={enabled:true,connected:true,activeAccountId:'account1',usageBlocked:true,accounts:[{id:'account1',active:true,connected:true,label:'Office'}],models:{manager:'manager-model',worker:'worker-model'}};
  const {ChatGPTCard}=load('../src/app/(app)/admin/ChatGPTCard.tsx',{
    ...shared,'@/lib/chatgpt/auth.mjs':{getChatGPTStatus:async()=>status},'@/lib/llm/chatgpt.mjs':{listChatGPTModels:async()=>{modelCalls++;return [];}},
    './chatgpt-actions':{chooseChatGPTAccount:'chooseAccount',disconnectChatGPT:'disconnect',resumeChatGPT:'resume',saveChatGPTModels:'models'},
  },{LLM_PROVIDER:'chatgpt'});
  const chat=await ChatGPTCard();assert.equal(chat.props.id,'chatgpt');assert.equal(modelCalls,0);
  assert.match(text(outsideDetails(chat)),/reached its plan usage limit/);
  assert.ok(nodes(outsideDetails(chat),n=>n.type==='form'&&n.props.action==='resume').length);
  for(const details of nodes(chat,n=>n.type==='details'))assert.equal(details.props.open,false);
  assert.match(nodes(chat,n=>n.type==='Submit'&&n.props.confirm)[0].props.confirm,/saved ChatGPT credentials/);
  const {GeminiCard}=load('../src/app/(app)/admin/GeminiCard.tsx',{
    ...shared,'@/lib/llm/gemini-config':{getGeminiStatus:async()=>({configured:true,status:'error',source:'saved',error:'Image quota unavailable',imageModel:'image-model'})},
    '@/lib/ai-budget':{getImageBudgetStatus:async()=>({daily:2,dailyLimit:10,weekly:3,weeklyLimit:20,blocked:false})},
    '@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>false},
    './gemini-actions':{generateGeminiTest:'generate',saveGeminiKey:'save',useGeminiServerKey:'restore'},
  });
  const gemini=await GeminiCard();assert.equal(gemini.props.id,'gemini');assert.match(text(outsideDetails(gemini)),/Image quota unavailable/);
  assert.equal(nodes(gemini,n=>n.type==='details')[0].props.open,false);
  const key=nodes(gemini,n=>n.type==='input'&&n.props.name==='key')[0];assert.equal(key.props.type,'password');assert.equal(key.props.required,false);assert.equal(key.props.value,undefined);
  const generate=nodes(gemini,n=>n.type==='Submit'&&n.props.name==='generate')[0];assert.equal(generate.props.value,'yes');assert.match(generate.props.confirm,/usage charges/);
  assert.match(nodes(gemini,n=>n.type==='Submit'&&n.props.confirmTitle==='Use the installed server key?')[0].props.confirm,/otherwise it will wait/);
  const {JevCard}=load('../src/app/(app)/admin/JevCard.tsx',{
    ...shared,'@/lib/llm/jev-config':{getJevStatus:async()=>({configured:true,status:'error',source:'saved',error:'Jev usage limit reached',model:'jev-latest'})},
    './jev-actions':{runJevTest:'classify',saveJevKey:'saveJev',useJevServerKey:'restoreJev'},
  });
  const jev=await JevCard();assert.equal(jev.props.id,'jev');assert.match(text(outsideDetails(jev)),/Jev usage limit reached/);
  assert.equal(nodes(jev,n=>n.type==='details')[0].props.open,false);
  const jevKey=nodes(jev,n=>n.type==='input'&&n.props.name==='key')[0];assert.equal(jevKey.props.type,'password');assert.equal(jevKey.props.required,false);assert.equal(jevKey.props.value,undefined);
  assert.equal(nodes(jev,n=>n.type==='Locked')[0].props.action,'saveJev');
  const classify=nodes(jev,n=>n.type==='Submit'&&n.props.name==='classify')[0];assert.equal(classify.props.value,'yes');assert.match(classify.props.confirm,/synthetic classification/);assert.match(classify.props.confirm,/usage charges/);
  assert.equal(nodes(jev,n=>n.type==='form'&&n.props.action==='classify').length,1);
});

class Redirect extends Error{constructor(href){super(href);this.href=href;}}
const redirect=href=>{throw new Redirect(href);};
async function goesTo(call,expected){await assert.rejects(call,error=>error instanceof Redirect&&expected.test(error.href));}
test('AI actions return to their provider tab, preserve permissions, and never generate from a missing test intent',async()=>{
  let role='super_admin',selected=0,metadata=0,images=0;
  const actionShared={'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect},'@/lib/auth/session':{requireUser:async()=>({role})}};
  const chat=load('../src/app/(app)/admin/chatgpt-actions.ts',{
    ...actionShared,'@/lib/chatgpt/auth.mjs':{authEnabled:()=>true,selectAccount:async()=>{selected++;}},'@/lib/llm/chatgpt.mjs':{},
  });
  const form=new FormData();form.set('account','account1');await goesTo(()=>chat.chooseChatGPTAccount(form),/^\/admin\?tab=ai&msg=.*#chatgpt$/);assert.equal(selected,1);
  role='staff';await goesTo(()=>chat.chooseChatGPTAccount(form),/^\/office$/);assert.equal(selected,1);role='super_admin';
  const gemini=load('../src/app/(app)/admin/gemini-actions.ts',{
    '@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>false},
    ...actionShared,'node:crypto':{randomUUID:()=>''},'@/lib/supabase/admin':{supabaseAdmin:()=>{throw Error('Test must not acquire a generation lock');}},
    '@/lib/llm/gemini-config':{getGeminiConfig:async()=>({apiKey:'saved',imageModel:'image',textModel:'text'}),saveGeminiOverride:async()=>{},syncGeminiStatus:async()=>{},safeGeminiError:()=> 'Safe error'},
    '@/lib/llm/gemini-core.mjs':{cleanGeminiKey:value=>value,checkGeminiModel:async()=>{metadata++;},GeminiError:Error},
    '@/lib/llm/gemini':{generateGeminiTestImage:async()=>{images++;}},'@/lib/pause':{Paused:class extends Error{}},'@/lib/usage':{},'@/lib/ai-budget':{},
  });
  await goesTo(()=>gemini.saveGeminiKey(new FormData()),/^\/admin\?tab=ai&msg=.*#gemini$/);assert.equal(metadata,2);assert.equal(images,0);
  await goesTo(()=>gemini.generateGeminiTest(new FormData()),/^\/admin\?tab=ai&error=.*#gemini$/);assert.equal(images,0);
  role='staff';await goesTo(()=>gemini.saveGeminiKey(new FormData()),/^\/office$/);assert.equal(metadata,2);
});
