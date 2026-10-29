import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const nodes = (tree, predicate) => !tree ? [] : Array.isArray(tree) ? tree.flatMap(child => nodes(child, predicate)) : typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const code = ts.transpileModule(readFileSync(new URL('../src/app/(app)/studio/ChatGPTArtwork.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const packet = { requestId: 'request-1', prompt: 'Make the exact fine flat chain with these product photos and style references.' };
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function harness(options = {}) {
  const states = [], calls = [], copied = [], downloads = [], revoked = [], timers = [], effects = [], effectQueue = [], active = [];
  let cursor = 0, tree, refreshes = 0, nextFetch = options.fetch || (async () => json(packet));
  const react = {
    useId: () => `test-${cursor++}`,
    useRef(initial) { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index]; },
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useEffect(fn,deps) { const index=cursor++;if(!effects[index]||deps.some((value,i)=>!Object.is(value,effects[index].deps[i])))effectQueue.push(()=>{effects[index]?.cleanup?.();effects[index]={deps,cleanup:fn()};}); },
  };
  const modules = { react, 'react/jsx-runtime': jsx, 'next/navigation': { useRouter: () => ({ refresh: () => refreshes++ }) }, './ChatGPTArtwork.module.css': { default: new Proxy({}, { get: (_, key) => key }) } };
  const environment = {
    fetch: async (...args) => { calls.push(args); return nextFetch(...args); },
    navigator: { clipboard: { writeText: async value => { if (options.clipboardFails) throw new Error('Permission denied'); if (options.clipboardWrite) return options.clipboardWrite(value); copied.push(value); } } },
    document: { body: { appendChild() {} }, createElement() { return { href: '', download: '', click() { downloads.push({ href: this.href, download: this.download }); }, remove() {} }; } },
    URL: { createObjectURL: () => 'blob:pack', revokeObjectURL: value => revoked.push(value) },
    setTimeout: (fn,delay) => { const timer={fn,delay,cancelled:false};timers.push(timer);if(!options.manualTimers&&!options.automatic)fn();return timer; },
    clearTimeout: timer => { timer.cancelled=true; },
  };
  const exports = {};
  new Function('exports', 'require', ...Object.keys(environment), code)(exports, id => { assert.ok(id in modules, `Unmocked import ${id}`); return modules[id]; }, ...Object.values(environment));
  function render() { cursor = 0; tree = exports[options.automatic?'HiggsfieldGeneration':'ChatGPTArtwork']({ source: 'design', id: 'design-1', requestId: options.requestId === undefined ? 'request-1' : options.requestId, title: 'Fine Millennium', compact: true, status:options.status,initialProvider:options.initialProvider,initialGenerating:options.status==='generating',onActive:value=>active.push(value) });while(effectQueue.length)effectQueue.shift()(); }
  async function settle() { await new Promise(resolve => setImmediate(resolve)); render(); }
  render();
  if(!options.automatic&&!options.keepInitialProvider&&options.initialProvider!=='higgsfield'){nodes(tree,n=>n.type==='input'&&n.props.type==='radio'&&n.props.value==='chatgpt')[0].props.onChange();render();}
  return {
    calls, copied, downloads, revoked, active, timers, get tree() { return tree; }, get refreshes() { return refreshes; },
    button(label) { const button = nodes(tree, n => n.type === 'button' && text(n) === label)[0]; assert.ok(button, `Missing button ${label}`); return button; },
    async click(label) { const button = this.button(label); assert.ok(!button.props.disabled); button.props.onClick(); await settle(); },
    file(file) { nodes(tree, n => n.type === 'input' && n.props.type === 'file')[0].props.onChange({ target: { files: file ? [file] : [] } }); render(); },
    provider(value) { const radio=nodes(tree,n=>n.type==='input'&&n.props.type==='radio'&&n.props.value===value)[0];assert.ok(radio);radio.props.onChange();render(); },
    model(value) { nodes(tree,n=>n.type==='select')[0].props.onChange({target:{value}});render(); },
    status(value) { options.status=value;render(); },
    async submit() { let prevented = false; nodes(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() { prevented = true; } }); assert.ok(prevented); await settle(); },
    setFetch(fn) { nextFetch = fn; }, settle,
    async fireTimers(delay) { for(const timer of timers.filter(timer=>!timer.cancelled&&timer.delay===delay)){timer.cancelled=true;timer.fn();}await settle(); },
  };
}

test('handoff makes no automatic requests and copy/download are explicit with manual ChatGPT instructions', async () => {
  const h = harness();
  assert.equal(h.calls.length, 0);
  assert.match(text(h.tree), /Create the image in ChatGPT, then import it here/);
  assert.equal(nodes(h.tree, n => n.type === 'a' && n.props.href === 'https://chatgpt.com/').length, 1);
  assert.equal(h.button('Import for review').props.disabled, true);
  await h.click('Copy brief');
  assert.deepEqual(h.copied, [packet.prompt]);
  assert.equal(h.calls[0][0], '/api/studio/artwork/design/design-1/packet?provider=chatgpt');
  assert.equal(h.calls[0][1].cache, 'no-store');
  h.setFetch(async url => { assert.match(url, /\/pack\?provider=chatgpt$/); return { ok: true, blob: async () => new Blob(['pack']) }; });
  await h.click('Download reference pack');
  assert.equal(h.calls.length, 2, 'the same packet is reused only inside this mounted request');
  assert.deepEqual(h.downloads, [{ href: 'blob:pack', download: 'parakkat-artwork-design-1.zip' }]);
  assert.deepEqual(h.revoked, ['blob:pack']);
  assert.match(text(h.tree), /Unzip it and attach/);
});

test('clipboard rejection still exposes the brief and stale packets never download source assets', async () => {
  const h = harness({ clipboardFails: true });
  await h.click('Copy brief');
  assert.match(text(h.tree), /Select and copy/);
  assert.equal(nodes(h.tree, n => n.type === 'textarea')[0].props.value, packet.prompt);
  const stale = harness({ fetch: async () => json({ ...packet, requestId: 'newer-request' }) });
  await stale.click('Download reference pack');
  assert.equal(stale.calls.length, 1);
  assert.equal(stale.downloads.length, 0);
  assert.match(text(stale.tree), /request has changed/);
});

test('a hung clipboard permission releases download and upload controls after two seconds with manual-copy fallback',async()=>{
  let rejectClipboard;
  const h=harness({manualTimers:true,clipboardWrite:()=>new Promise((_resolve,reject)=>{rejectClipboard=reject;})});
  await h.click('Copy brief');
  assert.equal(h.button('Preparing brief…').props.disabled,true);
  await h.fireTimers(2000);
  assert.equal(h.button('Copy brief').props.disabled,false);
  assert.equal(h.button('Download reference pack').props.disabled,false);
  assert.equal(nodes(h.tree,n=>n.type==='input'&&n.props.type==='file')[0].props.disabled,false);
  assert.equal(nodes(h.tree,n=>n.type==='details'&&n.props.className==='brief')[0].props.open,true);
  assert.match(text(h.tree),/Select and copy it/);
  rejectClipboard(new Error('Late browser permission rejection'));await h.settle();
  assert.match(text(h.tree),/Select and copy it/);
  h.setFetch(async()=>({ok:true,blob:async()=>new Blob(['pack'])}));
  await h.click('Download reference pack');
  assert.equal(h.downloads.length,1,'the timed-out copy does not leave the action guard locked');
});

test('upload rejects invalid size or type before a request and submits the request token with the actual image', async () => {
  const h = harness();
  for (const bad of [{ type: 'image/gif', size: 12 }, { type: 'image/png', size: 20 * 1024 * 1024 + 1 }, { type: 'image/png', size: 0 }]) {
    h.file(bad); await h.submit(); assert.equal(h.calls.length, 0);
    assert.equal(nodes(h.tree, n => n.props?.role === 'alert').length, 1);
  }
  const file = new File(['image'], 'finished.png', { type: 'image/png' });
  h.file(file);
  h.setFetch(async (url, init) => {
    assert.match(url, /\/import$/); assert.equal(init.method, 'POST');
    assert.equal(init.body.get('requestId'), 'request-1');
    assert.equal(init.body.get('provider'), 'chatgpt');
    assert.equal(init.body.get('file').name, 'finished.png');
    assert.equal(await init.body.get('file').text(), 'image');
    return json({ id: 'design-1', source: 'design', status: 'ready', imageUrl: 'https://office.example/new.png', version: 3 });
  });
  await h.submit();
  assert.equal(h.refreshes, 1);
  assert.match(text(h.tree), /Ready for human review/);
  assert.doesNotMatch(text(h.tree), /AI.checked|product match passed/i);
  assert.equal(nodes(h.tree, n => n.type === 'img')[0].props.src, 'https://office.example/new.png');
});

test('failed imports keep the selected file retryable and display the server conflict without claiming success', async () => {
  const h = harness({ fetch: async () => json({ error: 'This request was already imported or replaced. Refresh the page.' }, 409) });
  h.file(new File(['image'], 'finished.webp', { type: 'image/webp' }));
  await h.submit();
  assert.match(text(h.tree), /already imported or replaced/);
  assert.equal(h.refreshes, 0);
  assert.equal(h.button('Import for review').props.disabled, false);
  assert.equal(nodes(h.tree, n => n.type === 'img').length, 0);
});

test('repeat clicks while a brief is loading issue only one request', async () => {
  let resolve;
  const h = harness({ fetch: () => new Promise(done => { resolve = done; }) });
  const button = h.button('Copy brief');
  button.props.onClick(); button.props.onClick();
  await h.settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.button('Preparing brief…').props.disabled, true);
  resolve(json(packet)); await h.settle();
  assert.deepEqual(h.copied, [packet.prompt]);
});

