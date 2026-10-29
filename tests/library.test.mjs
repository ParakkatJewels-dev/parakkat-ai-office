// The design library's pure parts: Drive links, which files are designs, search words and version names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderIdFrom, isDesignFile, childrenQuery, bigThumb, searchWords, recentConcepts, versionPath, refLine, referenceFingerprint } from '../src/lib/agents/library-core.mjs';

test('a Drive folder is read from a link or a bare id, and anything else is refused', () => {
  assert.equal(folderIdFrom('https://drive.google.com/drive/folders/1AbC-dEf_123456789?usp=sharing'), '1AbC-dEf_123456789');
  assert.equal(folderIdFrom('https://drive.google.com/drive/u/0/folders/1AbCdEf123456789'), '1AbCdEf123456789');
  assert.equal(folderIdFrom('https://drive.google.com/open?id=1AbCdEf123456789'), '1AbCdEf123456789');
  assert.equal(folderIdFrom(' 1AbCdEf123456789 '), '1AbCdEf123456789');
  assert.equal(folderIdFrom('Onam 2025'), null);
  assert.equal(folderIdFrom(''), null);
});

test('designs include images, PDFs and Photoshop files, not video, GIFs or documents', () => {
  for (const m of ['image/jpeg', 'image/png', 'image/vnd.adobe.photoshop', 'application/pdf', 'image/tiff']) assert.ok(isDesignFile(m), m);
  for (const m of ['video/mp4', 'image/gif', 'application/vnd.google-apps.document', 'image/svg+xml']) assert.ok(!isDesignFile(m), m);
  const q = childrenQuery("abc'd", '2026-10-01T00:00:00Z');
  assert.match(q, /^'abcd' in parents and trashed = false/);
  assert.equal(q, "'abcd' in parents and trashed = false");
  assert.doesNotMatch(q, /modifiedTime|mimeType/); // stable pagination; TIFF and old moved folders remain discoverable
});

test('thumbnails are asked for at a size the model can read', () => {
  assert.equal(bigThumb('https://lh3.googleusercontent.com/drive-storage/abc=s220'), 'https://lh3.googleusercontent.com/drive-storage/abc=s1280');
  assert.equal(bigThumb('https://lh3.googleusercontent.com/abc'), 'https://lh3.googleusercontent.com/abc=s1280');
});

test('search words drop filler and join with or', () => {
  assert.equal(searchWords('Onam', 'Onam offer on temple necklaces, for Instagram this week!', 'Instagram post'), 'onam or offer or temple or necklaces');
  assert.equal(searchWords(''), '');
});

test('recent concepts are trimmed and not repeated; versions number from two', () => {
  assert.deepEqual(recentConcepts([{ concept: 'Green  silk' }, { concept: null }, { concept: 'Green silk' }, { concept: 'Brass lamp' }]), ['Green silk', 'Brass lamp']);
  assert.equal(versionPath('designs/abc.png', 1), 'designs/abc.png');
  assert.equal(versionPath('designs/abc.png', 2), 'designs/abc-v2.png');
  assert.equal(versionPath('designs/abc-v2.png', 3), 'designs/abc-v3.png');
  assert.equal(refLine({ occasion: 'Onam', style: 'Kasavu gold.', palette: 'cream, gold' }, 0), 'Reference 1 (Onam): Visual brief: Kasavu gold.; Palette: cream, gold');
});

test('a stored fingerprint gives useful art direction without image bytes', () => {
  const line=referenceFingerprint({name:'Ring',fingerprint:{visualBrief:'Deep maroon festive scene',composition:'Hero centered with empty top space',lighting:'Warm diya glow',productionNotes:'Layer drapery, then soft bokeh and brass lamps'}});
  assert.match(line,/Warm diya glow/);
  assert.match(line,/Hero centered/);
  assert.doesNotMatch(line,/undefined|data:image|base64/);
});

test('long descriptions preserve every populated art-direction category within the prompt limit', () => {
  const line = referenceFingerprint({ fingerprint: {
    visualBrief: 'Festive scene. '.repeat(400), composition: 'Hero centered. '.repeat(400),
    palette: 'Maroon and warm gold', lighting: 'Soft window light from the left',
    materials: 'Silk and brushed brass', typography: 'Small serif headline aligned right',
    productionNotes: 'Place the product before arranging the silk', avoid: 'No copied jewellery or original wording',
  } });
  assert.ok(line.length <= 2200);
  for (const detail of ['Visual brief: Festive scene.', 'Composition: Hero centered.',
    'Palette: Maroon and warm gold', 'Lighting: Soft window light from the left',
    'Materials and props: Silk and brushed brass', 'Typography: Small serif headline aligned right',
    'How it was made: Place the product before arranging the silk', 'Avoid: No copied jewellery or original wording']) {
    assert.ok(line.includes(detail), detail);
  }
  assert.match(line, /…; Composition:/);
});

test('each oversized category receives space and clipped Unicode remains well formed', () => {
  const fingerprint = Object.fromEntries(['visualBrief', 'composition', 'palette', 'lighting', 'materials', 'typography', 'productionNotes', 'avoid']
    .map(key => [key, `${key} ${'✨🌿'.repeat(1000)}`]));
  const line = referenceFingerprint({ fingerprint });
  assert.ok(line.length <= 2200);
  for (const key of Object.keys(fingerprint)) assert.ok(line.includes(`${key} `), key);
  assert.equal(line.split('…').length, 9);
  assert.equal(line.isWellFormed(), true);
});

test('legacy fields still supply missing fingerprint categories without losing short values', () => {
  assert.equal(referenceFingerprint({ fingerprint: { lighting: 'Soft shadows', palette: 'Ivory' },
    style: 'Quiet luxury', layout: 'Product centered', palette: 'Old gold', typography: 'Serif headline' }),
  'Visual brief: Quiet luxury; Composition: Product centered; Palette: Ivory; Lighting: Soft shadows; Typography: Serif headline');
  assert.equal(referenceFingerprint({}), '');
});
