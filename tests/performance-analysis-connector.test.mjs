import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/connectors/performance-analysis.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const connector = {};
new Function('exports', 'require', code)(connector, () => ({}));

const valid = () => ({
  observedAt: new Date().toISOString(), from: '2026-11-01', to: '2026-11-19', currency: 'INR',
  metrics: [{ name: 'Meta spend', value: 1000, unit: 'INR', source: 'Meta Ads', definition: 'Account spend' }],
  insights: [{ finding: 'Spend increased', source: 'Meta Ads daily report' }],
});

test('performance connector rejects ungrounded or malformed data', () => {
  assert.equal(connector.normalizePerformanceSnapshot(valid()).metrics.length, 1);
  assert.equal(connector.normalizePerformanceSnapshot({ ...valid(), metrics: [{ name: 'Sales', value: 10, unit: 'INR', source: '', definition: 'Revenue' }] }), null);
  assert.equal(connector.normalizePerformanceSnapshot({ ...valid(), from: '2026-11-30' }), null);
  assert.equal(connector.normalizePerformanceSnapshot({ ...valid(), from: '2026-02-31' }), null);
  assert.equal(connector.normalizePerformanceSnapshot({ ...valid(), currency: 'DOGE' }), null);
  assert.equal(connector.normalizePerformanceSnapshot({ ...valid(), metrics: [{ ...valid().metrics[0], value: Number.NaN }] }), null);
});

test('performance connector stays inactive without both secrets', async () => {
  const oldUrl = process.env.PERFORMANCE_ANALYSIS_URL, oldKey = process.env.PERFORMANCE_ANALYSIS_API_KEY;
  try {
    delete process.env.PERFORMANCE_ANALYSIS_URL;
    delete process.env.PERFORMANCE_ANALYSIS_API_KEY;
    assert.deepEqual(await connector.performanceEvidence(), { status: 'not_configured', brief: '' });
  } finally {
    if (oldUrl === undefined) delete process.env.PERFORMANCE_ANALYSIS_URL; else process.env.PERFORMANCE_ANALYSIS_URL = oldUrl;
    if (oldKey === undefined) delete process.env.PERFORMANCE_ANALYSIS_API_KEY; else process.env.PERFORMANCE_ANALYSIS_API_KEY = oldKey;
  }
});

test('performance connector uses only fresh HTTPS JSON evidence', async () => {
  const oldUrl = process.env.PERFORMANCE_ANALYSIS_URL, oldKey = process.env.PERFORMANCE_ANALYSIS_API_KEY, oldFetch = globalThis.fetch;
  try {
    process.env.PERFORMANCE_ANALYSIS_URL = 'https://reports.example.com/summary';
    process.env.PERFORMANCE_ANALYSIS_API_KEY = 'a-secure-test-token';
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.authorization, 'Bearer a-secure-test-token');
      return new Response(JSON.stringify(valid()), { headers: { 'content-type': 'application/json' } });
    };
    const fresh = await connector.performanceEvidence();
    assert.equal(fresh.status, 'fresh');
    assert.match(fresh.brief, /Meta spend: 1000 INR/);
    globalThis.fetch = async () => new Response(JSON.stringify({ ...valid(), observedAt: '2020-01-01T00:00:00Z' }), { headers: { 'content-type': 'application/json' } });
    const stale = await connector.performanceEvidence();
    assert.equal(stale.status, 'stale');
    assert.doesNotMatch(stale.brief, /1000/);
    process.env.PERFORMANCE_ANALYSIS_URL = 'http://127.0.0.1/summary';
    assert.equal((await connector.performanceEvidence()).status, 'unavailable');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.PERFORMANCE_ANALYSIS_URL; else process.env.PERFORMANCE_ANALYSIS_URL = oldUrl;
    if (oldKey === undefined) delete process.env.PERFORMANCE_ANALYSIS_API_KEY; else process.env.PERFORMANCE_ANALYSIS_API_KEY = oldKey;
  }
});