test('Higgsfield uses its website, provider-specific handoff requests and import provenance without changing the artwork request',async()=>{
  const h=harness();
  h.provider('higgsfield');
  assert.equal(h.calls.length,0,'choosing a provider does not generate or load assets');
  assert.match(text(h.tree),/Higgsfield artwork/);
  assert.match(text(h.tree),/Nano Banana Pro/);
  assert.match(text(h.tree),/Nano Banana Pro with Unlimited enabled/);
  assert.match(text(h.tree),/Confirm the generate button says Unlimited before generating/);
  assert.match(text(h.tree),/Availability depends on the model and resolution/);
  assert.match(text(h.tree),/Your Higgsfield plan and model limits apply/);
  assert.equal(nodes(h.tree,n=>n.type==='a'&&n.props.href==='https://higgsfield.ai/ai/image?model=nano-banana-pro').length,1);
  await h.click('Copy brief');
  assert.equal(h.calls[0][0],'/api/studio/artwork/design/design-1/packet?provider=higgsfield');
  assert.match(text(h.tree),/reference images with it in Higgsfield/);
  h.setFetch(async url=>{assert.match(url,/\/pack\?provider=higgsfield$/);return {ok:true,blob:async()=>new Blob(['pack'])};});
  await h.click('Download reference pack');
  h.file(new File(['artwork'],'finished.webp',{type:'image/webp'}));
  h.setFetch(async(url,init)=>{
    assert.equal(url,'/api/studio/artwork/design/design-1/import');
    assert.equal(init.body.get('provider'),'higgsfield');
    assert.equal(init.body.get('requestId'),'request-1');
    return json({status:'ready',imageUrl:'https://office.example/higgsfield.webp',version:4,provider:'higgsfield'});
  });
  await h.submit();
  assert.match(text(h.tree),/Higgsfield artwork imported · v4/);
  assert.doesNotMatch(text(h.tree),/ChatGPT artwork imported/);
  assert.match(text(h.tree),/Ready for human review/);
});

