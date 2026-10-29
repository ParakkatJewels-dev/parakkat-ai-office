import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const code=ts.transpileModule(readFileSync(new URL('../src/app/(app)/studio/ChatGPTArtwork.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
const nodes=(tree,predicate)=>!tree?[]:Array.isArray(tree)?tree.flatMap(child=>nodes(child,predicate)):typeof tree!=='object'?[]:[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(' '):tree&&typeof tree==='object'?text(tree.props?.children):tree==null||typeof tree==='boolean'?'':String(tree);
const json=value=>({ok:true,json:async()=>value});
const state=job=>({enabled:true,requestId:'request-1',job});
function harness(initial=state(null)) {
  const hooks=[],effects=[],queue=[],timers=[],calls=[];let cursor=0,tree,refreshes=0,next=async()=>json(initial);
  const router={refresh:()=>refreshes++};
  const changed=(a,b)=>!a||a.length!==b.length||b.some((value,index)=>!Object.is(value,a[index]));
  const react={
    useId(){return `id-${cursor++}`;},useRef(value){const index=cursor++;return hooks[index]||(hooks[index]={current:value});},
    useState(value){const index=cursor++;if(!(index in hooks))hooks[index]=value;return[hooks[index],next=>{hooks[index]=typeof next==='function'?next(hooks[index]):next;}];},
    useCallback(fn,deps){const index=cursor++;if(!hooks[index]||changed(hooks[index].deps,deps))hooks[index]={fn,deps};return hooks[index].fn;},
    useEffect(fn,deps){const index=cursor++;if(!effects[index]||changed(effects[index].deps,deps))queue.push(()=>{effects[index]?.cleanup?.();effects[index]={deps,cleanup:fn()};});},
  };
  const modules={react,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>router},'./ChatGPTArtwork.module.css':{default:new Proxy({},{get:(_,key)=>key})}};
  const exports={};
  new Function('exports','require','fetch','setTimeout','clearTimeout',code)(exports,name=>{assert.ok(name in modules,`Unexpected import ${name}`);return modules[name];},async(...args)=>{calls.push(args);return next(...args);},(fn,delay)=>{const timer={fn,delay,cancelled:false};timers.push(timer);return timer;},timer=>{timer.cancelled=true;});
  const render=()=>{cursor=0;tree=exports.ChatGPTAutomaticArtwork({source:'design',id:'design-1',requestId:'request-1',title:'Fine Millennium'});while(queue.length)queue.shift()();};
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));render();};render();
  return {calls,timers,settle,get tree(){return tree;},get refreshes(){return refreshes;},setFetch(fn){next=fn;},
    button(label){return nodes(tree,node=>node.type==='button'&&text(node)===label)[0];},
    async click(label){const button=this.button(label);assert.ok(button,`Missing ${label}`);assert.ok(!button.props.disabled);button.props.onClick();await settle();},
    async poll(){const timer=timers.find(timer=>!timer.cancelled&&timer.delay===5000);assert.ok(timer);timer.cancelled=true;timer.fn();await settle();},
    unmount(){for(const effect of effects)effect?.cleanup?.();},
  };
}

test('opening automatic controls reads only status and starts only on an explicit click',async()=>{
  const h=harness();await h.settle();assert.equal(h.calls.length,1);assert.match(h.calls[0][0],/\/chatgpt-generation$/);assert.equal(h.calls[0][1].method,undefined);
  assert.match(text(h.tree),/ChatGPT plan/);assert.ok(h.button('Generate with ChatGPT'));
  h.setFetch(async(_url,init)=>{assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{requestId:'request-1'});return json({job:{id:'job-1',state:'queued'}});});
  const click=h.button('Generate with ChatGPT').props.onClick;click();click();await h.settle();
  assert.equal(h.calls.length,2);assert.match(text(h.tree),/Queued for ChatGPT/);assert.equal(h.button('Generate with ChatGPT'),undefined);
  assert.ok(h.calls.every(([url])=>url.endsWith('/chatgpt-generation')),'no credit or paid-provider endpoint is invoked');
});

test('queued work polls to completion, keeps human review, and cannot be submitted again',async()=>{
  const h=harness(state({id:'job-1',state:'queued'}));await h.settle();
  h.setFetch(async()=>json(state({id:'job-1',state:'succeeded',imageUrl:'https://office.test/output.png'})));await h.poll();
  assert.match(text(h.tree),/Human review is required/);assert.equal(h.button('Generate with ChatGPT'),undefined);assert.ok(h.refreshes>0);
  assert.equal(nodes(h.tree,node=>node.type==='img')[0].props.src,'https://office.test/output.png');
  assert.equal(h.timers.filter(timer=>!timer.cancelled).length,0);
});

test('uncertain work cannot retry while known preflight blocks offer explicit retry',async()=>{
  const uncertain=harness(state({id:'job-1',state:'uncertain',error:'Outcome unknown'}));await uncertain.settle();
  assert.equal(uncertain.button('Generate with ChatGPT'),undefined);assert.equal(uncertain.button('Retry ChatGPT preparation'),undefined);assert.match(text(uncertain.tree),/saved files need to be checked/);
  const blocked=harness(state({id:'job-1',state:'blocked',error:'Sign in first'}));await blocked.settle();assert.ok(blocked.button('Retry ChatGPT preparation'));
  assert.equal(blocked.timers.filter(timer=>!timer.cancelled).length,0);
});

test('stale request status cannot enable a queue action and late unmounted responses are ignored',async()=>{
  const stale=harness({...state(null),requestId:'different-request'});await stale.settle();assert.match(text(stale.tree),/request changed/);assert.equal(stale.button('Generate with ChatGPT'),undefined);
  const h=harness();await h.settle();let finish;h.setFetch(()=>new Promise(resolve=>{finish=resolve;}));
  h.button('Refresh generation status').props.onClick();h.unmount();finish(json(state({id:'job-1',state:'succeeded'})));await h.settle();
  assert.equal(h.refreshes,0);assert.equal(h.calls.at(-1)[1].signal.aborted,true);
});
