import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/agents/design.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const row = { carousel_source: { product_id: '42', image_url: 'https://cdn.shopify.com/product.png', title: 'Gold ring', category: 'Ring' },
  carousel_index: 2, carousel_id: 'set', product_ids: [42], redo_note: null };

function harness(verdicts, changes = {}) {
  const calls = { images: [], reviews: [], renders: [], refs: [], events: [] };
  const parts = { photo: { inlineData: { mimeType: 'image/png', data: 'source-photo' } }, style: { inlineData: { mimeType: 'image/png', data: 'style-scene' } } };
  const modules = {
    '@/lib/artwork-mode.mjs': { isChatGPTHandoff: () => false },
    'server-only': {},
    './carousel-card.mjs': {
      shopifyPhotoUrl: value => value,
      fetchShopifyPhoto: async () => Buffer.from('photo'),
      imageReferencePart: async bytes => { calls.refs.push(bytes.toString()); return bytes.toString() === 'photo' ? parts.photo : parts.style; },
      renderCarouselCard: async options => { calls.renders.push(options); return { data: Buffer.from('finished'), mimeType: 'image/png' }; },
    },
    './carousel': { carouselBackgroundFor: async () => ({ bytes: Buffer.from('style'), refIds: ['chosen-reference'] }) },
    '@/lib/llm/gemini': {
      bannerImage: async (...args) => { calls.images.push(args); return { data: Buffer.from(`scene-${calls.images.length}`), mimeType: 'image/png' }; },
      geminiJSON: async (...args) => { calls.reviews.push(args); return verdicts[calls.reviews.length - 1]; },
    },
    './events': { emit: async (...args) => { calls.events.push(args); } },
    '@/lib/usage': { withUsage: (_scope, work) => work() },
    './people': { byId: { designer: { room: 'creative' } }, HUMAN_HEAD: { creative: 'creativeHead' } },
  };
  const exports = {};
  new Function('exports', 'require', code)(exports, id => modules[id] || {});
  return { calls, parts, run: () => exports.carouselArtwork({}, { ...row, ...changes }) };
}

test('carousel generates the product inside the scene, reviews against Shopify, and fixes one mismatch', async () => {
  const h = harness([{ sameProduct: false, designQuality: true, followsDirection: true, note: 'Stone arrangement differs.' }, { sameProduct: true, designQuality: true, followsDirection: true, note: 'Distinctive ring details and requested finish match.' }]);
  const result = await h.run();
  assert.equal(result.check.ok, true);
  assert.equal(h.calls.images.length, 2);
  assert.equal(h.calls.reviews.length, 2);
  assert.deepEqual(h.calls.refs, ['photo', 'style']);
  assert.equal(h.calls.images[0][3][0], h.parts.photo);
  assert.equal(h.calls.images[0][4][0], h.parts.style);
  assert.equal(h.calls.reviews[0][1][1], h.parts.photo);
  assert.equal(h.calls.reviews[0][1][2], h.parts.style);
  assert.match(h.calls.images[0][0], /Do not cut out, paste, collage/);
  assert.match(h.calls.images[1][0], /Stone arrangement differs/);
  assert.equal(h.calls.renders.at(-1).sceneBytes.toString(), 'scene-2');
  assert.equal('imageBytes' in h.calls.renders.at(-1), false);
});

test('two uncertain or mismatched attempts remain unapproved', async () => {
  const h = harness([{ sameProduct: false, designQuality: true, followsDirection: true, note: 'Different band.' }, { sameProduct: false, designQuality: true, followsDirection: true, note: 'The setting still differs.' }]);
  const result = await h.run();
  assert.equal(result.check.ok, false);
  assert.equal(h.calls.images.length, 2);
  assert.equal(result.check.note, 'The setting still differs.');
  assert.equal(h.calls.renders.at(-1).sceneBytes.toString(), 'scene-2');
});

test('matching jewellery cannot pass with poor finish or ignored redesign direction', async () => {
  for (const verdict of [
    { sameProduct: true, designQuality: false, followsDirection: true, note: 'Flat product lighting; add directional light and a coherent shadow.' },
    { sameProduct: true, designQuality: true, followsDirection: false, note: 'Background stayed cream; use the requested deep blue silk.' },
  ]) {
    const h = harness([verdict, verdict], { redo_note: 'Use deep blue silk with directional light.' });
    const result = await h.run();
    assert.equal(result.check.ok, false);
    assert.equal(result.check.note, verdict.note);
    assert.equal(h.calls.images.length, 2);
    assert.equal(h.calls.reviews.length, 2);
    assert.ok(h.calls.images[1][0].includes(verdict.note));
    assert.ok(h.calls.reviews.every(args => args[0].includes('Use deep blue silk with directional light.')));
    assert.ok(h.calls.reviews.every(args => args[1][2] === h.parts.style));
  }
});

test('a corrected carousel needs all three quality checks before passing', async () => {
  const h = harness([
    { sameProduct: true, designQuality: false, followsDirection: false, note: 'Clutter hides the ring and the requested dark palette is missing.' },
    { sameProduct: true, designQuality: true, followsDirection: true, note: 'Exact ring, clear lighting and the requested dark palette.' },
  ]);
  assert.equal((await h.run()).check.ok, true);
  assert.equal(h.calls.images.length, 2);
});

test('missing, malformed or incomplete carousel verdicts cannot approve a card', async () => {
  for (const verdict of [
    null,
    { sameProduct: 'true', designQuality: true, followsDirection: true, note: 'Looks similar.' },
    { sameProduct: true, note: 'Product matches, no design review.' },
    { sameProduct: true, designQuality: 'true', followsDirection: true, note: 'Looks fine.' },
    { sameProduct: true, designQuality: true, followsDirection: 'true', note: 'Looks fine.' },
    { sameProduct: true, designQuality: true, followsDirection: true, note: '   ' },
  ]) {
    const h = harness([verdict]);
    await assert.rejects(h.run(), /valid verdict/);
    assert.equal(h.calls.renders.length, 1);
    assert.equal(h.calls.images.length, 1);
  }
});
