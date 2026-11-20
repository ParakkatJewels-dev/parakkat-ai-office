import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/app/api/admin/brand-logos/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const id = '11111111-1111-4111-8111-111111111111';
function harness(role = 'super_admin') {
  const calls = { uploads: [], removed: [], assets: [], defaults: [], revalidated: [] };
  const existing = [];
  const assetQuery = {
    select() { return this; }, in() { return Promise.resolve({ data: existing, error: null }); },
    eq() { return this; }, maybeSingle: async () => ({ data: calls.assets[0] || null, error: null }),
    order() { return this; }, limit: async () => ({ data: calls.assets.slice(0, 1), error: null }),
    insert: async rows => { calls.assets.push(...rows); return { error: null }; },
  };
  const defaultQuery = {
    select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: calls.defaults.at(-1) || null, error: null }),
    insert: async row => { calls.defaults.push(row); return { error: null }; },
    upsert: async row => { calls.defaults.push(row); return { error: null }; },
  };
  const db = {
    from(table) { assert.ok(['brand_logo_assets', 'brand_logo'].includes(table)); return table === 'brand_logo_assets' ? assetQuery : defaultQuery; },
    storage: { from: bucket => { assert.equal(bucket, 'creatives'); return {
      upload: async (path, bytes) => { calls.uploads.push({ path, bytes }); return { error: null }; },
      remove: async paths => { calls.removed.push(paths); return { error: null }; },
    }; } },
  };
  const modules = {
    'node:crypto': crypto,
    'next/cache': { revalidatePath: path => calls.revalidated.push(path) },
    '@/lib/auth/session': { requireUser: async () => ({ role, user: { id: 'admin-user' } }) },
    '@/lib/supabase/admin': { supabaseAdmin: () => db },
    '@/lib/artwork/brand-logo': { normalizeBrandLogo: async bytes => bytes },
    '@/lib/artwork/import-core.mjs': { validId: value => value === id, validOrigin: request => request.headers.get('origin') === 'https://office.test' },
  };
  const exports = {};
  new Function('exports', 'require', code)(exports, name => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; });
  return { api: exports, calls };
}

function uploadRequest(count = 2) {
  const form = new FormData();
  for (let n = 0; n < count; n++) form.append('logos', new File([`logo-${n}`], `Logo ${n + 1}.png`, { type: 'image/png' }));
  return new Request('https://office.test/api/admin/brand-logos', { method: 'POST', headers: { origin: 'https://office.test' }, body: form });
}

test('one request saves multiple approved logos and selects the first default without a Server Action', async () => {
  const h = harness(), response = await h.api.POST(uploadRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).uploaded, 2);
  assert.equal(h.calls.assets.length, 2);
  assert.equal(h.calls.uploads.length, 2);
  assert.equal(h.calls.defaults.length, 1);
  assert.equal(h.calls.defaults[0].path, h.calls.assets[0].path);
  assert.deepEqual(h.calls.revalidated, ['/admin', '/studio']);
});

test('only the Super Admin can upload and choose a saved logo', async () => {
  const denied = harness('viewer');
  assert.equal((await denied.api.POST(uploadRequest())).status, 403);
  assert.equal(denied.calls.uploads.length, 0);
  const h = harness();
  await h.api.POST(uploadRequest(1));
  const response = await h.api.PATCH(new Request('https://office.test/api/admin/brand-logos', { method: 'PATCH', headers: { origin: 'https://office.test', 'content-type': 'application/json' }, body: JSON.stringify({ id }) }));
  assert.equal(response.status, 200);
  assert.equal(h.calls.defaults.at(-1).path, h.calls.assets[0].path);
});
