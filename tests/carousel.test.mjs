import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { carouselIntent, carouselSelection, salesPosterIntent, carouselRedesignIntent, carouselIdFromConversation } from '../src/lib/agents/carousel-core.mjs';
import { imageReferencePart, renderCarouselCard, shopifyPhotoUrl } from '../src/lib/agents/carousel-card.mjs';

const photo = 'https://cdn.shopify.com/s/files/1/1234/files/ring.webp';

test('carousel request requires an explicit build instruction and exact sales category', () => {
  assert.equal(carouselIntent('make a carsoule ad of top selling ring products'), 'Ring');
  assert.equal(carouselIntent('give a brief for top selling Ring carousel; do not generate'), null);
  assert.equal(carouselIntent('list the top selling Rings'), null);
});

test('a top-seller ad poster is one image while a later carousel redesign resolves the saved set',()=>{
  assert.deepEqual(salesPosterIntent('find the top selling product and generate a poster for ads'),{category:null,format:'portrait'});
  assert.deepEqual(salesPosterIntent('Find the top-selling product from the latest complete 30 days of recorded Shopify sales, then ask the right design agent to generate an ad poster for human review. Do not publish it.'),{category:null,format:'portrait'});
  assert.deepEqual(salesPosterIntent('Generate an ad poster for the highest-selling rings'),{category:'Ring',format:'portrait'});
  assert.deepEqual(salesPosterIntent('make a printed poster for the best selling rings'),{category:'Ring',format:'poster'});
  assert.equal(salesPosterIntent('make a five-card carousel poster of top selling rings'),null);
  assert.equal(salesPosterIntent('draft a brief only for a top selling poster'),null);
  const id='11111111-1111-4111-8111-111111111111';
  assert.equal(carouselRedesignIntent('redesign the 5 carsoule cards'),true);
  assert.equal(carouselIdFromConversation('redesign the 5 carsoule cards',[{content:`Review: /studio?carousel=${id}`}]),id);
  assert.equal(carouselIdFromConversation('redesign this set',[{content:'No saved carousel link'}]),null);
});

test('selection skips zero stock while preserving exact category sales order', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ product_id: String(1000 + i), title: `Ring ${i}`, units: 8 - i,
    stock: i === 1 ? 0 : 12, status: 'ACTIVE', image_url: photo }));
  const selected = carouselSelection({ available: true, sample: { top_rank_complete: true }, data: rows });
  assert.deepEqual(selected.map(row => row.product_id), ['1000', '1002', '1003', '1004', '1005']);
  assert.throws(() => carouselSelection({ available: false, sample: { top_rank_complete: true }, data: rows }), /complete category/);
  assert.equal(shopifyPhotoUrl('https://example.com/s/files/1/1234/files/ring.webp'), null);
});

test('card uses a generated scene and never composites source product photo pixels', async () => {
  const sceneBytes = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#23456a' } }).png().toBuffer();
  const card = await renderCarouselCard({ title: 'Navaratna Ornate Broad Ring Gold Layered', index: 1, sceneBytes });
  const metadata = await sharp(card.data).metadata();
  assert.equal(card.mimeType, 'image/png');
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  assert.deepEqual([...await sharp(card.data).extract({ left: 540, top: 650, width: 1, height: 1 }).removeAlpha().raw().toBuffer()], [35, 69, 106]);
  assert.notDeepEqual(await sharp(card.data).extract({ left: 540, top: 100, width: 1, height: 1 }).raw().toBuffer(),
    await sharp(card.data).extract({ left: 540, top: 650, width: 1, height: 1 }).raw().toBuffer());
  await assert.rejects(renderCarouselCard({ title: 'Ring', index: 1, imageBytes: sceneBytes }), /Invalid carousel card/);
});

test('product photo is supplied to the model as a normalized image reference', async () => {
  const photo = await sharp({ create: { width: 120, height: 150, channels: 3, background: '#a77b45' } }).webp().toBuffer();
  const part = await imageReferencePart(photo);
  assert.equal(part.inlineData.mimeType, 'image/png');
  const metadata = await sharp(Buffer.from(part.inlineData.data, 'base64')).metadata();
  assert.equal(metadata.width, 120);
  assert.equal(metadata.height, 150);
});
