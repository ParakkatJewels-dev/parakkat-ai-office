import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
const source=readFileSync(new URL('../src/app/(app)/usage/TaskUsage.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');if(tree&&typeof tree==='object')return text(tree.props?.children);return tree==null||typeof tree==='boolean'?'':String(tree);}
function harness(result,throws=false){const calls=[],exports={},modules={'react/jsx-runtime':jsx,'@/components/ui':{Pager:'Pager',pageOf:(sp,key)=>Math.max(1,Math.min(10000,parseInt(sp[key]||'1')||1)),when:value=>value},'./TaskUsage.module.css':{default:new Proxy({},{get:(_,key)=>key})}};
  new Function('exports','require',code)(exports,name=>{assert.ok(name in modules,name);return modules[name];});
  const db={rpc:async(name,args)=>{calls.push({name,args});if(throws)throw new Error('private database failure');return result;}};
  return {calls,render:sp=>exports.default({db,sp,from:'2026-10-01',to:'2026-10-27'})};
}
const totals={calls:3,failed_calls:1,input_tokens:120,output_tokens:30,unknown_calls:1,estimated_tokens:2400,reused:4};
const row={...totals,task_kind:'conversation',task_id:'00000000-0000-4000-8000-000000000001',task_status:'completed',last_at:'2026-10-27T08:00:00Z',pending_calls:0,cache_reused:1,inflight_reused:1,deterministic_reused:1,checkpoint_reused:1,prompt:'PRIVATE PROMPT',title:'PRIVATE TITLE'};
test('task usage keeps measured/unknown/reused categories distinct and never renders extra private data',async()=>{
  const h=harness({data:{rows:[row],total:26,page:2,pageSize:20,totals},error:null}),sp={tab:'tasks',range:'30',taskKind:'conversation',taskStatus:'completed',tp:'2'},tree=await h.render(sp);
  assert.deepEqual(h.calls,[{name:'task_usage_report',args:{p_from:'2026-10-01T00:00:00Z',p_to:'2026-10-28T00:00:00.000Z',p_kind:'conversation',p_status:'completed',p_page:2,p_page_size:20}}]);
  const rendered=text(tree);assert.match(rendered,/Measured tokens/);assert.match(rendered,/Unknown usage/);assert.match(rendered,/2,400\s+estimated tokens/);assert.match(rendered,/Reused results/);assert.doesNotMatch(rendered,/PRIVATE PROMPT|PRIVATE TITLE/);
  const pager=nodes(tree,n=>n.type==='Pager')[0];assert.equal(pager.props.page,2);assert.equal(pager.props.total,26);assert.equal(pager.props.sp.taskKind,'conversation');assert.equal(pager.props.sp.taskStatus,'completed');
  const form=nodes(tree,n=>n.type==='form')[0];assert.equal(form.props.method,'get');assert.equal(nodes(form,n=>n.type==='input'&&n.props.name==='tp').length,0,'filter changes reset pagination');
});
test('invalid filters are bounded and missing telemetry reports an error instead of fabricated zero usage',async()=>{
  for(const fails of [false,true]){const h=harness({error:{message:'private database failure'},data:null},fails),tree=await h.render({taskKind:'evil',taskStatus:'private',ts:'999',tp:'999999'});assert.equal(h.calls[0].args.p_kind,'all');assert.equal(h.calls[0].args.p_status,'all');assert.equal(h.calls[0].args.p_page_size,20);assert.equal(h.calls[0].args.p_page,10000);assert.equal(nodes(tree,n=>n.props?.role==='alert').length,1);assert.doesNotMatch(text(tree),/private database failure|Measured tokens|No tracked tasks/);}
});
test('empty tracking explains historical attribution limits and uses clamped SQL pagination',async()=>{
  const h=harness({data:{rows:[],total:0,page:1,pageSize:50,totals:Object.fromEntries(Object.keys(totals).map(key=>[key,0]))},error:null});
  const tree=await h.render({taskStatus:'completed',ts:'50',tp:'999'});assert.match(text(tree),/Earlier calls cannot reliably be linked/);assert.equal(nodes(tree,n=>n.type==='Pager')[0].props.page,1);assert.equal(nodes(tree,n=>n.type==='Pager')[0].props.size,50);
});