test('provider changes clear a previous brief and selected file and are blocked while a request is running',async()=>{
  const h=harness();
  await h.click('Copy brief');
  h.file(new File(['image'],'chatgpt.png',{type:'image/png'}));
  assert.equal(h.button('Import for review').props.disabled,false);
  h.provider('higgsfield');
  assert.equal(h.button('Import for review').props.disabled,true);
  assert.equal(nodes(h.tree,n=>n.type==='textarea').length,0);
  let resolve;
  h.setFetch(()=>new Promise(done=>{resolve=done;}));
  const copy=h.button('Copy brief');copy.props.onClick();await h.settle();
  assert.equal(nodes(h.tree,n=>n.type==='fieldset')[0].props.disabled,true);
  h.provider('chatgpt');
  assert.match(text(h.tree),/Higgsfield artwork/);
  resolve(json(packet));await h.settle();
  assert.equal(h.calls[1][0],'/api/studio/artwork/design/design-1/packet?provider=higgsfield');
  assert.equal(nodes(h.tree,n=>n.type==='fieldset')[0].props.disabled,false);
});

const generationStatus=(extra={})=>({connected:true,accountName:'Design account',balance:{credits:50},models:[{id:'gpt_image_2_5',name:'GPT Image 2.5',credits:12,available:true},{id:'nano_banana_pro',name:'Nano Banana Pro',credits:8,available:true}],job:null,requestId:'request-1',...extra});

