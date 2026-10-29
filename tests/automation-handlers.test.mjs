import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedWindows, odooWindowComplete, missingDays, dataQualityFindings, inventoryPlan, catalogueIssues, validatedCatalogueDrafts, validatedReply, validatedFollowUp, aggregateAds } from '../src/lib/automation/handler-core.mjs';

const window = { from: '2026-09-26', to: '2026-10-25', days: 30 };
const rules = { reviewDays: 7, locations: [{ branch: 'A', warehouse: 'WA', leadDays: 3, minStock: 5 }, { branch: 'B', warehouse: 'WB', leadDays: 3, minStock: 5 }] };
const sale = (branch, units, sku = 'SKU1') => ({ sku, branch, units, product: 'Test product', day: '2026-10-01' });
const holding = (warehouse, qty, reserved = 0, sku = 'SKU1') => ({ sku, warehouse, qty, reserved });
const plan = overrides => inventoryPlan({ sales: [sale('A', 60), sale('B', 30)], stock: [holding('WA', 3, 1), holding('WB', 40, 5)], rules, window, salesComplete: true, stockComplete: true, stockFresh: true, ...overrides });

test('completed-date windows distinguish IST midnight from the still-open UTC day', () => {
  const windows = closedWindows(new Date('2026-10-25T20:00:00Z'));
  assert.equal(windows.shopify.to, '2026-10-24');
  assert.equal(windows.odoo.to, '2026-10-25');
  assert.equal(windows.odooMonth.from, '2026-09-26');
  assert.equal(windows.ads.to, '2026-10-24');
});

test('sales cursor completeness rejects unknown, short, and pending windows', () => {
  assert.equal(odooWindowComplete(null, window), false);
  assert.equal(odooWindowComplete({ oldest: '2026-10-01', newest: window.to }, window), false);
  assert.equal(odooWindowComplete({ oldest: window.from, newest: window.to, pending: [{ from: '2026-10-01', to: '2026-10-02' }] }, window), false);
  assert.equal(odooWindowComplete({ oldest: window.from, newest: window.to, pending: [{ from: '2026-09-25', to: window.from }] }, window), true);
  assert.equal(odooWindowComplete({ oldest: window.from, newest: window.to }, window), true);
});

test('missing sales days are reported rather than silently filled with zero', () => {
  assert.deepEqual(missingDays([['2026-10-20', 15], ['2026-10-22', 0]], { from: '2026-10-20', to: '2026-10-22' }), ['2026-10-21']);
  const findings = dataQualityFindings({ products: [], connections: [], cursors: [] });
  assert.ok(findings.some(row => row.code === 'odoo:coverage' && row.severity === 'unknown'));
  assert.ok(findings.some(row => row.code === 'products:empty' && /does not establish/.test(row.detail)));
  assert.ok(findings.some(row => row.code === 'connection:shopify' && row.severity === 'unknown'));
});

test('quality review distinguishes discovery, study queue, failure and unsupported POS coverage', () => {
  const findings = dataQualityFindings({
    expectedProviders: [], products: [{ skus: ['SKU'], odoo_stock: null }],
    cursors: [{ name: 'odoo_sales', state: { oldest: '2026-09-01', newest: '2026-10-25', coverage: 'sales orders only; POS module unavailable' } }],
    folders: [{ page_token: 'next' }, { scanned_at: '2026-10-25', error: 'read failed' }], libraryCounts: { new: 10, ready: 5, failed: 2 },
  });
  for (const code of ['library:discovery', 'library:study_queue', 'library:study_failed', 'library:folder_errors', 'odoo:models', 'products:stock_match']) assert.ok(findings.some(row => row.code === code), code);
  assert.match(findings.find(row => row.code === 'products:stock_match').detail, /unknown, not zero/);
});

test('inventory subtracts reservations and protects donor minimum/demand cover', () => {
  const report = plan();
  const proposal = report.proposals.find(row => row.branch === 'A');
  assert.equal(proposal.available, 2);
  assert.equal(proposal.target, 20);
  assert.equal(proposal.needed, 18);
  assert.deepEqual(proposal.transfers.map(row => [row.warehouse, row.quantity]), [['WB', 18]]);
  assert.equal(proposal.reorder, 0);
});

