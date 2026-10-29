import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Run each actual modal, including event capture and beforeunload cleanup.
function harness(file){
  const source=readFileSync(new URL(file,import.meta.url),'utf8'),start=source.indexOf('function Modal('),end=source.indexOf('\nfunction ',start+1);
  const code=ts.transpileModule('export '+source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  let cursor=0,tree,closed=0,dirty=false,busy=false;const states=[],effects=[],pending=[],listeners=new Map();
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
  const hooks={
    useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;dirty=true;}];},
    useRef(){const i=cursor++;if(!(i in states))states[i]={current:{showModal(){},close(){}}};return states[i];},
    useId(){cursor++;return 'modal-title';},
    useEffect(fn,deps){const i=cursor++;if(!effects[i]||!same(effects[i].deps,deps))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
  };
  const exports={};new Function('exports','require','useState','useRef','useId','useEffect','styles','Icon','document','window',code)(exports,()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),hooks.useState,hooks.useRef,hooks.useId,hooks.useEffect,{},'Icon',{activeElement:{focus(){}}},{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)});
  const render=()=>{cursor=0;dirty=false;tree=exports.Modal({title:'Edit draft',busy,onClose:()=>closed++,children:'Saved form input stays mounted'});while(pending.length)pending.shift()();};
  const flush=()=>{if(dirty)render();};
  const find=(node,match)=>{if(Array.isArray(node)){for(const child of node){const hit=find(child,match);if(hit)return hit;}return null;}if(!node||typeof node!=='object')return null;return match(node)?node:find(node.props?.children,match);};
  const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node===null||node===undefined||typeof node==='boolean'?'':String(node);
  render();return {get tree(){return tree;},get closed(){return closed;},listeners,change(){tree.props.onChangeCapture();flush();},escape(){tree.props.onCancel({preventDefault(){}});flush();},footerClose(){let prevented=false,stopped=false;tree.props.onClickCapture({target:{closest:()=>({})},preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});flush();return {prevented,stopped};},click(label){const button=find(tree,node=>node.type==='button'&&text(node)===label);assert.ok(button);assert.ok(!button.props.disabled);button.props.onClick();flush();},has(label){return !!find(tree,node=>node.type==='button'&&text(node)===label);},busy(value){busy=value;render();},unmount(){for(const effect of effects)effect?.cleanup?.();}};
}
for(const [name,file] of [['outcome','../src/app/(app)/outcomes/OutcomeForms.tsx'],['automation','../src/app/(app)/automations/Automations.tsx']]){
  test(`${name} dirty dialogs keep form contents on Escape and footer Cancel, and discard only explicitly`,()=>{
    const h=harness(file);h.change();assert.ok(h.listeners.has('beforeunload'));
    h.escape();assert.equal(h.closed,0);assert.ok(h.has('Keep editing'));h.click('Keep editing');assert.equal(h.closed,0);
    assert.deepEqual(h.footerClose(),{prevented:true,stopped:true});assert.equal(h.closed,0);h.click('Discard draft');assert.equal(h.closed,1);
    h.unmount();assert.equal(h.listeners.size,0);
  });
  test(`${name} unedited dialogs close directly while pending saves block Escape`,()=>{
    const clean=harness(file);clean.escape();assert.equal(clean.closed,1);clean.unmount();
    const busy=harness(file);busy.change();busy.busy(true);busy.escape();assert.equal(busy.closed,0);assert.equal(busy.has('Discard draft'),false);busy.unmount();
  });
}
