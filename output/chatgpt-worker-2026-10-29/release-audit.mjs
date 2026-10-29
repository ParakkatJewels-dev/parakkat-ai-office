#!/usr/bin/env node
// Run from the repository root, using Node's --env-file=.env.vps.local.
// snapshot/drain are read-only. pause/resume touch only system_state row 1.
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RELEASE = 'chatgpt-image-worker-20261029-r1';
const BANGLE = 'c28ab8b5-89d1-46ae-aaf1-c7bb277381bc';
const modes = new Set(['snapshot', 'pause', 'drain', 'resume']);
const mode = process.argv[2];
const label = process.argv[3] || mode;
if (!modes.has(mode) || !/^[a-zA-Z0-9_-]{1,80}$/.test(label)) {
  console.error('Usage: node --env-file=.env.vps.local output/chatgpt-worker-2026-10-29/release-audit.mjs snapshot|pause|drain|resume [safe-label]');
  process.exit(2);
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Required Supabase configuration is missing. Load .env.vps.local with Node --env-file.');
  process.exit(2);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) },
});
const folder = join(dirname(fileURLToPath(import.meta.url)), 'release-audit');
const ownershipFile = join(folder, 'pause-ownership.json');
await mkdir(folder, { recursive: true, mode: 0o700 });
const stable = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const failure = (operation, error) => new Error(`${operation} failed (${error?.code || 'request_error'}). No credentials or response body logged.`);

