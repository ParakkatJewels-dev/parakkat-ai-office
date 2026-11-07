import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import sharp from 'sharp';
import * as core from '../src/lib/artwork/import-core.mjs';
import { rankDesignReferences, referenceFingerprint, requestedDesignOccasion } from '../src/lib/agents/library-core.mjs';
import { shopifyPhotoUrl } from '../src/lib/agents/carousel-url.mjs';

const id = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222';
const revision = '2026-10-28T00:00:00.000Z';
const photo = n => `https://cdn.shopify.com/s/files/1/1111/2222/files/product-${n}.png`;
const product = (id, title = `Fine Chain ${id}`) => ({ id, title, image_url: photo(id) });
const reference = (id, name, extra = {}) => ({ id, name, drive_id: `drive-${id}`, modified_at: revision, status: 'ready', hidden: false, fingerprint: { visualBrief: name }, tags: ['chain'], style: 'minimal ivory studio', palette: 'ivory gold', quality: 3, ...extra });
const code = ts.transpileModule(readFileSync(new URL('../src/lib/artwork/server.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const images = await Promise.all(['red','blue','green','yellow'].map(background => sharp({ create: { width: 320, height: 400, channels: 3, background } }).png().toBuffer()));

function harness(options = {}) {
  const state = {
    row: { id, format: 'portrait', status: 'awaiting_import', artwork_request_id: requestId, artwork_handoff: null, requested_by: 'owner',
      product_ids: [2,1], headline: 'Fine Millennium', brief: 'Premium chain artwork', language: 'en', ref_ids: [], versions: [], image_path: null, ...options.row },
    products: options.products || [product(1), product(2)],
    designs: [],
    refs: options.refs || [reference('chain','Fine chain design')],
    reads: [], writes: [], photoReads: [], driveReads: [], previousReads: [], storageWrites: 0, saves: 0,
  };
  state.designs = [state.row,...(options.designs || [])];
  function query(table, admin) {
    const q = { table, admin, filters: [], limit: null, values: null, single: false, orders: [] };
    state.reads.push(q);
    async function execute() {
      if (q.values && !q.executed) {
        q.executed = true; state.saves++;
        options.beforeSave?.(state, q);
      }
      let rows = table === 'products' ? state.products : table === 'design_refs' ? state.refs : table === 'designs' ? state.designs : [state.row];
      rows = rows.filter(row => q.filters.every(filter => filter(row)));
      for (const key of q.orders.toReversed()) rows = [...rows].sort((a,b) => String(a[key]).localeCompare(String(b[key])));
      if (q.limit != null) rows = rows.slice(0,q.limit);
      if (q.values) {
        assert.ok(admin); state.writes.push({ table, values: structuredClone(q.values), matched: rows.length });
        for (const row of rows) Object.assign(row,q.values);
      }
      if (options.libraryError && table === 'design_refs') return { data: null, error: { message: 'Library unavailable' } };
      return { data: structuredClone(q.single ? rows[0] || null : rows), error: null };
    }
    const api = {
      select(columns) { q.columns = columns; return api; },
      eq(key,value) { q.filters.push(row => row[key] === value); return api; },
      contains(key,value) { q.filters.push(row => Object.entries(value).every(([field,expected]) => row[key]?.[field] === expected)); return api; },
      in(key,values) { q.filters.push(row => values.includes(row[key])); return api; },
      is(key,value) { q.filters.push(row => (row[key] ?? null) === value); return api; },
      not(key,operator,value) { assert.equal(operator,'is'); assert.equal(value,null); q.filters.push(row => row[key] != null); return api; },
      order(key) { q.orders.push(key); return api; }, limit(value) { q.limit = value; return api; },
      update(values) { q.values = values; return api; },
      maybeSingle() { q.single = true; return execute(); },
      then(resolve,reject) { return execute().then(resolve,reject); },
    };
    return api;
  }
  const admin = { from: table => query(table,true), storage: { from: () => ({
    download: async path => { state.previousReads.push(path); return { data: new Blob([images[2]]), error: null }; },
    upload: async () => { state.storageWrites++; throw new Error('Reference source bytes must never be stored'); },
  }) } };
  const modules = {
    'server-only': {}, 'node:crypto': { randomUUID }, sharp,
    '@/lib/supabase/admin': { supabaseAdmin: () => admin },
    '@/lib/agents/conversation-api': { conversationUser: async () => ({ db: { from: table => query(table,false) }, user: { id: 'owner' }, role: 'ecom_manager' }) },
    '@/lib/agents/design': { FORMATS: { post: { label: 'Post', ratio: '1:1', size: '1080 × 1080' }, portrait: { label: 'Portrait', ratio: '4:5', size: '1080 × 1350' }, carousel_card: { label: 'Carousel card', ratio: '4:5', size: '1080 × 1350' }, web_banner: { label: 'Web banner', ratio: '16:9', size: '1920 × 1080' } } },
    '@/lib/agents/library-core.mjs': { rankDesignReferences, referenceFingerprint, requestedDesignOccasion },
    '@/lib/agents/carousel-card.mjs': { shopifyPhotoUrl, fetchShopifyPhoto: async url => { state.photoReads.push(url); return url === photo(2) ? images[1] : images[0]; } },
    '@/lib/connectors/drive': { designImageById: async (driveId,signal,expected) => { state.driveReads.push({ driveId, signal, expected }); if (options.driveError) throw new Error('Changed Drive original'); return { data: images[3] }; } },
    '@/lib/connectors/shopify': { shopifyArtworkPrice: async () => options.price || null },
    '@/lib/artwork-mode.mjs': { isChatGPTHandoff: () => true }, './import-core.mjs': core,
  };
  const api = {};
  new Function('exports','require',code)(api,name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; });
  const context = { params: Promise.resolve({ source: options.source || 'design', id }) };
  return { state, packet: provider => api.artworkPacket(context,provider), pack: provider => api.artworkPack(context,provider),
    access: () => api.accessArtwork(context), generation: () => api.generationArtwork({ source: options.source || 'design', item_id: id, request_id: requestId }) };
}

function unzip(bytes) {
  const files = new Map(); let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset+18), nameLength = bytes.readUInt16LE(offset+26), extraLength = bytes.readUInt16LE(offset+28);
    const start = offset+30+nameLength+extraLength;
    files.set(bytes.subarray(offset+30,offset+30+nameLength).toString(), bytes.subarray(start,start+size));
    offset = start+size;
  }
  return files;
}

