import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
function load(file,modules,environment={}){const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports={};new Function('exports','require',...Object.keys(environment),code)(exports,name=>{if(name==='react/jsx-runtime')return jsx;assert.ok(name in modules,`Unmocked import ${name}`);return modules[name];},...Object.values(environment));return exports;}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join('');if(tree&&typeof tree==='object')return text(tree.props.children);return tree==null||typeof tree==='boolean'?'':String(tree);}
class Element {closest(){return null;}}
class HTMLElement extends Element {focus(){this.focused=true;}}
class HTMLAnchorElement extends HTMLElement {constructor(href,options={}){super();Object.assign(this,{href:new URL(href,'https://office.example/agents/manage?agent=lead').href,target:'',download:false},options);}closest(){return this;}hasAttribute(name){return name==='download'&&this.download;}}
class CustomEvent {constructor(type,options={}){Object.assign(this,{type,defaultPrevented:false,...options});}preventDefault(){if(this.cancelable)this.defaultPrevented=true;}}
function harness(){
  const states=[],effects=[],pending=[],documentListeners=new Map(),windowListeners=new Map(),navigations=[];let cursor=0,dirty=false,tree;
  const active=new HTMLElement();const document={activeElement:active,addEventListener:(name,fn,capture)=>documentListeners.set(`${name}:${capture}`,fn),removeEventListener:(name,fn,capture)=>documentListeners.delete(`${name}:${capture}`)};
  const location=new URL('https://office.example/agents/manage?agent=lead');const window={location,addEventListener:(name,fn)=>windowListeners.set(name,fn),removeEventListener:name=>windowListeners.delete(name),dispatchEvent(event){windowListeners.get(event.type)?.(event);return !event.defaultPrevented;}};
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const hooks={
    useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return [states[index],value=>{const next=typeof value==='function'?value(states[index]):value;if(!Object.is(next,states[index])){states[index]=next;dirty=true;}}];},
    useRef(initial){const index=cursor++;if(!(index in states))states[index]={current:initial};return states[index];},
    useId(){return `id-${cursor++}`;},
    useEffect(fn,deps){const index=cursor++;if(!effects[index]||!equal(effects[index].deps,deps))pending.push(()=>{effects[index]?.cleanup?.();effects[index]={deps,cleanup:fn()};});},
  };
  const router={push:href=>navigations.push(href)};
  const AgentManager=load('../src/app/(app)/agents/manage/AgentManager.tsx',{'next/link':{default:'Link'},react:hooks,'next/navigation':{useRouter:()=>router},'@/components/ui':{Avatar:'Avatar',when:String},'@/components/Pagination':{Pagination:'Pagination'},'@/components/Icon':{Icon:'Icon'},'@/lib/roles':{ROLE_LABEL:{}},'./actions':{saveAgentInstructions:()=>{}},'./instruction-form.mjs':{INSTRUCTION_LIMIT:6000,instructionLength:value=>value.length},'./AgentManager.module.css':{default:{}}},{window,document,Element,HTMLElement,HTMLAnchorElement,CustomEvent}).default;
  const agents=[{id:'lead',name:'Lead',role_desc:'Lead',department_id:'sales',is_lead:true,enabled:true,canEdit:true},{id:'worker',name:'Worker',role_desc:'Specialist',department_id:'sales',is_lead:false,enabled:true,canEdit:true}];
  const props={agents,departments:[{id:'sales',name:'Sales'}],selected:{...agents[0],departmentName:'Sales',headRole:'sales',leadName:null},baseGuidance:'Rules',current:null,history:[],lessons:[],brand:null};
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;nodes(tree,n=>n.type==='dialog')[0].props.onClose();}};
  function render(){cursor=0;dirty=false;tree=AgentManager(props);nodes(tree,n=>n.type==='dialog')[0].props.ref.current=dialog;while(pending.length)pending.shift()();}
  function flush(){let n=0;while(dirty){assert.ok(++n<20,'Hooks must settle');render();}}
  render();flush();
  const TopBar=load('../src/components/TopBar.tsx',{'next/link':{default:'Link'},'next/navigation':{},react:{},'@/office/roster.mjs':{BUILDINGS:[],ROOMS:[],PEOPLE:[]},'@/app/login/actions':{},'./Icon':{}},{window,CustomEvent});
  return {navigations,dialog,active,window,documentListeners,windowListeners,get tree(){return tree;},setStatus(status){nodes(tree,n=>typeof n.props?.onStatus==='function')[0].props.onStatus(status);flush();},clickLink(href,options={}){let prevented=false,stopped=false;documentListeners.get('click:true')?.({target:new HTMLAnchorElement(href,options),button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,defaultPrevented:false,...options,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});flush();return {prevented,stopped};},click(label){const button=nodes(tree,n=>n.type==='button'&&text(n)===label)[0];assert.ok(button,`Missing ${label}`);assert.ok(!button.props.disabled);button.props.onClick();flush();},search(href){const allowed=TopBar.navigateWorkspace(href,router.push);flush();return allowed;},escape(){let prevented=false;nodes(tree,n=>n.type==='dialog')[0].props.onCancel({preventDefault(){prevented=true;}});flush();return prevented;},unmount(){for(const effect of effects)effect?.cleanup?.();}};
}