async function save(name, value, { exclusive = false } = {}) {
  const destination = join(folder, name);
  const body = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) await writeFile(destination, body, { mode: 0o600, flag: 'wx' });
  else {
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, body, { mode: 0o600, flag: 'wx' });
    await rename(temporary, destination);
  }
  return destination;
}
async function readOwnership() {
  try { return JSON.parse(await readFile(ownershipFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function systemState() {
  const { data, error } = await db.from('system_state').select('id,paused,paused_at,paused_by,reason').eq('id', 1).single();
  if (error || !data) throw failure('Read pause state', error);
  return data;
}
function exactState(query, state) {
  let next = query.eq('id', 1).eq('paused', state.paused);
  for (const name of ['paused_at', 'paused_by', 'reason']) next = state[name] == null ? next.is(name, null) : next.eq(name, state[name]);
  return next;
}
const sameState = (left, right) => !!left && !!right && ['id', 'paused', 'paused_at', 'paused_by', 'reason'].every(key =>
  key === 'paused_at' && left[key] && right[key] ? Date.parse(left[key]) === Date.parse(right[key]) : left[key] === right[key]);
async function rows(table, columns = '*', order = ['id']) {
  const output = [];
  for (let offset = 0; ; offset += 500) {
    let query = db.from(table).select(columns);
    for (const column of order) query = query.order(column);
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw failure(`Read ${table}`, error);
    output.push(...(data || []));
    if (!data || data.length < 500) break;
    if (offset >= 1_000_000) throw new Error(`Refusing incomplete ${table} snapshot beyond the safety bound.`);
  }
  return output;
}
async function counted(table, transform, { optional = false } = {}) {
  // GET retains PostgREST's missing-table error body before the additive worker
  // migration. HEAD omits it and cannot distinguish absence from a real failure.
  const query = optional
    ? db.from(table).select('id', { count: 'exact' }).limit(0)
    : db.from(table).select('*', { count: 'exact', head: true });
  const { count, error } = await transform(query);
  if (error && optional && ['42P01', 'PGRST205'].includes(error.code)) return { count: 0, tableAbsent: true };
  if (error || !Number.isInteger(count)) throw failure(`Count ${table}`, error);
  return { count };
}

async function activity() {
  const now = new Date().toISOString(), recent = new Date(Date.now() - 30 * 60_000).toISOString();
  const checks = {
    agent_tasks_running: ['agent_tasks', q => q.eq('status', 'running')],
    agent_meetings_running: ['agent_meetings', q => q.eq('status', 'running')],
    agent_runs_running: ['agent_runs', q => q.eq('status', 'running')],
    automation_tasks_running: ['automation_tasks', q => q.eq('status', 'running')],
    automation_task_live_leases: ['automation_tasks', q => q.gt('lease_until', now)],
    automation_actions_executing: ['automation_actions', q => q.eq('status', 'executing')],
    designs_active: ['designs', q => q.in('status', ['making', 'generating'])],
    creatives_active: ['creatives', q => q.in('art_status', ['making', 'generating'])],
    carousel_backgrounds_active: ['carousel_sets', q => q.eq('background_status', 'making')],
    job_locks_live: ['job_locks', q => q.gt('until', now)],
    higgsfield_active: ['artwork_generation_jobs', q => q.in('state', ['submitting', 'submitted', 'collecting'])],
    higgsfield_live_leases: ['artwork_generation_jobs', q => q.gt('lease_until', now)],
    higgsfield_projects_creating: ['higgsfield_generation_projects', q => q.eq('state', 'creating').gt('lease_until', now)],
    chatgpt_images_active: ['chatgpt_image_jobs', q => q.in('state', ['preparing', 'generating']), { optional: true }],
    chatgpt_images_live_leases: ['chatgpt_image_jobs', q => q.gt('lease_until', now), { optional: true }],
    recent_text_reservations: ['ai_usage_reservations', q => q.eq('status', 'reserved').gte('created_at', recent)],
  };
  const informational = {
    agent_tasks_queued: ['agent_tasks', q => q.eq('status', 'queued')],
    automation_tasks_queued: ['automation_tasks', q => q.eq('status', 'queued')],
    designs_queued: ['designs', q => q.eq('status', 'queued')],
    creatives_queued: ['creatives', q => q.eq('art_status', 'queued')],
    higgsfield_queued: ['artwork_generation_jobs', q => q.eq('state', 'queued')],
    higgsfield_uncertain: ['artwork_generation_jobs', q => q.eq('state', 'uncertain')],
    chatgpt_images_queued: ['chatgpt_image_jobs', q => q.eq('state', 'queued'), { optional: true }],
    chatgpt_images_uncertain: ['chatgpt_image_jobs', q => q.eq('state', 'uncertain'), { optional: true }],
    old_text_reservations: ['ai_usage_reservations', q => q.eq('status', 'reserved').lt('created_at', recent)],
  };
  const collect = async definitions => Object.fromEntries(await Promise.all(Object.entries(definitions).map(async ([name, args]) => [name, await counted(...args)])));
  const [blocking, pending] = await Promise.all([collect(checks), collect(informational)]);
  return { at: now, blocking, informational: pending, blockerNames: Object.entries(blocking).filter(([, item]) => item.count > 0).map(([name]) => name) };
}

async function banglePreflight(designs) {
  const row = designs.find(item => item.id === BANGLE);
  if (!row) return { id: BANGLE, found: false };
  const productIds = (Array.isArray(row.product_ids) ? row.product_ids : []).slice(0, 3);
  const { data: products, error: productError } = productIds.length
    ? await db.from('products').select('id,title,image_url').in('id', productIds) : { data: [], error: null };
  if (productError) throw failure('Read Bangle selected products', productError);
  const bundle = row.artwork_handoff;
  const frozenRefs = Array.isArray(bundle?.refs) ? bundle.refs : [];
  const { data: refs, error: referenceError } = frozenRefs.length
    ? await db.from('design_refs').select('id,status,hidden,modified_at,drive_id').in('id', frozenRefs.map(ref => ref.id)) : { data: [], error: null };
  if (referenceError) throw failure('Read Bangle frozen references', referenceError);
  const { data: existing, error: generationError } = await db.from('artwork_generation_jobs').select('id,state,error_code,provider_request_id').eq('source', 'design').eq('item_id', BANGLE).eq('request_id', row.artwork_request_id || '00000000-0000-4000-8000-000000000000');
  if (generationError) throw failure('Read Bangle previous generation', generationError);
  const referenceChecks = frozenRefs.map(ref => {
    const current = refs.find(item => item.id === ref.id);
    return { id: ref.id, present: !!current, ready: current?.status === 'ready' && current?.hidden === false,
      versionMatches: !!current && current.modified_at === ref.modified_at, driveIdMatches: !!current && current.drive_id === ref.drive_id };
  });
  const productChecks = productIds.map(id => {
    const product = products.find(item => String(item.id) === String(id));
    let url;
    try { url = new URL(product?.image_url); } catch {}
    return { id: String(id), present: !!product, hasHttpsImage: url?.protocol === 'https:', imageHost: url?.hostname || null };
  });
  return {
    id: BANGLE, found: true, status: row.status, requestId: row.artwork_request_id, hasPreviousImage: !!row.image_path,
    selectedProductCount: productIds.length, products: productChecks,
    cachedBundlePresent: !!bundle, cachedRequestMatches: bundle?.packet?.requestId === row.artwork_request_id,
    cachedBundleSha256: bundle ? hash(bundle) : null, cachedPromptPresent: typeof bundle?.packet?.prompt === 'string' && bundle.packet.prompt.length > 0,
    frozenReferenceCount: frozenRefs.length, references: referenceChecks, previousHiggsfieldJobs: existing || [],
    knownHiggsfieldConflict: (existing || []).some(job => ['queued', 'submitting', 'submitted', 'collecting', 'uncertain', 'succeeded'].includes(job.state)),
    scope: 'Metadata read only. Actual reference bytes and requester permissions are rechecked by reserve/claim/dispatch/import before generation or save-back.',
  };
}

async function snapshot() {
  const [before, designs, creatives, reviews, active] = await Promise.all([
    systemState(), rows('designs'), rows('creatives'), rows('image_reviews', '*', ['source', 'item_id']), activity(),
  ]);
  const tableHash = (items, key) => ({ count: items.length, sha256: hash(items), rows: items.map(row => ({ key: key(row), sha256: hash(row),
    ...(Array.isArray(row.versions) ? { versionsSha256: hash(row.versions), versionCount: row.versions.length } : {}) })) });
  const after = await systemState();
  const data = { release: RELEASE, at: new Date().toISOString(), mode: 'snapshot', systemStateBefore: before, systemStateAfter: after,
    stablePauseState: sameState(before, after), consistentDatabaseSnapshot: false,
    note: 'Read-only paginated hashes; not one database transaction. Capture after pause+drain for release comparison.',
    protected: { designs: tableHash(designs, row => row.id), creatives: tableHash(creatives, row => row.id), imageReviews: tableHash(reviews, row => `${row.source}/${row.item_id}`) },
    activity: active, bangle: await banglePreflight(designs) };
  const path = await save(`${label}-${Date.now()}.json`, data, { exclusive: true });
  console.log(JSON.stringify({ mode, path, protected: Object.fromEntries(Object.entries(data.protected).map(([name, table]) => [name, { count: table.count, sha256: table.sha256 }])), systemState: after, blockers: active.blockerNames, bangle: data.bangle }, null, 2));
}

async function pause() {
  const prior = await systemState(), ownership = await readOwnership();
  if (ownership) {
    if (ownership.release !== RELEASE) throw new Error('The pause journal belongs to another release. No change made.');
    if (ownership.owned && sameState(prior, ownership.pausedState)) {
      console.log(JSON.stringify({ mode, changed: false, owned: true, reason: 'Already paused by this release.' })); return;
    }
    throw new Error('A prior pause journal exists but does not match the current owned pause. Review it before changing state.');
  }
  if (prior.paused) {
    await save('pause-ownership.json', { release: RELEASE, nonce: randomUUID(), phase: 'preexisting_pause', owned: false, prior, observedAt: new Date().toISOString() }, { exclusive: true });
    console.log(JSON.stringify({ mode, changed: false, owned: false, reason: 'AI Office was already paused. This release will not resume it.' })); return;
  }
  const expected = { id: 1, paused: true, paused_at: new Date().toISOString(), paused_by: null, reason: RELEASE };
  const journal = { release: RELEASE, nonce: randomUUID(), phase: 'pause_intent', owned: false, prior, pausedState: expected };
  await save('pause-ownership.json', journal, { exclusive: true });
  const { data, error } = await exactState(db.from('system_state').update({ paused: true, paused_at: expected.paused_at, paused_by: null, reason: RELEASE }), prior).select('id,paused,paused_at,paused_by,reason').maybeSingle();
  if (error) {
    const observed = await systemState().catch(() => null);
    if (!sameState(observed, expected)) throw failure('Pause outcome could not be confirmed; preserve ownership journal', error);
  } else if (!data || !sameState(data, expected)) throw new Error('Pause state changed concurrently. No ownership assumed; preserve the journal.');
  await save('pause-ownership.json', { ...journal, phase: 'paused', owned: true, confirmedAt: new Date().toISOString() });
  console.log(JSON.stringify({ mode, changed: true, owned: true, reason: RELEASE }));
}

async function drain() {
  const before = await systemState(), active = await activity(), after = await systemState();
  const safe = before.paused && after.paused && sameState(before, after) && active.blockerNames.length === 0;
  const report = { release: RELEASE, mode, at: new Date().toISOString(), safe, systemStateBefore: before, systemStateAfter: after, activity: active };
  const path = await save(`${label}-${Date.now()}.json`, report, { exclusive: true });
  console.log(JSON.stringify({ mode, safe, path, paused: after.paused, stablePauseState: sameState(before, after), activity: active }, null, 2));
  if (!safe) process.exitCode = 3;
}

async function resume() {
  const journal = await readOwnership();
  if (!journal || journal.release !== RELEASE) throw new Error('No matching release pause journal. Resume refused.');
  if (!journal.owned) {
    if (journal.phase === 'preexisting_pause') { console.log(JSON.stringify({ mode, changed: false, reason: 'The pause predates this release; left unchanged.' })); return; }
    throw new Error('Pause ownership is unconfirmed. Resume refused.');
  }
  if (journal.pausedState.reason !== RELEASE || journal.prior.paused !== false) throw new Error('Invalid pause ownership journal. Resume refused.');
  const current = await systemState();
  if (!sameState(current, journal.pausedState)) throw new Error('The pause was changed by someone else. Resume refused.');
  // Match the exact owned reason and timestamp, then restore only the original
  // state captured by this release. Never clear another operator's pause.
  const original = { paused: false, paused_at: journal.prior.paused_at, paused_by: journal.prior.paused_by, reason: journal.prior.reason };
  const { data, error } = await exactState(db.from('system_state').update(original), journal.pausedState).select('id,paused,paused_at,paused_by,reason').maybeSingle();
  if (error) {
    const observed = await systemState().catch(() => null);
    if (!sameState(observed, journal.prior)) throw failure('Resume outcome could not be confirmed; preserve ownership journal', error);
  } else if (!data || !sameState(data, journal.prior)) throw new Error('The owned pause changed concurrently. Resume refused.');
  await save('pause-ownership.json', { ...journal, phase: 'resumed', owned: false, resumedAt: new Date().toISOString() });
  console.log(JSON.stringify({ mode, changed: true, reason: 'Restored the exact pre-release unpaused state.' }));
}

try { await ({ snapshot, pause, drain, resume })[mode](); }
catch (error) { console.error(error instanceof Error ? error.message : 'Release audit failed without exposing request details.'); process.exitCode = 1; }
