import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {isChatGPTHandoff,artworkProviderMode} from '../src/lib/artwork-mode.mjs';

const compile=name=>ts.transpileModule(readFileSync(new URL(`../src/lib/agents/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const compiled={design:compile('design'),carousel:compile('carousel')};
function harness(){
  const h={tables:{designs:[],creatives:[],carousel_sets:[]},providerCalls:0,generationDrains:0};
  const forbidden=()=>{h.providerCalls++;throw new Error('A handoff must not call a provider or fetch reference pixels');};
  h.db={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table){
    h.tables[table] ||= [];let filters=[],action,payload,single=false,limit=Infinity;const q={
      select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},is:(k,v)=>{filters.push(r=>(r[k]??null)===v);return q;},neq:(k,v)=>{filters.push(r=>r[k]!==v);return q;},
      in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},not:(k,_op,v)=>{filters.push(r=>!v.slice(1,-1).split(',').includes(r[k]));return q;},
      or:expression=>{if(expression.includes('.not.in.'))filters.push(r=>r.art_status==null||!['queued','making','generating'].includes(r.art_status));else{const field=expression.startsWith('art_status')?'art_status':'status';const before=expression.split('queued_at.lt.')[1]?.replace(/\)$/,'');filters.push(r=>r[field]==='queued'||r[field]==='making'&&r.queued_at<before);}return q;},
      order:()=>q,limit:n=>{limit=n;return q;},single:()=>{single=true;return q;},maybeSingle:()=>{single=true;return q;},
      insert:v=>{action='insert';payload=v;return q;},update:v=>{action='update';payload=v;return q;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        let rows=h.tables[table].filter(row=>filters.every(fn=>fn(row))).slice(0,limit);
        if(action==='insert'){rows=(Array.isArray(payload)?payload:[payload]).map(row=>({id:crypto.randomUUID(),...structuredClone(row)}));h.tables[table].push(...rows);}
        if(action==='update')rows.forEach(row=>Object.assign(row,structuredClone(payload)));
        return {data:structuredClone(single?rows[0]||null:rows),error:null};
      }).then(resolve,reject);},
    };return q;
  }};
  const products=Array.from({length:5},(_,i)=>({product_id:String(i+1),title:`Official ring ${i+1}`,image_url:`https://cdn.shopify.com/ring-${i}.png`,units:10-i,stock:4,stock_source:'shopify'}));
  const modules={
    '@/lib/artwork/generation':{drainHiggsfieldGenerations:async()=>{h.generationDrains++;return [];}},'server-only':{},'node:crypto':crypto,'@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>true},
    '@/lib/llm/gemini':{bannerImage:forbidden,geminiJSON:forbidden,imagePart:forbidden,carouselStyleBackground:forbidden},
    '@/lib/llm/gemini-config':{geminiConfigured:forbidden},'@/lib/llm/openai':{canWrite:forbidden,chatJSON:forbidden},
    './library':{pickRefs:async()=>[{id:'reference',name:'Original style'}],refParts:forbidden},
    './conversation-sales.mjs':{requestedSalesCategory:()=> 'Ring',conversationSalesWindows:()=>({completeThirtyDays:{from:'2026-09-28',to:'2026-10-28'}}),conversationCategorySales:async()=>({})},
    './carousel-core.mjs':{carouselSelection:()=>products},'@/lib/errors':{errText:e=>e.message},
  };
  h.load=name=>{const out={};new Function('exports','require',compiled[name])(out,id=>modules[id]||{});return out;};
  return h;
}
test('native ChatGPT handoff is the default and only an explicit Gemini setting opts out',()=>{
  assert.equal(artworkProviderMode({}),'manual');assert.equal(artworkProviderMode({ARTWORK_PROVIDER:'higgsfield'}),'higgsfield');assert.equal(isChatGPTHandoff({ARTWORK_PROVIDER:'higgsfield'}),true);assert.equal(isChatGPTHandoff({}),true);assert.equal(isChatGPTHandoff({ARTWORK_PROVIDER:'unknown'}),true);assert.equal(isChatGPTHandoff({ARTWORK_PROVIDER:'gemini'}),false);
});
test('Studio order and redesign create import nonces without provider calls or replacing prior evidence',async()=>{
  const h=harness(),design=h.load('design');const id=await design.queueDesign(h.db,{format:'post',brief:'Exact product',headline:'Approved headline',language:'en',productIds:[1],userId:'owner'});
  const row=h.tables.designs[0],first=row.artwork_request_id;assert.equal(row.id,id);assert.equal(row.status,'awaiting_import');assert.equal(row.queued_at,null);assert.ok(first);
  Object.assign(row,{status:'ready',image_path:'prior.png',versions:[{image_path:'first.png'}],artwork_origin:'chatgpt_import',artwork_handoff:{packet:{requestId:first}}});
  await design.queueRedesign(h.db,'design',id,'Use blue silk');assert.equal(row.status,'awaiting_import');assert.notEqual(row.artwork_request_id,first);assert.equal(row.artwork_handoff,null);
  assert.equal(row.image_path,'prior.png');assert.deepEqual(row.versions,[{image_path:'first.png'}]);assert.equal(row.redo_note,'Use blue silk');assert.equal(h.providerCalls,0);
});
test('legacy queued and stale uncertain work becomes a handoff; active requests are not replayed',async()=>{
  const h=harness(),design=h.load('design');h.tables.designs.push({id:'queued',status:'queued',queued_at:null,image_path:'old.png',versions:[],artwork_handoff:{stale:true}},
    {id:'active',status:'making',queued_at:new Date().toISOString(),image_path:null},{id:'stale',status:'making',queued_at:new Date(Date.now()-20*60000).toISOString(),image_path:null});
  assert.equal(await design.drawItem(h.db,'design','queued'),true);const nonce=h.tables.designs[0].artwork_request_id;
  assert.equal(await design.drawItem(h.db,'design','queued'),false);assert.equal(h.tables.designs[0].artwork_request_id,nonce);assert.equal(h.tables.designs[0].image_path,'old.png');assert.equal(h.tables.designs[0].artwork_handoff,null);
  assert.equal(await design.drawItem(h.db,'design','active'),false);assert.equal(h.tables.designs[1].status,'making');
  assert.equal(await design.drawItem(h.db,'design','stale'),true);assert.equal(h.tables.designs[2].status,'awaiting_import');assert.equal(h.providerCalls,0);
});
test('a frozen campaign legacy queue is cancelled without a new request or image mutation',async()=>{
  const h=harness();h.tables.creatives.push({id:'frozen',art_status:'queued',image_path:'approved.png',campaigns:{status:'approved'}});
  assert.equal(await h.load('design').drawItem(h.db,'creative','frozen'),false);assert.equal(h.tables.creatives[0].image_path,'approved.png');assert.equal(h.tables.creatives[0].art_status,'needs_fix');assert.equal(h.tables.creatives[0].artwork_request_id,undefined);assert.equal(h.providerCalls,0);
});
test('direct carousel render and background entry points fail before fetching pixels or calling a provider',async()=>{
  const h=harness();await assert.rejects(h.load('design').carouselArtwork(h.db,{}),/Generate this card in ChatGPT/);
  await assert.rejects(h.load('carousel').carouselBackgroundFor(h.db,'set'),/no background is generated/);assert.equal(h.providerCalls,0);
});
test('five-card handoff and revision preserve product order, old images and private background without generation',async()=>{
  const h=harness(),carousel=h.load('carousel');const set=await carousel.queueSalesCarousel(h.db,h.db,{userId:'owner',role:'ecom_manager',category:'Ring'});
  assert.equal(set.cards.length,5);assert.equal(new Set(h.tables.designs.map(r=>r.artwork_request_id)).size,5);assert.equal(h.tables.carousel_sets[0].background_status,'unused');
  assert.ok(h.tables.designs.every((r,i)=>r.status==='awaiting_import'&&r.queued_at===null&&r.carousel_index===i+1&&r.product_ids[0]===i+1));
  h.tables.carousel_sets[0].background_path='private-old-background.png';
  for(const row of h.tables.designs)Object.assign(row,{status:'ready',image_path:`old-${row.carousel_index}.png`,versions:[],artwork_handoff:{old:true}});
  const previous=h.tables.designs.map(r=>r.artwork_request_id);await carousel.queueCarouselRedesign(h.db,h.db,{userId:'owner',role:'ecom_manager',carouselId:set.carouselId,note:'Use natural light'});
  assert.equal(h.tables.carousel_sets[0].background_path,'private-old-background.png');assert.equal(h.tables.carousel_sets[0].background_status,'unused');
  assert.ok(h.tables.designs.every((r,i)=>r.status==='awaiting_import'&&r.artwork_request_id!==previous[i]&&r.artwork_handoff===null&&r.image_path===`old-${i+1}.png`&&r.versions.length===0));assert.equal(h.providerCalls,0);
});

test('active automatic generation cannot be replaced by a new revision or legacy conversion',async()=>{
  const h=harness(),design=h.load('design');h.tables.designs.push({id:'active',status:'generating',artwork_request_id:'current',image_path:'prior.png'});
  await assert.rejects(design.queueRedesign(h.db,'design','active','different light'),/already being redesigned/);
  assert.equal(await design.prepareArtworkImport(h.db,'design','active'),false);
  assert.equal(h.tables.designs[0].artwork_request_id,'current');assert.equal(h.tables.designs[0].image_path,'prior.png');assert.equal(h.providerCalls,0);
});

test('scheduler advances saved automatic jobs without submitting old manual briefs',async()=>{
  const h=harness();h.tables.designs.push({id:'old',status:'awaiting_import',artwork_request_id:'unchanged',image_path:'prior.png'});
  await h.load('design').drainDesignQueue(h.db);assert.equal(h.generationDrains,1);assert.equal(h.providerCalls,0);
  assert.equal(h.tables.designs[0].status,'awaiting_import');assert.equal(h.tables.designs[0].artwork_request_id,'unchanged');
});