test('instruction draft intercepts sidebar and search navigation, preserves editing, and leaves only after explicit discard',()=>{
  const h=harness();h.setStatus({dirty:true,pending:false});
  assert.deepEqual(h.clickLink('/dashboard'),{prevented:true,stopped:true});assert.equal(h.dialog.open,true);assert.deepEqual(h.navigations,[]);
  h.click('Keep editing');assert.equal(h.dialog.open,false);assert.equal(h.active.focused,true);assert.deepEqual(h.navigations,[]);
  assert.equal(h.search('/outcomes'),false);assert.equal(h.dialog.open,true);assert.deepEqual(h.navigations,[]);
  assert.equal(h.escape(),true);assert.equal(h.dialog.open,false);
  h.clickLink('/agents/manage?agent=worker#agent-detail');h.click('Discard and continue');assert.deepEqual(h.navigations,['/agents/manage?agent=worker#agent-detail']);assert.equal(h.dialog.open,false);
  h.unmount();assert.equal(h.documentListeners.size,0);assert.equal(h.windowListeners.size,0);
});

test('instruction navigation guard ignores new tabs, modifiers, downloads, external links and same-page anchors',()=>{
  const h=harness();h.setStatus({dirty:true,pending:false});
  for(const [href,options] of [['/dashboard',{metaKey:true}],['/dashboard',{ctrlKey:true}],['/dashboard',{shiftKey:true}],['/dashboard',{altKey:true}],['/dashboard',{button:1}],['/dashboard',{target:'_blank'}],['/download',{download:true}],['https://other.example/',{}],['#agent-detail',{}],['/agents/manage?agent=lead#agent-detail',{}]])assert.deepEqual(h.clickLink(href,options),{prevented:false,stopped:false});
  assert.equal(h.dialog.open,false);assert.deepEqual(h.navigations,[]);h.unmount();
});

test('pending instruction saves block navigation and never offer discard; clean navigation remains direct',()=>{
  const h=harness();assert.equal(h.search('/dashboard'),true);assert.deepEqual(h.navigations,['/dashboard']);
  h.setStatus({dirty:true,pending:true});assert.deepEqual(h.clickLink('/usage'),{prevented:true,stopped:true});assert.equal(h.dialog.open,true);assert.match(text(h.tree),/Instructions are saving/);assert.equal(nodes(h.tree,n=>n.type==='button'&&text(n)==='Discard and continue').length,0);
  h.click('Stay on this page');assert.equal(h.search('/outcomes'),false);assert.deepEqual(h.navigations,['/dashboard']);
  h.setStatus({dirty:false,pending:false});assert.equal(h.dialog.open,false);assert.equal(h.search('/outcomes'),true);assert.deepEqual(h.navigations,['/dashboard','/outcomes']);h.unmount();
});