test('packet and pack keep selected product order, actual source pixels and previous artwork without storing originals', async () => {
  const h = harness({ row: { image_path: 'previous-v2.png', versions: [{}] } });
  const packet = await h.packet();
  assert.deepEqual(packet.assets.filter(asset => asset.kind === 'product').map(asset => [asset.name,asset.title]), [['product-1.png','Fine Chain 2'],['product-2.png','Fine Chain 1']]);
  assert.ok(packet.prompt.indexOf('product-1.png: Fine Chain 2') < packet.prompt.indexOf('product-2.png: Fine Chain 1'));
  assert.equal(packet.version,3);
  assert.deepEqual(h.state.photoReads,[]); assert.deepEqual(h.state.driveReads,[]); assert.deepEqual(h.state.previousReads,[]);
  const files = unzip((await h.pack()).bytes);
  assert.equal(files.get('brief.txt').toString(),packet.prompt);
  assert.deepEqual(h.state.photoReads,[photo(2),photo(1)]);
  assert.deepEqual([...await sharp(files.get('product-1.png')).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()],[0,0,255]);
  assert.deepEqual([...await sharp(files.get('product-2.png')).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()],[255,0,0]);
  assert.ok(files.has('style-1.png')); assert.ok(files.has('previous-artwork.png'));
  assert.equal(h.state.driveReads[0].expected,revision); assert.ok(h.state.driveReads[0].signal instanceof AbortSignal);
  assert.deepEqual(h.state.previousReads,['previous-v2.png']); assert.equal(h.state.storageWrites,0);
  assert.equal(h.state.saves,1);
  assert.ok(h.state.writes.every(write => Object.keys(write.values).length === 1 && write.values.artwork_handoff));
  assert.equal(JSON.stringify(h.state.row.artwork_handoff).includes('base64'),false);
});

