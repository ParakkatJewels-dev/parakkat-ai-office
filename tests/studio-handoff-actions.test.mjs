import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as providerRouting from '../src/lib/artwork/provider-routing.mjs';

const id = '11111111-1111-4111-8111-111111111111', setId = '22222222-2222-4222-8222-222222222222';
const code = ts.transpileModule(readFileSync(new URL('../src/app/(app)/studio/actions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(options = {}) {
  const h = { scheduled: [], drawn: [], queued: [], generated: [], reviewed: [], writes: [], paths: [], rows: options.rows || {
    designs: [{ id, format: 'portrait', status: 'ready' }],
    carousel_sets: [{ id: setId, background_status: 'failed', started_at: null }],
    ai_images: [{ id, source: 'design', kind: 'portrait', status: 'ready', brief: 'Fine chain', image_path: 'current.png', artwork_request_id: null }],
    creatives: [{ id, campaigns: { status: 'draft' } }],
  } };
  function query(table, admin = false) {
    const filters = [];
    const result = single => ({ data: single ? (h.rows[table] || []).find(row => filters.every(fn => fn(row))) || null : (h.rows[table] || []).filter(row => filters.every(fn => fn(row))), error: null });
    const q = {
      select() { return q; }, eq(key, value) { filters.push(row => row[key] === value); return q; }, in(key, values) { filters.push(row => values.includes(row[key])); return q; }, order() { return q; },
      update(value) { assert.ok(admin, 'read-scoped database must not mutate'); h.writes.push({ table, value }); return q; },
      insert(value) { assert.ok(admin); h.writes.push({ table, value }); return q; },
      maybeSingle: async () => result(true), then: (resolve, reject) => Promise.resolve(result(false)).then(resolve, reject),
    };
    return q;
  }
  const db = { from: table => query(table) }, admin = { from: table => query(table, true), rpc: async (name, args) => { h.reviewed.push({ name, args }); return { error: options.rpcError || null }; } };
  const modules = {
    'next/cache': { revalidatePath: value => h.paths.push(value) },
    'next/navigation': { redirect: url => { const e = new Error(`Redirect: ${url}`); e.url = url; throw e; } },
    '@/lib/auth/session': { requireUser: async () => ({ db, role: 'creative_head', user: { id: 'reviewer' } }) },
    '@/lib/supabase/admin': { supabaseAdmin: () => admin },
    'next/server': { after: fn => h.scheduled.push(fn) },
    '@/lib/agents/design': { LANGS: { en: 'English' }, canDesign: async () => true, canUseStudio: async () => true,
      queueDesign: async (_db, args) => { h.queued.push({ operation: 'new', args }); return id; },
      queueRedesign: async (_db, source, target, note) => h.queued.push({ operation: 'revision', source, id: target, note }),
      drawItem: async (...args) => h.drawn.push(args),
    },
    '@/lib/agents/library-core.mjs': {}, '@/lib/connectors/drive': {},
    '@/lib/errors': { errText: e => e.message }, '@/lib/roles': { ROLE_LABEL: { creative_head: 'Creative Head' } },
    '@/lib/agents/library': {}, './library-folder-edit': {}, './library-status.mjs': {},
    '@/lib/agents/carousel': {
      queueSalesCarousel: async () => { h.queued.push({ operation: 'carousel' }); return { carouselId: setId, cards: Array.from({ length: 5 }, (_, i) => ({ id: `card-${i}` })) }; },
      queueCarouselRedesign: async () => { h.queued.push({ operation: 'carousel-revision' }); return { cards: options.revisionCards || Array.from({ length: 5 }, (_, i) => ({ id: `card-${i}` })) }; },
    },
    '@/lib/artwork-mode.mjs': { isChatGPTHandoff: () => options.handoff !== false },
    '@/lib/artwork/generation': { startAutomaticArtwork: async args => { h.generated.push(args); if (options.generationError) throw options.generationError; return options.generation || { started: true, job: { id: 'job', state: 'queued' } }; } },
    '@/lib/artwork/provider-routing.mjs': providerRouting,
  };
  const exports = {};
  new Function('exports', 'require', code)(exports, name => { assert.ok(name in modules, `Unmocked import ${name}`); return modules[name]; });
  return { ...h, actions: exports };
}
function form(data) { const f = new FormData(); for (const [key, value] of Object.entries(data)) f.set(key, value); return f; }
async function redirected(fn) { let url; await assert.rejects(fn, e => { url = e.url; return !!url; }); return decodeURIComponent(url); }

test('explicit new designs and five-card orders queue Higgsfield jobs without Gemini calls', async () => {
  const h = harness();
  const newUrl = await redirected(() => h.actions.orderDesign(form({ format: 'portrait', brief: 'Fine chain' })));
  assert.match(newUrl, /made=/);
  const carouselUrl = await redirected(() => h.actions.orderCarousel(form({ category: 'Chain' })));
  assert.match(carouselUrl, /Higgsfield generation queued for 5 images/);
  assert.deepEqual(h.queued.map(item => item.operation), ['new', 'carousel']);
  assert.equal(h.scheduled.length, 0); assert.equal(h.drawn.length, 0);
  assert.deepEqual(h.generated.map(row => row.id), [id, 'card-0', 'card-1', 'card-2', 'card-3', 'card-4']);
  assert.ok(h.generated.every(row => row.source === 'design' && row.userId === 'reviewer' && row.role === 'creative_head'));
});

test('explicit individual and whole-set revisions queue only their requested images', async () => {
  const h = harness({ rows: { designs: [{ id, format: 'carousel_card', status: 'ready' }] } });
  const url = await redirected(() => h.actions.redesign(form({ source: 'design', id, note: 'Keep exact chain' })));
  assert.match(url, /Higgsfield generation queued for 1 image/);
  assert.equal(h.queued[0].note, 'Keep exact chain');
  const setUrl = await redirected(() => h.actions.redesignCarousel(form({ carousel: setId })));
  assert.match(setUrl, /Higgsfield generation queued for 5 images/);
  assert.equal(h.writes.length, 0); assert.equal(h.scheduled.length, 0);
  assert.deepEqual(h.generated.map(row => row.id), [id, 'card-0', 'card-1', 'card-2', 'card-3', 'card-4']);
});

test('retrying a failed set queues only failed cards without a new shared background', async () => {
  const cards = ['failed', 'ready', 'needs_fix', 'awaiting_import', 'ready'].map((status, i) => ({ id: `card-${i}`, carousel_id: setId, status }));
  const h = harness({ rows: { carousel_sets: [{ id: setId, background_status: 'failed' }], designs: cards } });
  const url = await redirected(() => h.actions.retryCarousel(form({ carousel: setId })));
  assert.match(url, /Higgsfield generation queued for 2 images/);
  assert.deepEqual(h.queued.map(item => item.id), ['card-0', 'card-2']);
  assert.equal(h.writes.length, 0); assert.equal(h.scheduled.length, 0);
  assert.deepEqual(h.generated.map(row => row.id), ['card-0', 'card-2']);
});

test('approved campaign artwork stays frozen in handoff mode', async () => {
  const h = harness({ rows: { creatives: [{ id, campaigns: { status: 'approved' } }] } });
  const url = await redirected(() => h.actions.redesign(form({ source: 'creative', id })));
  assert.match(url, /campaign is approved/);
  assert.equal(h.queued.length, 0); assert.equal(h.scheduled.length, 0);
  assert.equal(h.generated.length, 0);
});

test('refreshing a stale brief preserves the manual recovery path and never starts generation', async () => {
  const h = harness({ rows: { designs: [{ id, format: 'portrait', status: 'awaiting_import' }] } });
  const url = await redirected(() => h.actions.redesign(form({ source: 'design', id, prepare_only: '1', note: 'Reload current references' })));
  assert.match(url, /Fresh artwork brief prepared/);
  assert.equal(h.queued.length, 1); assert.equal(h.generated.length, 0); assert.equal(h.writes.length, 0);
});

test('disconnected or uncertain generation leaves a saved request and reports no false image completion', async () => {
  for (const options of [{generation:{started:false,job:null,reason:'Connect Higgsfield in Settings to generate automatically.'}}, {generationError:new Error('private token details')}]) {
    const h = harness(options);
    const url = await redirected(() => h.actions.orderDesign(form({ format: 'portrait', brief: 'Fine chain' })));
    assert.match(url, /Artwork request saved/); assert.doesNotMatch(url, /generation queued|private token|image complete/);
    assert.equal(h.generated.length, 1); assert.equal(h.queued.length, 1); assert.equal(h.drawn.length, 0);
  }
});

test('an active carousel job blocks a whole-set retry before preparing or charging another image', async () => {
  const cards = ['failed', 'ready', 'generating', 'awaiting_import', 'ready'].map((status, i) => ({ id: `card-${i}`, carousel_id: setId, status }));
  const h = harness({ rows: { carousel_sets: [{ id: setId }], designs: cards } });
  assert.match(await redirected(() => h.actions.retryCarousel(form({ carousel: setId }))), /still being prepared/);
  assert.equal(h.queued.length, 0); assert.equal(h.generated.length, 0);
});

test('review refuses pending or stale displayed artifacts before writing a verdict', async () => {
  const h = harness();
  let url = await redirected(() => h.actions.reviewImage(form({ source: 'design', id, verdict: 'good', image_path: 'old.png' })));
  assert.match(url, /artwork has changed/);
  h.rows.ai_images[0].status = 'awaiting_import';
  url = await redirected(() => h.actions.reviewImage(form({ source: 'design', id, verdict: 'good', image_path: 'current.png' })));
  assert.match(url, /Save the finished image before reviewing/);
  h.rows.ai_images[0].status = 'generating';
  url = await redirected(() => h.actions.reviewImage(form({ source: 'design', id, verdict: 'good', image_path: 'current.png' })));
  assert.match(url, /still being generated/);
  assert.equal(h.reviewed.length, 0); assert.equal(h.writes.length, 0);
});

test('review commits through the row-locked artifact RPC and respects an import race rejection', async () => {
  const h = harness();
  const values = { source: 'design', id, verdict: 'good', image_path: 'current.png', note: 'Exact chain verified' };
  const url = await redirected(() => h.actions.reviewImage(form(values)));
  assert.match(url, /Review saved/);
  assert.deepEqual(h.reviewed, [{ name: 'review_artwork', args: { p_source: 'design', p_id: id, p_image_path: 'current.png', p_request_id: null, p_verdict: 'good', p_note: 'Exact chain verified', p_reviewer: 'reviewer', p_reviewer_role: 'creative_head' } }]);
  assert.ok(h.writes.every(write => write.table === 'lessons'));
  const stale = harness({ rpcError: new Error('The artwork changed during review. Refresh.') });
  assert.match(await redirected(() => stale.actions.reviewImage(form(values))), /changed during review/);
  assert.equal(stale.writes.length, 0);
});

test('ChatGPT-imported Studio and campaign revisions prepare manual briefs without a Higgsfield call', async () => {
  for (const source of ['design','creative']) {
    const h = harness({rows:{designs:[{id,format:'portrait',status:'ready',artwork_origin:'chatgpt_import'}],creatives:[{id,artwork_origin:'chatgpt_import',campaigns:{status:'draft'}}]}});
    const url = await redirected(() => h.actions.redesign(form({source,id,note:'Keep the exact chain'})));
    assert.match(url,/ChatGPT brief prepared for 1 image/);assert.match(url,/does not generate ChatGPT images automatically/);
    assert.equal(h.queued.length,1);assert.equal(h.generated.length,0);assert.equal(h.scheduled.length,0);
  }
});

test('a revision provider override is explicit, validated before mutation, and can opt into Higgsfield', async () => {
  for(const [provider,origin,calls] of [['higgsfield','chatgpt_import',1],['chatgpt','higgsfield_oauth',0]]){
    const h=harness({rows:{designs:[{id,format:'portrait',status:'ready',artwork_origin:origin}]}});
    const url=await redirected(()=>h.actions.redesign(form({source:'design',id,provider})));
    assert.equal(h.queued.length,1);assert.equal(h.generated.length,calls);
    assert.match(url,calls?/Higgsfield generation queued/:/ChatGPT brief prepared/);
  }
  const invalid=harness();assert.match(await redirected(()=>invalid.actions.redesign(form({source:'design',id,provider:'unrecognized'}))),/Choose ChatGPT or Higgsfield/);
  assert.equal(invalid.queued.length,0);assert.equal(invalid.generated.length,0);
});

test('carousel revisions and failed-card retries keep each saved provider unless explicitly overridden', async () => {
  const cards=Array.from({length:5},(_,i)=>({id:`card-${i}`,carousel_id:setId,status:i<2?'failed':'ready',artwork_origin:i===0?'chatgpt_import':'higgsfield_oauth'}));
  const h=harness({revisionCards:cards,rows:{carousel_sets:[{id:setId}],designs:cards}});
  let url=await redirected(()=>h.actions.redesignCarousel(form({carousel:setId})));
  assert.match(url,/ChatGPT brief prepared for 1 image/);assert.match(url,/Higgsfield generation queued for 4 images/);
  assert.deepEqual(h.generated.map(row=>row.id),['card-1','card-2','card-3','card-4']);
  const retry=harness({rows:{carousel_sets:[{id:setId}],designs:cards}});
  url=await redirected(()=>retry.actions.retryCarousel(form({carousel:setId})));
  assert.match(url,/ChatGPT brief prepared/);assert.deepEqual(retry.generated.map(row=>row.id),['card-1']);
  for(const [provider,count] of [['chatgpt',0],['higgsfield',5]]){
    const override=harness({revisionCards:cards});await redirected(()=>override.actions.redesignCarousel(form({carousel:setId,provider})));
    assert.equal(override.generated.length,count);
  }
  const allChat=harness({revisionCards:cards.map(row=>({...row,artwork_origin:'chatgpt_import'}))});
  assert.match(await redirected(()=>allChat.actions.redesignCarousel(form({carousel:setId}))),/ChatGPT briefs prepared for 5 images/);
  assert.equal(allChat.generated.length,0);
});
