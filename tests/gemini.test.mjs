import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, chmod, symlink, readFile, readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGeminiModel, cleanGeminiKey, geminiFailure, geminiImage, geminiImageGenerationConfig, geminiRequest, publicGeminiConfig, resolveGeminiConfig } from '../src/lib/llm/gemini-core.mjs';
import { createGeminiStore } from '../src/lib/llm/gemini-store.mjs';

const serverKey = 'AQ-server-key-for-tests-only-123456789';
const savedKey = 'AIza-saved-key-for-tests-only-987654321';
const model = 'gemini-3.1-flash-image';
const config = key => resolveGeminiConfig(null, { GEMINI_API_KEY: key });
async function temporary(fn) {
  const directory = await mkdtemp(join(realpathSync(tmpdir()), 'parakkat-gemini-test-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('AQ and AIza keys work; saved overrides win and public metadata never contains a key', () => {
  assert.equal(cleanGeminiKey(` ${serverKey} `), serverKey);
  assert.equal(cleanGeminiKey(savedKey), savedKey);
  const c = resolveGeminiConfig({ tokens: { access_token: savedKey } }, { GEMINI_API_KEY: serverKey });
  assert.equal(c.apiKey, savedKey);
  assert.equal(c.source, 'saved');
  assert.equal(JSON.stringify(publicGeminiConfig(c)).includes(savedKey), false);
  assert.equal('apiKey' in publicGeminiConfig(c), false);
  assert.throws(() => cleanGeminiKey('short'), /valid Gemini API key/);
  assert.throws(() => cleanGeminiKey(`${savedKey}\nheader`), /valid Gemini API key/);
});

test('premium Pro 2K is the default, while explicit models and supported resolutions remain selected', () => {
  const defaults=config(serverKey);
  assert.equal(defaults.imageModel,'gemini-3-pro-image');
  assert.equal(defaults.imageSize,'2K');
  assert.deepEqual(geminiImageGenerationConfig(defaults,'4:5'),{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:'4:5',imageSize:'2K'}});
  assert.equal(publicGeminiConfig(defaults).imageSize,'2K');
  const explicit=resolveGeminiConfig(null,{GEMINI_IMAGE_MODEL:'gemini-3.1-flash-image',GEMINI_IMAGE_SIZE:'4K'});
  assert.equal(explicit.imageModel,'gemini-3.1-flash-image');
  assert.equal(geminiImageGenerationConfig(explicit).imageConfig.imageSize,'4K');
  for(const imageSize of ['2k','8K','1024'])assert.throws(()=>resolveGeminiConfig(null,{GEMINI_IMAGE_SIZE:imageSize}),error=>error.code==='invalid_image_size');
});

test('explicit legacy image models keep their supported request format without silent model fallback', () => {
  const legacy=resolveGeminiConfig(null,{GEMINI_IMAGE_MODEL:'gemini-2.5-flash-image'});
  assert.equal(legacy.imageModel,'gemini-2.5-flash-image');assert.equal(legacy.imageSize,'1K');
  assert.deepEqual(geminiImageGenerationConfig(legacy,'1:1'),{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:'1:1'}});
  for(const model of ['gemini-2.5-flash-image','gemini-3.1-flash-lite-image'])
    assert.throws(()=>resolveGeminiConfig(null,{GEMINI_IMAGE_MODEL:model,GEMINI_IMAGE_SIZE:'2K'}),error=>error.code==='invalid_image_size');
});