test('automatic Higgsfield checks are lazy, display actual cost and balance, and default to GPT Image 2.5',async()=>{
  const h=harness({automatic:true,fetch:async()=>json(generationStatus())});
  assert.equal(h.calls.length,0);
  await h.click('Check connection and credits');
  assert.equal(h.calls.length,1);assert.match(h.calls[0][0],/\/generation$/);
  assert.match(text(h.tree),/Balance: 50 credits/);assert.match(text(h.tree),/Estimated cost: 12 Higgsfield credits/);
  assert.equal(nodes(h.tree,n=>n.type==='select')[0].props.value,'gpt_image_2_5');
  assert.equal(h.button('Generate in AI Office').props.disabled,false);
  h.model('nano_banana_pro');assert.match(text(h.tree),/Estimated cost: 8 Higgsfield credits/);
  h.setFetch(async(_url,init)=>{assert.deepEqual(JSON.parse(init.body),{requestId:'request-1',model:'nano_banana_pro'});return json({job:{id:'job-1',state:'queued'}});});
  await h.click('Generate in AI Office');
  assert.equal(h.calls[1][1].method,'POST');assert.equal(h.refreshes,1);assert.equal(h.active.at(-1),true);
  assert.match(text(h.tree),/generation is in progress/);
  assert.equal(nodes(h.tree,n=>n.type==='button'&&text(n)==='Generate in AI Office').length,0);
});

test('zero, insufficient or unknown credits and unavailable models block generation without an upgrade action',async()=>{
  for(const result of [generationStatus({balance:{credits:0}}),generationStatus({balance:{credits:4}}),generationStatus({balance:{credits:null}}),generationStatus({models:[{id:'gpt_image_2_5',name:'GPT Image 2.5',credits:null,available:false}]})]){
    const h=harness({automatic:true,fetch:async()=>json(result)});await h.click('Check connection and credits');
    assert.equal(h.button('Generate in AI Office').props.disabled,true);assert.equal(h.calls.length,1);
    assert.doesNotMatch(text(h.tree),/Upgrade|buy credits|subscribe now/i);
  }
  const disconnected=harness({automatic:true,fetch:async()=>json(generationStatus({connected:false,balance:{credits:null}}))});
  await disconnected.click('Check connection and credits');assert.match(text(disconnected.tree),/Connecting does not start generation/);
  assert.equal(nodes(disconnected.tree,n=>n.type==='button'&&text(n)==='Generate in AI Office').length,0);
});

test('active generations poll only after opening status and terminal results require review or explicit new requests',async()=>{
  const h=harness({automatic:true,status:'generating',fetch:async()=>json(generationStatus({job:{id:'job-1',state:'submitted'}}))});
  assert.equal(h.calls.length,0);
  await h.click('Check generation progress');
  assert.equal(h.timers.filter(timer=>!timer.cancelled&&timer.delay===5000).length,1);
  h.setFetch(async()=>json(generationStatus({job:{id:'job-1',state:'succeeded',imageUrl:'https://office.example/generated.png',warning:'Higgsfield adjusted the requested settings.'}})));
  await h.fireTimers(5000);
  assert.equal(nodes(h.tree,n=>n.type==='img')[0].props.src,'https://office.example/generated.png');
  assert.match(text(h.tree),/Human review is required/);
  assert.match(text(h.tree),/Higgsfield adjusted the requested settings/);
  assert.equal(h.timers.filter(timer=>!timer.cancelled&&timer.delay===5000).length,0);
  for(const state of ['uncertain','failed']){
    const stopped=harness({automatic:true,fetch:async()=>json(generationStatus({job:{id:'job-2',state,error:'Generation needs attention'}}))});
    await stopped.click('Check connection and credits');
    assert.equal(nodes(stopped.tree,n=>n.type==='button'&&text(n)==='Generate in AI Office').length,0);
    assert.equal(stopped.calls.length,1);
  }
});

