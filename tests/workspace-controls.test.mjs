import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {pageNumbers,paginationState} from '../src/components/pagination-core.mjs';

const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
function load(path,modules){const exports={},code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('exports','require',code)(exports,id=>{assert.ok(id in modules,`Unmocked import ${id}`);return modules[id];});return exports;}
const nodes=(tree,predicate)=>{if(!tree)return[];if(Array.isArray(tree))return tree.flatMap(t=>nodes(t,predicate));if(typeof tree!=='object')return[];return[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];};
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null||typeof tree==='boolean'?'':String(tree);

test('pagination clamps after filtering, handles empty sets, and never emits invalid page offsets',()=>{
  assert.deepEqual(paginationState(9,15,20),{page:1,pages:1,pageSize:20,total:15,start:0,end:15});
  assert.deepEqual(paginationState(2,26,20),{page:2,pages:2,pageSize:20,total:26,start:20,end:26});
  for(const value of [-1,NaN,Infinity,undefined]){const state=paginationState(value,0,0);assert.equal(state.page,1);assert.equal(state.start,0);assert.equal(state.end,0);}
  for(let page=1;page<=100;page++){const links=pageNumbers(page,100),numbers=links.filter(v=>typeof v==='number');assert.ok(numbers.includes(page));assert.equal(numbers[0],1);assert.equal(numbers.at(-1),100);assert.ok(links.length<=9);assert.equal(new Set(numbers).size,numbers.length);}
});

test('actual pagination controls preserve boundaries and reset on page-size change',()=>{
  const {Pagination}=load('../src/components/Pagination.tsx',{react:{useId:()=>':test:'},'react/jsx-runtime':jsx,'./pagination-core.mjs':{pageNumbers,paginationState}});
  const changes=[],sizes=[],tree=Pagination({page:2,total:42,pageSize:20,onPageChange:p=>changes.push(p),onPageSizeChange:p=>sizes.push(p),label:'campaigns'});
  assert.match(text(tree),/21–40 of 42 campaigns/);
  const controls=nodes(tree,n=>n.type==='button');controls.find(n=>n.props['aria-label']==='Next page of campaigns').props.onClick();assert.deepEqual(changes,[3]);
  nodes(tree,n=>n.type==='select')[0].props.onChange({target:{value:'50'}});assert.deepEqual(sizes,[50]);assert.deepEqual(changes,[3,1]);
  const empty=Pagination({page:4,total:0,pageSize:20,onPageChange:()=>{},label:'campaigns'});assert.match(text(empty),/No campaigns/);assert.ok(nodes(empty,n=>n.type==='button'&&['Previous','Next'].includes(text(n))).every(n=>n.props.disabled));
});

test('server pager keeps independent filters and repeated parameters while dropping stale flash messages',()=>{
  const {Pager}=load('../src/components/ui.tsx',{'react/jsx-runtime':jsx,'./Icon':{Icon:'Icon'},'@/office/engine.mjs':{DEPT_COLOR:{}},'./pagination-core.mjs':{pageNumbers}});
  const tree=Pager({sp:{tab:'history',filter:['meta','google'],msg:'Saved',error:'old',hp:'2'},param:'hp',page:2,size:10,total:95,shown:10,anchor:'history'});
  for(const a of nodes(tree,n=>n.type==='a')){const u=new URL(a.props.href,'https://office.example/usage');assert.equal(u.searchParams.get('tab'),'history');assert.deepEqual(u.searchParams.getAll('filter'),['meta','google']);assert.equal(u.searchParams.has('error'),false);assert.equal(u.searchParams.has('msg'),false);assert.equal(u.hash,'#history');}
  assert.equal(nodes(tree,n=>n.props?.['aria-current']==='page').length,1);
});

test('confirming a consequential form uses the original submitter; cancel and invalid input do not submit',()=>{
  const refs=[],effects=[],states=[];let cursor=0;
  const react={useId:()=>`id-${cursor++}`,useRef:initial=>{const ref={current:initial};refs.push(ref);return ref;},useState:value=>[value,next=>states.push(next)],useEffect:fn=>effects.push(fn)};
  const {Submit}=load('../src/components/forms.tsx',{react,'react-dom':{useFormStatus:()=>({pending:false})},'react/jsx-runtime':jsx,'./Icon':{Icon:'Icon'}});
  const tree=Submit({children:'Publish',name:'decision',value:'approve',confirm:'This publishes the campaign.',confirmLabel:'Publish campaign'});
  const buttons=nodes(tree,n=>n.type==='button'),submitter=buttons[0],calls=[];
  const realButton={disabled:false,form:{reportValidity:()=>true,requestSubmit:button=>calls.push(button)}};refs[0].current=realButton;
  let prevented=0;submitter.props.onClick({preventDefault:()=>prevented++});assert.equal(prevented,1);assert.equal(calls.length,0);assert.equal(states.at(-1),true);
  buttons.find(n=>text(n)==='Cancel').props.onClick();assert.equal(calls.length,0);assert.equal(states.at(-1),false);
  buttons.find(n=>text(n)==='Publish campaign').props.onClick();assert.deepEqual(calls,[realButton]);assert.equal(submitter.props.name,'decision');assert.equal(submitter.props.value,'approve');
  realButton.form.reportValidity=()=>false;states.length=0;submitter.props.onClick({preventDefault(){}});assert.equal(states.length,0);
});
