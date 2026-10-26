// The design library's pure parts: Drive links, which files are designs, search words and version names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderIdFrom, isDesignFile, childrenQuery, bigThumb, searchWords, recentConcepts, versionPath, refLine } from '../src/lib/agents/library-core.mjs';

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
  assert.match(q, /modifiedTime > '2026-10-01T00:00:00Z'$/);
  assert.match(q, /application\/vnd.google-apps.folder/);
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
  assert.equal(refLine({ occasion: 'Onam', style: 'Kasavu gold.', palette: 'cream, gold' }, 0), 'Reference 1 (Onam): Kasavu gold. Palette: cream, gold');
});
