import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignScenario } from '../src/lib/agents/forecast-core.mjs';

test('zero recorded return is preserved rather than reported as missing ad data', () => {
  const { impact } = campaignScenario({ spend: 1000, ad_revenue: 0, revenue: 2000, units: 10 }, null, 500, 7);
  assert.equal(impact.roas_basis, 0); assert.equal(impact.revenue_low, 0); assert.equal(impact.revenue_high, 0); assert.equal(impact.units, 0);
  assert.match(impact.basis, /0.0x/); assert.doesNotMatch(impact.basis, /No ad results synced/);
});

test('known ratios give arithmetic scenarios with explicit uncertainty and attribution limits', () => {
  const { impact } = campaignScenario({ spend: '1000', ad_revenue: '3000', revenue: '2000', units: '10' }, null, 500, 7);
  assert.equal(impact.roas_basis, 3); assert.equal(impact.revenue_low, 7875); assert.equal(impact.revenue_high, 13125); assert.equal(impact.units, 53);
  assert.match(impact.basis, /not a confidence interval/); assert.match(impact.basis, /Attribution may overlap/);
});

test('missing revenue and zero spend leave ratios unknown and zero sales do not fabricate unit estimates', () => {
  for (const report of [{ spend: 0, ad_revenue: 0 }, { spend: 200 }, { spend: null, ad_revenue: 100 }]) {
    const { impact } = campaignScenario(report, null, 500, 7);
    assert.equal(impact.roas_basis, null); assert.equal(impact.revenue_low, null); assert.equal(impact.units, null);
  }
  assert.equal(campaignScenario({ spend: 100, ad_revenue: 200, revenue: 0, units: 0 }, null, 500, 7).impact.units, null);
});

test('failed or absent dashboard reads stop the proposal instead of inventing zero totals', () => {
  assert.throws(() => campaignScenario(null, null, 500, 7), /Could not load/);
  assert.throws(() => campaignScenario({}, { message: 'private provider response' }, 500, 7), error => /Could not load/.test(error.message) && !error.message.includes('private'));
});