test('a carousel keeps its shared format and only displays a live verified price', async () => {
  const firstId='33333333-3333-4333-8333-333333333333';
  const row={product_ids:[1],carousel_source:{series_id:'series-1',index:2,total:3,template_design_id:firstId,direction:'Warm ivory grid; fixed product position.'},ref_ids:['chain']};
  const designs=[{id:firstId,requested_by:'owner',status:'ready',image_path:'template-v1.png',carousel_source:{series_id:'series-1',index:1,total:3},versions:[]}];
  const priced=harness({row,designs,price:{min:1299,max:1799,currency:'INR',checkedAt:'2026-11-02T10:00:00Z'}});
  const packet=await priced.packet();
  assert.match(packet.prompt,/card 2 of a 3-card carousel ad/);
  assert.match(packet.prompt,/Warm ivory grid; fixed product position/);
  assert.match(packet.prompt,/FIXED CAROUSEL TEMPLATE/);
  assert.deepEqual(packet.assets.map(asset=>asset.kind),['product','template']);
  assert.match(packet.prompt,/from ₹1,299/);
  assert.match(packet.prompt,/offer only when the manager explicitly supplied/);
  const files=unzip((await priced.pack()).bytes);
  assert.ok(files.has('template-1.png'));
  assert.deepEqual(priced.state.previousReads,['template-v1.png']);
  const unpriced=harness({row,designs});
  assert.match((await unpriced.packet()).prompt,/omit all prices/);
});

test('normal revisions rerank prior irrelevant references using product category and manager direction', async () => {
  const h = harness({ row: { product_ids: [1], ref_ids: ['idol'], redo_note: 'Minimal ivory studio. No ceremonial props.' }, products: [product(1,'Fine Millennium Chain Gold Layered')], refs: [
    reference('idol','Idol wedding gifting', { tags: ['idol'], quality: 5, pinned: true }),
    reference('dark','Chain on black velvet', { style: 'dark velvet dramatic', palette: 'black gold', quality: 5, pinned: true }),
    reference('ivory','Chain in ivory studio'),
    reference('plain','Fine chain minimalist', { style: 'minimal ivory studio', quality: 2 }),
  ] });
  const packet = await h.packet(), styles = packet.assets.filter(asset => asset.kind === 'style');
  assert.ok(['Chain in ivory studio','Fine chain minimalist'].includes(styles[0].title), 'explicit ivory direction beats the popular dark chain');
  assert.equal(styles.some(asset => asset.title === 'Idol wedding gifting'),false);
  assert.equal(styles.length,3); assert.match(packet.prompt,/REQUESTED REVISION.*No ceremonial props/s);
});

test('a Christmas request treats Diwali artwork as design technique, not scene content', async () => {
  const h = harness({ row: { product_ids: [1], brief: 'Create Christmas theme images for the fine chain' }, products: [product(1)], refs: [
    reference('diwali','Diwali chain artwork',{occasion:'Diwali',style:'Warm diyas and brass lamps',quality:5,pinned:true}),
    reference('general','Fine chain studio',{occasion:'general',style:'Ivory studio lighting'}),
  ] });
  const packet=await h.packet();
  assert.equal(packet.assets.find(asset=>asset.kind==='style').title,'Fine chain studio');
  assert.equal(packet.assets.filter(asset=>asset.kind==='style').length,1);
  assert.match(packet.prompt,/current brief and requested occasion control the subject, setting, symbols, decorations and props/);
  assert.match(packet.prompt,/different festival shown or described in a past reference must not appear/);
  assert.match(packet.prompt,/CURRENT TASK OCCASION: CHRISTMAS/);
});

