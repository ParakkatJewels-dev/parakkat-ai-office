import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import sharp from 'sharp';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/artwork/brand-logo.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

function load(row, bytes) {
  const admin = {
    from: table => { assert.equal(table, 'brand_logo'); return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: row, error: null }) }; },
    storage: { from: bucket => { assert.equal(bucket, 'creatives'); return { download: async path => { assert.equal(path, row.path); return { data: new Blob([bytes]), error: null }; } }; } },
  };
  const modules = { 'server-only': {}, 'node:crypto': { createHash }, sharp,
    '@/lib/supabase/admin': { supabaseAdmin: () => admin } };
  const exports = {};
  new Function('exports', 'require', code)(exports, name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; });
  return exports;
}

test('the approved logo is required and its stored digest is verified', async () => {
  const logo = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#f00000' } }).png().toBuffer();
  const api = load({ path: 'brand/logo/approved.png', sha256: createHash('sha256').update(logo).digest('hex') }, logo);
  assert.deepEqual((await api.currentBrandLogo()).bytes, logo);
  await assert.rejects(load(null, logo).currentBrandLogo(), /Add the approved brand logo/);
  await assert.rejects(load({ path: 'brand/logo/approved.png', sha256: '0'.repeat(64) }, logo).currentBrandLogo(), /changed unexpectedly/);
});

test('the final artwork contains pixels from the uploaded logo in the reserved area', async () => {
  const logo = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#f00000' } }).png().toBuffer();
  const base = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#0000f0' } }).png().toBuffer();
  const api = load(null, logo);
  const normalized = await api.normalizeBrandLogo(logo);
  const finished = await api.applyBrandLogo(base, { bytes: normalized, path: 'brand/logo/approved.png', sha256: '' });
  const { data, info } = await sharp(finished).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 800); assert.equal(info.height, 800);
  const pixel = (x, y) => [...data.subarray((y * 800 + x) * info.channels, (y * 800 + x) * info.channels + 3)];
  assert.deepEqual(pixel(100, 100), [0, 0, 240]);
  assert.deepEqual(pixel(680, 50), [240, 0, 0]);
  await assert.rejects(api.normalizeBrandLogo(Buffer.from('<svg/>')), /Upload a complete PNG/);
});
