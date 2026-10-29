import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
const nodes=(tree,predicate)=>!tree?[]:Array.isArray(tree)?tree.flatMap(child=>nodes(child,predicate)):typeof tree!=='object'?[]:[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(' '):tree&&typeof tree==='object'?text(tree.props?.children):tree==null||typeof tree==='boolean'?'':String(tree);
const code=ts.transpileModule(readFileSync(new URL('../src/app/(app)/studio/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;

function harness(rows) {
  const db={from(table){let head=false,single=false;const filters=[];const q={
    select(_columns,options){head=!!options?.head;return q;},eq(key,value){filters.push(row=>row[key]===value);return q;},neq(key,value){filters.push(row=>row[key]!==value);return q;},
    is(key,value){filters.push(row=>(row[key]??null)===value);return q;},not(key,_operator,value){filters.push(row=>(row[key]??null)!==value);return q;},in(key,values){filters.push(row=>values.includes(row[key]));return q;},
    order(){return q;},range(){return q;},limit(){return q;},or(){return q;},maybeSingle(){single=true;return q;},
    then(resolve,reject){const data=(table==='ai_images'?rows:[]).filter(row=>filters.every(filter=>filter(row)));return Promise.resolve({data:head?null:single?data[0]||null:data,count:data.length,error:null}).then(resolve,reject);},
  };return q;},storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:`https://storage.test/${path}`}))}),createSignedUrl:async path=>({data:{signedUrl:`https://storage.test/download/${path}`}})})}};
  const modules={
    'react/jsx-runtime':jsx,'../agents/Workspace.module.css':{default:{}},'./Studio.module.css':{default:new Proxy({},{get:(_,key)=>key})},'next/navigation':{redirect:url=>{throw new Error(url);}},
    '@/lib/auth/session':{requireUser:async()=>({db,role:'super_admin'})},
    '@/lib/agents/design':{FORMATS:{portrait:{label:'Portrait',ratio:'4:5',size:'1080 × 1350'}},LANGS:{en:'English'},canDesign:async()=>true,canUseStudio:async()=>true},
    '@/components/Icon':{Icon:'Icon'},'@/components/ui':{PageHead:'PageHead',Tile:'Tile',Pager:'Pager',pageOf:()=>1,rangeOf:()=>[0,17],when:String},
    '@/lib/limits':{PRODUCT_PAGE:20},'./StudioForm':{StudioForm:'StudioForm'},
    './actions':Object.fromEntries(['reviewImage','redesign','redesignCarousel','scanNow','removeFolder','markRef','orderCarousel','retryCarousel'].map(name=>[name,name])),
    './FolderPicker':{FolderPicker:'FolderPicker'},'@/components/Refresher':{Refresher:'Refresher'},'@/components/forms':{Locked:'Locked',Submit:'Submit'},'@/lib/roles':{ROLE_LABEL:{}},
    './library-progress':{readLibraryRuntime:async()=>({})},'./library-status.mjs':{libraryDisplayState:()=>({active:false}),readLibraryFolderPages:async()=>({rows:[],complete:true}),safeLibraryNote:String},
    './LibraryProgress':{LibraryProgress:'LibraryProgress'},'./ImageViewer':{ImageViewer:'ImageViewer'},'@/lib/agents/library-core.mjs':{referenceFingerprint:()=>''},'@/lib/agents/people':{byId:{}},
    '@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>true},'./ChatGPTArtwork':{ChatGPTArtwork:'ChatGPTArtwork'},
  };
  const exports={};new Function('exports','require',code)(exports,name=>{assert.ok(name in modules,`Unmocked import ${name}`);return modules[name];});
  return sp=>exports.default({searchParams:Promise.resolve(sp||{})});
}
const row=extra=>({id:'artwork-1',source:'design',kind:'portrait',brief:'Fine chain',headline:'Fine Millennium',language:'en',status:'awaiting_import',image_path:null,created_at:'2026-10-28',ref_ids:[],versions:0,artwork_request_id:'current-request',...extra});

test('a changed-reference failure leaves a fresh-brief recovery action for both new and revised awaiting imports',async()=>{
  const render=harness([row({id:'new'}),row({id:'revision',image_path:'previous.png'})]);
  const tree=await render({error:'A saved style reference has changed or is unavailable. Prepare a new revision brief before downloading.'});
  assert.match(text(tree),/saved style reference has changed/);
  const cards=nodes(tree,node=>node.type==='li'&&node.props.id?.startsWith('d-'));
  assert.equal(cards.length,2);
  for(const card of cards){
    assert.match(card.props.className,/awaitingItem/);
    assert.match(text(card),/Prepare a new artwork brief/);
    assert.match(text(card),/Existing artwork stays available/);
    const form=nodes(card,node=>node.type==='form'&&node.props.action==='redesign')[0];assert.ok(form);
    assert.equal(nodes(form,node=>node.type==='input'&&node.props.name==='prepare_only')[0].props.value,'1');
    assert.equal(nodes(form,node=>node.type==='input'&&node.props.name==='id')[0].props.value,card.props.id.slice(2));
    assert.equal(nodes(card,node=>node.type==='ChatGPTArtwork').length,1);
    assert.equal(nodes(card,node=>node.type==='Locked'&&node.props.action==='reviewImage').length,0);
  }
  assert.equal(nodes(tree,node=>node.type==='img'&&node.props.src==='https://storage.test/previous.png').length,1);
});