test('Christmas necklace posters with only Diwali necklace references attach no old festival pixels',async()=>{
  const h=harness({row:{product_ids:[1],brief:'Create a Christmas promotion poster for this necklace'},products:[product(1,'Bead Knot Slim Chain Necklace')],refs:[
    reference('diwali','Chain on diyas',{occasion:'Diwali',style:'Gold chain with traditional brass lamps',tags:['chain'],quality:5}),
    reference('festive','Festive necklace',{occasion:'festive',style:'Palace background with lanterns',tags:['necklace'],quality:5}),
    reference('resort','Christmas resort',{occasion:'Christmas',style:'Misty hill station hotel',tags:['resort'],quality:5}),
  ]});
  const packet=await h.packet();
  assert.deepEqual(packet.assets.filter(asset=>asset.kind==='style'),[]);
  assert.match(packet.prompt,/Do not use diyas, brass oil lamps/);
  assert.match(packet.prompt,/No matching saved style reference/);
});

test('a fresh theme correction can omit the previous contaminated artwork',async()=>{
  const h=harness({row:{product_ids:[1],brief:'Christmas necklace poster',image_path:'old-diwali.png',redo_note:'Start from the official product photo. Do not use previous artwork. Make a fresh Christmas scene.'},products:[product(1)],refs:[reference('diwali','Diwali chain',{occasion:'Diwali',tags:['chain']})]});
  const packet=await h.packet();
  assert.deepEqual(packet.assets.map(asset=>asset.kind),['product']);
  const files=unzip((await h.pack()).bytes);
  assert.deepEqual([...files.keys()],['brief.txt','README.txt','product-1.png']);
  assert.deepEqual(h.state.previousReads,[]);
});

test('packets keep all product photos while fitting the image tool reference limit', async () => {
  const options={row:{product_ids:[1,2,3]},products:[product(1),product(2),product(3)],refs:[
    reference('a','Fine chain design A'),reference('b','Fine chain design B'),reference('c','Fine chain design C'),
  ]};
  const fresh=harness(options),packet=await fresh.packet();
  assert.equal(packet.assets.length,5);
  assert.deepEqual(packet.assets.filter(asset=>asset.kind==='product').map(asset=>asset.name),['product-1.png','product-2.png','product-3.png']);
  assert.deepEqual(packet.assets.filter(asset=>asset.kind==='style').map(asset=>asset.name),['style-1.png','style-2.png']);
  assert.doesNotMatch(packet.prompt,/style-3\.png/);
  const revision=harness({...options,row:{...options.row,image_path:'previous-v1.png'}}),revisionPacket=await revision.packet();
  assert.equal(revisionPacket.assets.length,5);
  assert.equal(revisionPacket.assets.filter(asset=>asset.kind==='style').length,1);
  assert.equal(revisionPacket.assets.at(-1).name,'previous-artwork.png');
});

test('explicit carousel references outside the general bound are preserved and missing chosen references reject', async () => {
  const chosen = reference('zz-selected','Chosen ring design', { tags: ['ring'] });
  const refs = Array.from({ length: 1000 }, (_,i) => reference(`candidate-${String(i).padStart(4,'0')}`,'Chain design'));
  const h = harness({ row: { format: 'carousel_card', carousel_id: 'set', carousel_index: 1, ref_ids: [chosen.id] }, refs: [...refs,chosen] });
  const packet = await h.packet();
  assert.deepEqual(packet.assets.filter(asset => asset.kind === 'style').map(asset => asset.title),['Chosen ring design']);
  assert.match(packet.prompt,/card 1 of a five-card carousel/);
  for (const selected of [[],[{ ...chosen, hidden: true }],[{ ...chosen, modified_at: null }]]) {
    const missing = harness({ row: { carousel_id: 'set', carousel_index: 1, ref_ids: [chosen.id] }, refs: [reference('other','Other chain'),...selected] });
    await assert.rejects(missing.packet(),/selected carousel style reference is unavailable/);
    assert.equal(missing.state.saves,0); assert.deepEqual(missing.state.driveReads,[]);
  }
});

