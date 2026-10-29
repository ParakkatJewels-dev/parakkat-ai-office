import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { salesDayWindows, runSalesDays, odooDeadline, isMissingOdooModel, odooContinuationDue } from '../src/lib/connectors/odoo-core.mjs';

const today = '2026-10-26';
const result = { branchRows: [{ day: today, branch: 'Online', kind: 'online', orders: 1, revenue: 100 }], lineRows: [], coverage: 'sales orders only; POS module unavailable' };

test('sales split into bounded days and resume the saved pending day before repeating recent days', () => {
  const windows = salesDayWindows(today, { oldest: '2026-10-24', newest: today });
  assert.deepEqual(windows.slice(0, 4), ['24','25','26','23'].map(d => ({ from: '2026-10-'+d, to: '2026-10-'+d })));
  const pending = windows.slice(2);
  assert.deepEqual(salesDayWindows(today, { oldest: '2026-10-24', newest: today, pending }), pending);
  assert.ok(windows.every(w => w.from === w.to));
});

test('a provider deadline keeps previous totals and resumes after only the completed day', async () => {
  const commits = []; let reads = 0;
  const first = await runSalesDays({ today, deadline: 100_000, now: () => 0,
    read: async () => { if (++reads === 2) throw odooDeadline(); return result; },
    commit: async (window, data, state) => commits.push(structuredClone({ window, data, state })),
  });
  assert.equal(commits.length, 1); assert.equal(first.completedWindows, 1); assert.equal(first.more, true);
  assert.equal(first.state.pending[0].from, '2026-10-25');
  const secondReads = []; let clock = 0;
  await runSalesDays({ today, state: first.state, deadline: 100_000, now: () => clock,
    read: async w => { secondReads.push(w.from); return result; },
    commit: async () => { clock = 99_000; },
  });
  assert.deepEqual(secondReads, ['2026-10-25'], 'a continuation does not reread the committed day or the stock');
});

test('no remaining budget saves pending work without invoking providers or committing fabricated empty totals', async () => {
  const r = await runSalesDays({ today, deadline: 10_000, now: () => 0,
    read: async () => { throw new Error('must not read'); }, commit: async () => { throw new Error('must not commit'); },
  });
  assert.equal(r.completedWindows, 0); assert.equal(r.state.needs_continuation, true); assert.ok(r.pendingDays > 0);
});

test('API and commit failures do not advance the caller checkpoint', async () => {
  const state = { oldest: '2026-10-24', newest: today, pending: [{ from: today, to: today }] }, original = structuredClone(state);
  let commits = 0;
  await assert.rejects(runSalesDays({ today, state, deadline: 100_000, now: () => 0,
    read: async () => { throw new Error('permission denied'); }, commit: async () => { commits++; },
  }), /permission denied/);
  await assert.rejects(runSalesDays({ today, state, deadline: 100_000, now: () => 0,
    read: async () => result, commit: async () => { throw new Error('transaction rolled back'); },
  }), /rolled back/);
  assert.equal(commits, 0); assert.deepEqual(state, original);
});

test('only genuinely missing optional models are skipped, not authentication or transport failures', () => {
  assert.equal(isMissingOdooModel(new Error("Odoo: Object report.pos.order doesn't exist"), 'report.pos.order'), true);
  for (const message of ['Odoo: Access denied on report.pos.order', 'request timed out', "Object other.model doesn't exist"])
    assert.equal(isMissingOdooModel(new Error(message), 'report.pos.order'), false);
});

test('automatic continuations require pending work and wait two minutes after progress or an attempt', () => {
  const now = Date.parse('2026-10-26T09:10:00Z'), state = { needs_continuation: true };
  assert.equal(odooContinuationDue(state, '2026-10-26T09:07:00Z', 0, now), true);
  assert.equal(odooContinuationDue(state, '2026-10-26T09:09:00Z', 0, now), false);
  assert.equal(odooContinuationDue(state, '2026-10-26T09:07:00Z', now - 60_000, now), false);
  assert.equal(odooContinuationDue({}, '2026-10-26T09:07:00Z', 0, now), false);
});

let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table odoo_branch_daily(day date not null,branch text not null,kind text not null,orders integer not null,revenue numeric not null,primary key(day,branch));
    create table odoo_sales_daily(day date not null,branch text not null,sku text not null,product text,units numeric not null,revenue numeric not null,primary key(day,branch,sku));
    create table sync_cursors(name text primary key,state jsonb not null,updated_at timestamptz not null default now());`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261026000400_odoo_resumable_sync.sql', import.meta.url), 'utf8'));
});
const commitDay = (branches, sales, state) => db.query('select replace_odoo_sales_day($1,$2,$3,$4)', [today, branches, sales, state]);

test('day rows and checkpoint replace atomically, including legitimate zero-sales days', async () => {
  const state = { pending: [], newest: today, oldest: today, needs_continuation: false };
  await commitDay(result.branchRows, [{ day: today, branch: 'Online', sku: 'A', units: 1, revenue: 100 }], state);
  assert.equal((await db.query('select revenue from odoo_branch_daily')).rows[0].revenue, '100');
  assert.deepEqual((await db.query('select state from sync_cursors')).rows[0].state, state);
  await commitDay([], [], state);
  assert.equal((await db.query('select * from odoo_branch_daily')).rows.length, 0);
  assert.equal((await db.query('select * from odoo_sales_daily')).rows.length, 0);
});

test('an insert failure after deletion rolls back both good totals and the cursor', async () => {
  const old = { pending: [{ from: today, to: today }], newest: '2026-10-25' };
  await commitDay(result.branchRows, [{ day: today, branch: 'Online', sku: 'A', units: 1, revenue: 100 }], old);
  await assert.rejects(commitDay([{ ...result.branchRows[0], revenue: 999 }], [{ day: today, branch: 'Online', sku: null, units: 1, revenue: 999 }], { pending: [], newest: today }), /not-null/);
  assert.equal((await db.query('select revenue from odoo_branch_daily')).rows[0].revenue, '100');
  assert.equal((await db.query('select revenue from odoo_sales_daily')).rows[0].revenue, '100');
  assert.deepEqual((await db.query('select state from sync_cursors')).rows[0].state, old);
});

test('atomic replacement rejects out-of-day input and is unavailable to authenticated or anonymous users', async () => {
  await assert.rejects(commitDay([{ ...result.branchRows[0], day: '2026-10-25' }], [], { pending: [] }), /completed day/);
  const { rows: [r] } = await db.query(`select
    has_function_privilege('anon','replace_odoo_sales_day(date,jsonb,jsonb,jsonb)','execute') as anon,
    has_function_privilege('authenticated','replace_odoo_sales_day(date,jsonb,jsonb,jsonb)','execute') as authenticated,
    has_function_privilege('service_role','replace_odoo_sales_day(date,jsonb,jsonb,jsonb)','execute') as service`);
  assert.deepEqual(r, { anon: false, authenticated: false, service: true });
});