test('imported artwork shows human-review provenance, suppresses historical AI claims and submits the exact displayed artifact',async()=>{
  const tree=await harness([row({status:'ready',image_path:'imported.png',artwork_origin:'chatgpt_import',lead_note:'AI checked exact product identity',concept:'Product identity was checked automatically',imported_at:'2026-10-28'})])();
  assert.match(text(tree),/ChatGPT\s+artwork/);assert.match(text(tree),/Human review required/);
  assert.doesNotMatch(nodes(tree,node=>node.type==='li'&&node.props.id==='d-artwork-1')[0].props.className,/awaitingItem/);
  assert.doesNotMatch(text(tree),/AI checked exact product identity|Product identity was checked automatically/);
  const form=nodes(tree,node=>node.type==='Locked'&&node.props.action==='reviewImage')[0];assert.ok(form);
  assert.equal(nodes(form,node=>node.type==='input'&&node.props.name==='image_path')[0].props.value,'imported.png');
  assert.equal(nodes(form,node=>node.type==='input'&&node.props.name==='request_id')[0].props.value,'current-request');
});

test('the library explains discovery-only scanning and does not offer to resume paid image study',async()=>{
  const tree=await harness([])({tab:'library'});
  const library=nodes(tree,node=>typeof node.type==='function'&&node.type.name==='Library')[0];assert.ok(library);
  const expanded=await library.type(library.props);
  assert.match(text(expanded),/Gemini image study is disabled/);
  assert.match(text(expanded),/Folder scans discover files/);
  assert.doesNotMatch(text(expanded),/Resume study|AI Office studies each design/);
});

test('Higgsfield artwork shows accurate provenance and keeps imported output subject to human review',async()=>{
  const tree=await harness([row({status:'ready',image_path:'higgsfield.png',artwork_origin:'higgsfield_import',lead_note:'AI checked exact product identity',concept:'Product identity was checked automatically',imported_at:'2026-10-28'})])();
  const card=nodes(tree,node=>node.type==='li'&&node.props.id==='d-artwork-1')[0];
  assert.match(text(card),/Higgsfield\s+artwork/);assert.match(text(card),/Human review required/);
  assert.match(text(card),/Created in\s+Higgsfield\s+and imported into AI Office/);
  assert.doesNotMatch(text(card),/ChatGPT\s+artwork|Created in\s+ChatGPT|AI checked exact product identity|Product identity was checked automatically/);
  assert.equal(nodes(card,node=>node.type==='Locked'&&node.props.action==='reviewImage').length,1);
});

test('active generation preserves the previous preview and blocks import review or another revision',async()=>{
  const tree=await harness([row({status:'generating',image_path:'previous.png'})])();
  assert.match(text(tree),/Generating with Higgsfield/);
  assert.equal(nodes(tree,n=>n.type==='ChatGPTArtwork')[0].props.status,'generating');
  assert.equal(nodes(tree,n=>n.type==='img'&&n.props.src==='https://storage.test/previous.png').length,1);
  assert.equal(nodes(tree,n=>n.type==='Locked'&&n.props.action==='reviewImage').length,0);
  assert.equal(nodes(tree,n=>n.type==='form'&&n.props.action==='redesign').length,0);
});

test('automatic Higgsfield artwork shows saved provenance without claiming automated visual approval',async()=>{
  const tree=await harness([row({status:'ready',image_path:'automatic.png',artwork_origin:'higgsfield_oauth',lead_note:'AI checked exact product identity',concept:'Product identity was checked automatically'})])();
  assert.match(text(tree),/Generated with Higgsfield/);assert.match(text(tree),/Human review required/);
  assert.doesNotMatch(text(tree),/AI checked exact product identity|Product identity was checked automatically|and imported into AI Office/);
  assert.equal(nodes(tree,n=>n.type==='Locked'&&n.props.action==='reviewImage').length,1);
});

test('ChatGPT revision forms and pending cards retain saved provider while allowing an explicit Higgsfield choice',async()=>{
  const ready=await harness([row({status:'ready',image_path:'chatgpt.png',artwork_origin:'chatgpt_import'})])();
  const form=nodes(ready,n=>n.type==='form'&&n.props.action==='redesign')[0];
  const picker=nodes(form,n=>n.type==='select'&&n.props.name==='provider')[0];
  assert.equal(picker.props.defaultValue,'chatgpt');assert.deepEqual(nodes(picker,n=>n.type==='option').map(n=>n.props.value),['chatgpt','higgsfield']);
  assert.match(text(form),/ChatGPT prepares a brief for manual generation and import/);
  const pending=await harness([row({artwork_origin:'chatgpt_import',image_path:'chatgpt.png'})])();
  assert.equal(nodes(pending,n=>n.type==='ChatGPTArtwork')[0].props.initialProvider,'chatgpt');
});