test('saved request metadata keeps the brief and product files stable across later product/library changes', async () => {
  const h = harness();
  const first = await h.packet();
  const metadataReads = h.state.reads.filter(read => ['products','design_refs'].includes(read.table)).length;
  h.state.products = [product(1,'A changed product name')];
  h.state.refs.push(reference('better','A newly added chain reference', { pinned: true, quality: 5 }));
  const second = await h.packet();
  assert.deepEqual(second,first); assert.equal(h.state.saves,1);
  assert.equal(h.state.reads.filter(read => ['products','design_refs'].includes(read.table)).length,metadataReads);
  const files = unzip((await h.pack()).bytes);
  assert.equal(files.get('brief.txt').toString(),first.prompt);
  assert.deepEqual(h.state.photoReads,[photo(2),photo(1)]);
});

test('a concurrent packet CAS loser uses the saved winner instead of returning its own reference choices', async () => {
  const winner = { packet: { source: 'design', id, requestId, prompt: 'The first saved brief wins.', assets: [], version: 1 }, refs: [], products: [] };
  const h = harness({ beforeSave(state) { state.row.artwork_handoff = structuredClone(winner); } });
  assert.deepEqual(await h.packet(),{...winner.packet,provider:'chatgpt'});
  assert.equal(h.state.writes[0].matched,0);
  const files = unzip((await h.pack()).bytes);
  assert.equal(files.get('brief.txt').toString(),winner.packet.prompt);
  assert.deepEqual(h.state.photoReads,[]); assert.deepEqual(h.state.driveReads,[]);
});

test('a changed revision during snapshot save is rejected and cached references must retain their verified revision', async () => {
  const changed = harness({ beforeSave(state) { state.row.artwork_request_id = randomUUID(); state.row.artwork_handoff = null; } });
  await assert.rejects(changed.packet(),/artwork request changed/);
  const h = harness(); await h.packet(); h.state.refs[0].modified_at = '2026-10-29T00:00:00.000Z';
  await assert.rejects(h.pack(),/saved style reference has changed/);
  assert.deepEqual(h.state.driveReads,[]);
  const unreadable = harness({ driveError: true });
  await assert.rejects(unreadable.pack(),/could not be verified or read from Drive/);
  assert.equal(unreadable.state.storageWrites,0);
});

test('a valid empty library remains usable while a library read error stops packet creation', async () => {
  const empty = harness({ refs: [] });
  assert.match((await empty.packet()).prompt,/No matching saved style reference/);
  const failed = harness({ libraryError: true });
  await assert.rejects(failed.packet(),/Design Library could not be read/);
  assert.equal(failed.state.saves,0);
});

test('campaign packets preserve the saved canvas format', async () => {
  const h = harness({ source: 'creative', row: { kind: 'banner', format: 'web_banner', status: 'draft', art_status: 'awaiting_import', campaigns: { status: 'draft' } } });
  const packet = await h.packet();
  assert.equal(packet.format,'web_banner'); assert.match(packet.prompt,/Canvas: 16:9 aspect ratio/);
  assert.equal((await h.access()).row.art_status,'awaiting_import');
  assert.equal((await h.generation()).packet.requestId,requestId);
  h.state.row.art_status='ready';
  await assert.rejects(h.access(),/Prepare a revision/);
  await assert.rejects(h.generation(),/artwork request changed/);
});

test('switching to Higgsfield reuses the exact frozen brief and sources with website-specific pack instructions',async()=>{
  const h=harness();const first=await h.packet('chatgpt'),second=await h.packet('higgsfield');
  assert.equal(second.provider,'higgsfield');assert.equal(second.requestId,first.requestId);assert.equal(second.prompt,first.prompt);assert.deepEqual(second.assets,first.assets);assert.equal(h.state.saves,1);
  const files=unzip((await h.pack('higgsfield')).bytes), readme=files.get('README.txt').toString();
  assert.equal(files.get('brief.txt').toString(),first.prompt);assert.match(readme,/enable Unlimited/);assert.match(readme,/Select Higgsfield/);assert.match(readme,/model=nano-banana-pro/);assert.doesNotMatch(readme,/in ChatGPT/);
  await assert.rejects(h.packet('unsupported'),/Choose ChatGPT or Higgsfield/);
});