test('unknown stock rows are never interpreted as zero and do not produce purchase quantities', () => {
  const report = plan({ stock: [holding('WB', 40)] });
  assert.equal(report.risks.find(row => row.branch === 'A').available, null);
  assert.equal(report.proposals.some(row => row.branch === 'A'), false);
});

test('incomplete sales, bounded stock and stale stock each withhold quantities and days-cover estimates', () => {
  for (const patch of [{ salesComplete: false }, { stockComplete: false }, { stockFresh: false }]) {
    const report = plan(patch);
    assert.equal(report.proposals.length, 0);
    assert.ok(report.risks.every(row => row.daysCover === null));
    assert.ok(report.warnings.length > 0);
  }
});

test('unconfigured or ambiguous branch mappings withhold quantities but show recorded network stock', () => {
  const missing = plan({ rules: {} });
  assert.equal(missing.proposals.length, 0);
  assert.equal(missing.risks[0].allWarehouseFree, 37);
  const ambiguous = plan({ rules: { locations: [...rules.locations, { branch: 'C', warehouse: 'WB', leadDays: 2, minStock: 2 }] } });
  assert.equal(ambiguous.proposals.length, 0);
  assert.ok(ambiguous.warnings.some(text => text.includes('ambiguous')));
});

test('a donor without recorded demand is not assumed to have zero demand', () => {
  const report = plan({ sales: [sale('A', 60)] });
  assert.equal(report.proposals[0].transfers.length, 0);
  assert.equal(report.proposals[0].reorder, 18);
});

test('the same donor surplus cannot be allocated twice across destination proposals', () => {
  const report = plan({
    rules: { reviewDays: 7, locations: [...rules.locations, { branch: 'C', warehouse: 'WC', leadDays: 3, minStock: 5 }] },
    sales: [sale('A', 60), sale('C', 60), sale('B', 30)],
    stock: [holding('WA', 0), holding('WC', 0), holding('WB', 25)],
  });
  const transferred = report.proposals.flatMap(row => row.transfers).filter(row => row.warehouse === 'WB').reduce((total, row) => total + row.quantity, 0);
  assert.equal(transferred, 15);
});

test('catalogue checks only stored fields and treats an explicit zero stock differently from no match', () => {
  const issues = catalogueIssues([{ id: 1, title: 'Ring', image_url: 'image', price: 500, product_type: 'Ring', skus: ['A'], odoo_stock: 0 }]);
  assert.equal(issues.length, 0);
});

test('catalogue drafts preserve exact approved product identities and source version, discarding injected actions', () => {
  const base = { productId: '12', title: 'New title', description: 'Description', seoTitle: 'SEO', seoDescription: 'Short description', action: 'delete_every_product', sourceUpdatedAt: 'spoofed', originalTitle: 'spoofed' };
  const drafts = validatedCatalogueDrafts({ drafts: [base, base, { ...base, productId: '999' }], actions: [{ kind: 'send_money' }] }, [{ id: 12, title: 'Original', updated_at: '2026-10-25T10:00:00Z' }]);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].productId, '12');
  assert.equal(drafts[0].originalTitle, 'Original');
  assert.equal(drafts[0].sourceUpdatedAt, '2026-10-25T10:00:00Z');
  assert.equal(Object.hasOwn(drafts[0], 'action'), false);
  assert.equal(Object.hasOwn(drafts[0], 'actions'), false);
});

test('catalogue drafts are bounded and incomplete model output is rejected', () => {
  const products = Array.from({ length: 5 }, (_, id) => ({ id, title: 'Original' }));
  const drafts = validatedCatalogueDrafts({ drafts: products.map(row => ({ productId: String(row.id), title: 'x'.repeat(500), description: 'd'.repeat(6000), seoTitle: 's'.repeat(120), seoDescription: 'm'.repeat(300) })) }, products);
  assert.equal(drafts.length, 3);
  assert.deepEqual([drafts[0].title.length, drafts[0].description.length, drafts[0].seoTitle.length, drafts[0].seoDescription.length], [180, 4000, 70, 160]);
  assert.deepEqual(validatedCatalogueDrafts({ drafts: [{ productId: '0', title: 'Only title' }] }, products), []);
});

