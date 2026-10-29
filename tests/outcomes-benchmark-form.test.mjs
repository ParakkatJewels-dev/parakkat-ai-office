import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as display from '../src/app/(app)/outcomes/outcomes-ui.mjs';
import * as automation from '../src/app/(app)/automations/automation-ui.mjs';

const source=readFileSync(new URL('../src/app/(app)/outcomes/OutcomeForms.tsx',import.meta.url),'utf8')+'\nexport const testedConfigureForm=ConfigureForm;';
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const modules={react:{useState:value=>[typeof value==='function'?value():value,()=>{}],useRef:value=>({current:value}),useId:()=> 'field'},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'@/components/Icon':{Icon:'Icon'},'../automations/automation-ui.mjs':automation,'./outcomes-ui.mjs':display,'./Outcomes.module.css':{default:{}}};
const exports={};new Function('exports','require',code)(exports,id=>{assert.ok(id in modules,`Unmocked import ${id}`);return modules[id];});
const find=(node,match)=>{if(!node)return null;if(Array.isArray(node)){for(const child of node){const result=find(child,match);if(result)return result;}return null;}if(typeof node!=='object')return null;return match(node)?node:find(node.props?.children,match);};
const existing={metric:'roas',direction:'higher',target:4,minSample:25,sampleMetric:'purchases',windowDays:30,maturityHours:72,maxDataAgeHours:24};
const suggested={...existing,target:2.4,minSample:10,windowDays:14,maturityHours:48,maxDataAgeHours:48};
const row={id:'record',revision:5,title:'Campaign',department_id:'perf',owner_agent:'lead',metric_config:existing,baseline:{value:4,at:null,source:'Agreed business plan'}};
const benchmark={available:true,settings:suggested,baseline:{value:2.4,at:'2026-10-24T00:00:00Z',source:'Recent provider window'}};
const snapshot={agents:[{id:'lead',name:'Lead',department_id:'perf',enabled:true}]};

test('opening measurement normally preserves the saved plan, while explicit benchmark review only prefills a draft',()=>{
  let writes=0;const send=async()=>{writes++;return {ok:true};};
  const normal=exports.testedConfigureForm({row,snapshot,send,onClose(){},onSaved(){}});
  assert.equal(find(normal,node=>node.type==='input'&&node.props.name==='target').props.defaultValue,4);
  const review=exports.testedConfigureForm({row,benchmark,snapshot,send,onClose(){},onSaved(){}});
  assert.equal(find(review,node=>node.type==='input'&&node.props.name==='target').props.defaultValue,2.4);
  assert.equal(find(review,node=>node.type==='input'&&node.props.name==='minSample').props.defaultValue,10);
  assert.equal(find(review,node=>node.type?.name==='BaselineFields').props.baseline.source,'Recent provider window');
  assert.equal(row.metric_config.target,4,'the persisted row is not mutated by opening a suggestion');
  assert.equal(writes,0,'prefill must never save or call the API automatically');
});

test('an unavailable suggestion cannot replace the saved target or baseline in a form',()=>{
  const tree=exports.testedConfigureForm({row,benchmark:{...benchmark,available:false},snapshot,send:async()=>{throw Error('Unexpected save');},onClose(){},onSaved(){}});
  assert.equal(find(tree,node=>node.type==='input'&&node.props.name==='target').props.defaultValue,4);
  assert.equal(find(tree,node=>node.type?.name==='BaselineFields').props.baseline.source,'Agreed business plan');
});