test('generation cannot cross a changed request and repeated start clicks reserve only once',async()=>{
  const stale=harness({automatic:true,fetch:async()=>json(generationStatus({requestId:'new-request'}))});await stale.click('Check connection and credits');
  assert.match(text(stale.tree),/request changed/);assert.equal(stale.calls.length,1);
  const h=harness({automatic:true,fetch:async()=>json(generationStatus())});await h.click('Check connection and credits');
  let resolve;h.setFetch(()=>new Promise(done=>{resolve=done;}));
  const button=h.button('Generate in AI Office');button.props.onClick();button.props.onClick();await h.settle();
  assert.equal(h.calls.filter(call=>call[1]?.method==='POST').length,1);
  resolve(json({job:{id:'job-1',state:'queued'}}));await h.settle();
});

test('a saved Nano Banana job restores its model and a blocked retry cannot switch models',async()=>{
  for(const state of ['blocked','submitted']){
    const h=harness({automatic:true,fetch:async()=>json(generationStatus({job:{id:'saved-job',state,model:'nano_banana_pro'}}))});
    await h.click('Check connection and credits');
    const picker=nodes(h.tree,n=>n.type==='select')[0];
    assert.equal(picker.props.value,'nano_banana_pro');assert.equal(picker.props.disabled,true);
    assert.match(text(h.tree),/Estimated cost: 8 Higgsfield credits/);
    h.model('gpt_image_2_5');assert.equal(nodes(h.tree,n=>n.type==='select')[0].props.value,'nano_banana_pro');
    if(state==='blocked'){
      assert.match(text(h.tree),/Prepare a new artwork revision to change models/);
      h.setFetch(async(_url,init)=>{assert.deepEqual(JSON.parse(init.body),{requestId:'request-1',model:'nano_banana_pro'});return json({job:{id:'saved-job',state:'queued',model:'nano_banana_pro'}});});
      await h.click('Generate in AI Office');assert.equal(h.calls.filter(call=>call[1]?.method==='POST').length,1);
    }else assert.equal(nodes(h.tree,n=>n.type==='button'&&text(n)==='Generate in AI Office').length,0);
  }
});

test('pending ChatGPT revisions keep their provider without starting a job, while an active Higgsfield job shows its controls',()=>{
  const pending=harness({initialProvider:'chatgpt',keepInitialProvider:true});
  assert.equal(nodes(pending.tree,n=>n.type==='input'&&n.props.type==='radio'&&n.props.checked)[0].props.value,'chatgpt');
  assert.match(text(pending.tree),/ChatGPT manual import/);assert.equal(pending.calls.length,0);
  assert.equal(nodes(pending.tree,n=>typeof n.type==='function'&&n.type.name==='HiggsfieldGeneration').length,0);
  pending.provider('higgsfield');assert.equal(pending.calls.length,0,'changing providers alone never starts generation');
  assert.equal(nodes(pending.tree,n=>typeof n.type==='function'&&n.type.name==='HiggsfieldGeneration').length,1);
  const active=harness({initialProvider:'chatgpt',keepInitialProvider:true,status:'generating'});
  assert.equal(nodes(active.tree,n=>n.type==='input'&&n.props.type==='radio'&&n.props.checked)[0].props.value,'higgsfield');
  assert.equal(nodes(active.tree,n=>n.type==='fieldset')[0].props.disabled,true);
  assert.equal(nodes(active.tree,n=>n.type==='form').length,0);assert.equal(active.calls.length,0);
  const ordinary=harness({keepInitialProvider:true});
  assert.equal(nodes(ordinary.tree,n=>n.type==='input'&&n.props.type==='radio'&&n.props.checked)[0].props.value,'higgsfield');
  const updated=harness({initialProvider:'chatgpt',keepInitialProvider:true,status:'awaiting_import'});
  updated.status('generating');
  assert.equal(nodes(updated.tree,n=>n.type==='input'&&n.props.type==='radio'&&n.props.checked)[0].props.value,'higgsfield','a job started elsewhere updates an already mounted card');
  assert.equal(nodes(updated.tree,n=>n.type==='form').length,0);assert.equal(updated.calls.length,0);
});