test('customer model output cannot set a recipient, sending permission or executable action', () => {
  const draft = validatedReply({ reply: 'Please share the product link.', recipient: 'attacker', send: true, action: 'send_message', category: 'delete_account', questions: ['Product link?'] });
  assert.equal(draft.category, 'other');
  assert.equal(draft.needsHuman, true);
  assert.equal(Object.hasOwn(draft, 'recipient'), false);
  assert.equal(Object.hasOwn(draft, 'send'), false);
  assert.throws(() => validatedReply({ reply: '' }), /did not contain/);
});

test('order, appointment and availability replies always retain a human verification step', () => {
  for (const category of ['order', 'appointment', 'availability', 'complaint']) assert.equal(validatedReply({ reply: 'A draft.', category, needsHuman: false }).needsHuman, true);
});

test('Instagram reply length is measured in UTF-8 bytes and never silently cut to fit', () => {
  assert.equal(validatedReply({ reply: 'a'.repeat(1000) }, 'instagram').reply.length, 1000);
  assert.throws(() => validatedReply({ reply: 'a'.repeat(1001) }, 'instagram'), error => error.code === 'reply_too_long');
  assert.throws(() => validatedReply({ reply: 'മ'.repeat(334) }, 'instagram'), error => error.code === 'reply_too_long');
  assert.equal(validatedReply({ reply: 'മ'.repeat(334) }, 'manual').reply.length, 334);
});

test('assigned follow-up returns a bounded actual deliverable without model-selected execution actions', () => {
  const output = validatedFollowUp({ summary: 'Copy drafted.', markdown: 'The actual requested copy.', blocked: false, missing: [], actions: [{ kind: 'send_message' }], recipient: 'forged' });
  assert.equal(output.markdown, 'The actual requested copy.');
  assert.equal(output.blocked, false);
  assert.equal(Object.hasOwn(output, 'actions'), false);
  assert.equal(Object.hasOwn(output, 'recipient'), false);
  assert.throws(() => validatedFollowUp({ summary: 'Done', blocked: false }), /complete deliverable/);
});

test('blocked follow-ups always retain explicit unresolved requirements', () => {
  const output = validatedFollowUp({ summary: 'Draft ready; sending unavailable.', markdown: 'Prepared message.', blocked: true, missing: [] });
  assert.equal(output.blocked, true);
  assert.equal(output.missing.length, 1);
  const malformed = validatedFollowUp({ summary: 'x'.repeat(2000), markdown: 'x'.repeat(20000), blocked: false, missing: [null, 12, ' ', 'A required fact.'] });
  assert.equal(malformed.summary.length, 800);
  assert.equal(malformed.markdown.length, 16000);
  assert.deepEqual(malformed.missing, ['A required fact.']);
});

test('ad aggregation keeps account and platform attribution separate', () => {
  const rows = aggregateAds([
    { platform: 'meta', account_id: 'A', ad_id: '1', spend: 100, revenue: 40, conversion_definition:'purchase' },
    { platform: 'meta', account_id: 'A', ad_id: '1', spend: 100, revenue: 60, conversion_definition:'purchase' },
    { platform: 'meta', account_id: 'B', ad_id: '1', spend: 50, revenue: 200, conversion_definition:'purchase' },
    { platform: 'google', account_id: 'A', ad_id: '1', spend: 0, revenue: 20, conversion_definition:'purchase' },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.platform === 'meta' && row.accountId === 'A').roas, 0.5);
  assert.equal(rows.find(row => row.platform === 'google').roas, null);
});

test('ad aggregation does not convert missing or legacy purchase evidence to a zero return',()=>{
  const rows=aggregateAds([{platform:'meta',account_id:'A',campaign_id:'1',ad_id:'2',spend:100,revenue:null,purchases:null,conversion_definition:'unknown'}]);
  assert.equal(rows[0].revenue,null);assert.equal(rows[0].purchases,null);assert.equal(rows[0].roas,null);
});