test('save-time model check uses only GET and a header key, never a prompt or URL secret', async () => {
  await checkGeminiModel(serverKey, model, async (url, options) => {
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${model}`);
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.equal(options.headers['x-goog-api-key'], serverKey);
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    return Response.json({ name: `models/${model}`, supportedGenerationMethods: ['generateContent'] });
  });
  await assert.rejects(checkGeminiModel(serverKey, model, async () => Response.json({ name: `models/${model}`, supportedGenerationMethods: [] })), e => e.code === 'model_unavailable');
});

test('generation is explicit and errors never echo upstream text, keys, or network URLs', async () => {
  let sent = 0;
  const body = { contents: [{ role: 'user', parts: [{ text: 'Test image.' }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } };
  await assert.rejects(geminiRequest({ apiKey: serverKey, model, body, fetch: async (url, options) => {
    sent++; assert.ok(url.endsWith(':generateContent')); assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), body);
    return Response.json({ error: { message: `secret ${serverKey}, limit: 0`, status: 'RESOURCE_EXHAUSTED' } }, { status: 429 });
  } }), e => e.code === 'quota' && /no image quota/.test(e.message) && !e.message.includes(serverKey));
  assert.equal(sent, 1);
  await assert.rejects(geminiRequest({ apiKey: serverKey, model, fetch: async () => { throw new Error(serverKey); } }), e => e.code === 'network' && !e.message.includes(serverKey));
  await assert.rejects(geminiRequest({ apiKey: serverKey, model, fetch: async () => Response.json({ error: { message: serverKey } }, { status: 403 }) }), e => e.code === 'authentication' && !e.message.includes(serverKey));
});

test('invalid models and missing keys never reach the provider; unusable image responses fail', async () => {
  let calls = 0; const fetch = async () => { calls++; return Response.json({}); };
  await assert.rejects(geminiRequest({ apiKey: '', model, fetch }), e => e.code === 'missing_key');
  await assert.rejects(geminiRequest({ apiKey: serverKey, model: 'x?key=secret', fetch }), e => e.code === 'invalid_model');
  assert.equal(calls, 0);
  assert.throws(() => geminiImage([{ text: 'No image' }]), e => e.code === 'no_image');
  assert.throws(() => geminiImage([{ inlineData: { mimeType: 'text/html', data: 'YWJj' } }]), e => e.code === 'no_image');
});

test('interim thought images never replace the final finished image', () => {
  const draft={thought:true,inlineData:{mimeType:'image/png',data:Buffer.from('unfinished-draft').toString('base64')}};
  const finished={inlineData:{mimeType:'image/jpeg',data:Buffer.from('finished-image').toString('base64')}};
  const result=geminiImage([draft,{text:'The finished design follows.'},finished]);
  assert.equal(result.data.toString(),'finished-image');assert.equal(result.mimeType,'image/jpeg');
  assert.throws(()=>geminiImage([draft,{text:'No final image.'}]),error=>error.code==='no_image');
});

test('private persistent overrides use 0600 atomic files; removing one restores environment fallback', async () => temporary(async directory => {
  const env = { GEMINI_API_KEY: serverKey }, store = createGeminiStore({ directory, env });
  assert.equal((await store.getConfig()).apiKey, serverKey);
  await store.saveKey(savedKey);
  assert.equal((await stat(join(directory, 'gemini.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  const reloaded = createGeminiStore({ directory, env });
  assert.equal((await reloaded.getConfig()).apiKey, savedKey);
  const status = await reloaded.getStatus();
  assert.equal(status.status, 'configured'); assert.equal(status.checkedAt, null);
  assert.equal(JSON.stringify(status).includes(savedKey), false); assert.equal(JSON.stringify(status).includes(serverKey), false);
  await reloaded.useEnvironment();
  assert.equal((await store.getConfig()).apiKey, serverKey);
  assert.equal((await readFile(join(directory, 'gemini.json'), 'utf8')).includes(savedKey), false);
  assert.deepEqual(await readdir(directory), ['gemini.json']);
}));

test('image status survives restart, and an old in-flight key cannot overwrite the new key status', async () => temporary(async directory => {
  const env = { GEMINI_API_KEY: serverKey }, store = createGeminiStore({ directory, env });
  const old = await store.getConfig();
  await store.recordImageResult(old, geminiFailure(429, { error: { message: 'limit: 0' } }));
  assert.equal((await createGeminiStore({ directory, env }).getStatus()).status, 'error');
  await store.saveKey(savedKey);
  await store.recordImageResult(old);
  assert.equal((await store.getStatus()).status, 'configured');
  await store.recordImageResult(await store.getConfig());
  assert.equal((await store.getStatus()).status, 'connected');
  await store.useEnvironment();
  await store.recordImageResult(await store.getConfig());
  env.GEMINI_API_KEY = 'AQ-a-different-environment-key-123456';
  assert.equal((await store.getStatus()).status, 'configured');
}));

test('image verification belongs to the selected model and size, not only its key', async () => temporary(async directory => {
  const env={GEMINI_API_KEY:serverKey},store=createGeminiStore({directory,env});
  const old=await store.getConfig();await store.recordImageResult(old);
  assert.equal((await store.getStatus()).status,'connected');
  env.GEMINI_IMAGE_SIZE='4K';
  assert.equal((await store.getStatus()).status,'configured');
  await store.recordImageResult(old);
  assert.equal((await store.getStatus()).status,'configured');
  await store.recordImageResult(await store.getConfig());
  assert.equal((await store.getStatus()).status,'connected');
  env.GEMINI_IMAGE_MODEL='gemini-nano-banana-2.1';
  assert.equal((await store.getStatus()).status,'configured');
}));

test('concurrent updates preserve a valid private file and expose no key in error metadata', async () => temporary(async directory => {
  const store = createGeminiStore({ directory, env: { GEMINI_API_KEY: serverKey } });
  await Promise.all([store.saveKey(savedKey), store.recordImageResult(config(serverKey), new Error(`unsafe ${serverKey}`))]);
  assert.equal((await store.getConfig()).apiKey, savedKey);
  await store.recordImageResult(await store.getConfig(), new Error(`unsafe ${savedKey}`));
  assert.equal(JSON.stringify(await store.getStatus()).includes(savedKey), false);
  assert.deepEqual(await readdir(directory), ['gemini.json']);
}));

test('unsafe file permissions and symlinked credential files/directories are rejected', async () => temporary(async root => {
  const directory = join(root, 'private'), store = createGeminiStore({ directory, env: {} });
  await store.saveKey(savedKey);
  await chmod(join(directory, 'gemini.json'), 0o644);
  await assert.rejects(store.getConfig(), e => e.code === 'storage');
  await chmod(join(directory, 'gemini.json'), 0o600);
  await symlink(directory, join(root, 'linked'));
  await assert.rejects(createGeminiStore({ directory: join(root, 'linked'), env: {} }).getConfig(), e => e.code === 'storage');
  await symlink(join(directory, 'gemini.json'), join(root, 'secret-link'));
  await rm(join(directory, 'gemini.json'));
  await symlink(join(root, 'secret-link'), join(directory, 'gemini.json'));
  await assert.rejects(store.getConfig(), e => e.code === 'storage');
}));
