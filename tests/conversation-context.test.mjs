import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationEvidenceKeys, compactConversationEvidence, conversationColleagues, compactConversationHistory, compactDiscussion, conversationRetryContext, needsConversationWorkHistory } from '../src/lib/agents/conversation-context.mjs';
import { normalizeConversationSales } from '../src/lib/agents/conversation-sales.mjs';
import { PEOPLE } from '../src/office/roster.mjs';

const observedAt = '2026-10-26T10:00:00.000Z';
const window = { from: '2026-10-20', to: '2026-10-26' };
const source = data => ({ available: true, coverage: 'Recorded sample; sync completeness is not verified.', observed_at: observedAt, data });
const roster = PEOPLE.filter(person => !person.human).map(person => ({ id: person.id, name: person.name, role_desc: person.role, department_id: person.dept, is_lead: !!person.head, enabled: true }));

function salesSource(count = 25) {
  return normalizeConversationSales({ data: Array.from({ length: count }, (_, i) => ({
    product_id: String(900000000000 + i), title: i === count - 1 ? 'Lotus Pendant' : `Recorded jewellery item ${i}`,
    product_type: 'Pendant', status: 'ACTIVE', price: 2300 + i, units: 50 - i, revenue: (50 - i) * (2300 + i),
    stock: i === 0 ? 0 : i === 1 ? null : i * 2, stock_source: i === 1 ? null : 'odoo',
    last_sale_day: window.to, product_updated_at: observedAt,
    window_units: 1740, window_product_count: 80, window_first_recorded_day: window.from, window_last_recorded_day: window.to,
  })) }, window, observedAt);
}

test('source selection retains evidence appropriate to the request and omits unrelated sources', () => {
  assert.deepEqual(conversationEvidenceKeys('What are you working on?'), ['sync']);
  assert.deepEqual(conversationEvidenceKeys('Hello, thanks'), ['sync']);
  assert.deepEqual(conversationEvidenceKeys('Research SEO keywords'), ['sync', 'search']);
  assert.deepEqual(conversationEvidenceKeys('Write a banner headline'), ['sync', 'products']);
  assert.deepEqual(conversationEvidenceKeys('Review our Instagram engagement'), ['sync', 'social']);
  assert.deepEqual(conversationEvidenceKeys('Compare competitor offers'), ['sync', 'competitors']);
  const forecast = conversationEvidenceKeys('Forecast stock demand');
  for (const key of ['products', 'productSales7d', 'productSales30d']) assert.ok(forecast.includes(key));
  for (const request of ['What sold last month?', 'Recommend replenishment']) {
    assert.ok(conversationEvidenceKeys(request).includes('productSales30d'), request);
  }
  assert.deepEqual(conversationEvidenceKeys('Top selling Ring products for a carousel'), ['sync', 'categorySales30d']);
  assert.deepEqual(conversationEvidenceKeys('സഹായിക്കാമോ'), ['sync', 'performance', 'products', 'productSales7d']);
});
test('agent work history is included for status requests, not unrelated sales-report or date-range tasks',()=>{
  for(const prompt of ['What are you working on?','What is your current status?','Show your latest report','Summarize your previous output','What needs attention?','status','Status update?','show my reports','List me your tasks'])assert.equal(needsConversationWorkHistory(prompt),true,prompt);
  for(const prompt of ['Prepare a sales report for last month','Forecast demand next month','Write banner copy','Review campaign performance'])assert.equal(needsConversationWorkHistory(prompt),false,prompt);
});
test('a short retry keeps the previous substantive request for focused evidence',()=>{
  const prior='Select five top-selling Ring products from Shopify and prepare a carousel brief.';
  const history=[{role:'user',content:prior},{role:'assistant',content:'The sample was incomplete.'},{role:'user',content:'whats the status?'},{role:'assistant',content:'Blocked.'},{role:'user',content:'try again'}];
  assert.equal(conversationRetryContext('try again',history),prior);
  assert.equal(conversationEvidenceKeys(`${conversationRetryContext('try again',history)}\nFollow-up: try again`)[1],'categorySales30d');
  assert.equal(conversationRetryContext('Write a different campaign',history),null);
});
test('direct specialist inputs omit only the duplicated handoff and preserve meeting/final discussion',()=>{
  const assignment='Check the recorded stock for product 42.',earlier={agentId:'sales',content:'Recorded stock is unknown.'},handoff={agentId:'cmo',content:assignment},items=[earlier,handoff];
  const before=structuredClone(items);
  assert.deepEqual(compactDiscussion(items,{phase:'specialist',meetingRequested:false,assignment}),[earlier]);
  assert.deepEqual(compactDiscussion(items,{phase:'specialist',meetingRequested:true,assignment}),items);
  assert.deepEqual(compactDiscussion(items,{phase:'final',meetingRequested:false,assignment}),items);
  assert.deepEqual(compactDiscussion(items,{phase:'specialist',meetingRequested:false,assignment:'Different task'}),items);
  assert.deepEqual(items,before);
});

test('compaction preserves unknown stock, recorded zero, full-source totals, timestamps and coverage', () => {
  const sales = salesSource();
  const input = { sync: source([]), productSales7d: sales, products: source([]) };
  const before = structuredClone(input);
  const result = compactConversationEvidence(input, 'Review stock and sales');
  const compacted = result.productSales7d;
  assert.equal(compacted.data[0].stock, 0);
  assert.equal(compacted.data[0].stock_source, 'odoo');
  assert.equal(compacted.data[1].stock, null);
  assert.equal(compacted.data[1].stock_source, null);
  assert.deepEqual(compacted.summary, sales.summary);
  assert.equal(compacted.summary.units_all_recorded_products, 1740);
  assert.notEqual(compacted.summary.units_all_recorded_products, compacted.data.reduce((sum, row) => sum + row.units, 0));
  assert.deepEqual(compacted.coverage, sales.coverage);
  assert.equal(compacted.observed_at, observedAt);
  assert.match(compacted.coverage.stock_note, /Null means unknown; an explicit 0 is recorded zero/);
  assert.equal(compacted.sample.shown, 8);
  assert.equal(compacted.sample.truncated, true);
  assert.match(compacted.sample.note, /unknown, not zero/);
  assert.deepEqual(result.products.data, []);
  assert.deepEqual(input, before, 'selecting context must not modify the recorded evidence');
});

test('an unavailable source, an available empty source, and an omitted source remain distinct', () => {
  const empty = normalizeConversationSales({ data: [] }, window, observedAt);
  const missing = normalizeConversationSales({ error: true }, window, observedAt);
  const result = compactConversationEvidence({ productSales7d: empty, productSales30d: missing, social: source([]) }, 'Forecast demand');
  assert.equal(result.productSales7d.available, true);
  assert.equal(result.productSales7d.state, 'no_recorded_rows');
  assert.equal(result.productSales7d.summary.units_all_recorded_products, null);
  assert.equal(result.productSales30d.available, false);
  assert.equal(result.productSales30d.state, 'unavailable');
  assert.equal(Object.hasOwn(result, 'social'), false);
  assert.match(result.contextCoverage, /Only task-relevant recorded sources/);
});

test('requested products are retained without misrepresenting the source sales ordering', () => {
  const sales = salesSource();
  const result = compactConversationEvidence({ productSales7d: sales }, 'Check Lotus Pendant stock');
  assert.equal(result.productSales7d.data[0].title, 'Lotus Pendant');
  assert.ok(result.productSales7d.data[0].units < result.productSales7d.data[1].units);
  assert.equal(result.productSales7d.sample.sourceOrder, sales.sample.order);
  assert.equal(result.productSales7d.sample.order, 'Request relevance, then original source order');
  const byId = compactConversationEvidence({ productSales7d: sales }, `Check product ${sales.data.at(-1).product_id}`);
  assert.equal(byId.productSales7d.data[0].product_id, sales.data.at(-1).product_id);
});

test('focused category evidence keeps its exact sales ranking and image URLs', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ product_id: String(i + 1), title: `Ring ${i + 1}`, units: 12 - i, image_url: `https://cdn.shopify.com/${i + 1}.jpg` }));
  const ranked = { ...source(rows), sample: { order: 'Category sales ranking', truncated: true, top_rank_complete: true, note: 'Top ranks are exact.' } };
  const result = compactConversationEvidence({ categorySales30d: ranked }, 'Top selling Ring products for a carousel', 'final').categorySales30d;
  assert.equal(result.data.length, 10);
  assert.deepEqual(result.data.map(x => x.product_id), Array.from({ length: 10 }, (_, i) => String(i + 1)));
  assert.equal(result.data[0].image_url, 'https://cdn.shopify.com/1.jpg');
  assert.equal(result.sample.top_rank_complete, true);
  assert.equal(result.sample.order, 'Category sales ranking');
});

test('source rows and strings stay bounded, with tighter final-response evidence and truthful truncation', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: String(i), title: `Item ${i}`, description: 'x'.repeat(2000), tags: Array(20).fill('tag') }));
  const input = { products: { ...source(rows), sample: { truncated: true } } };
  for (const [phase, count] of [['plan', 8], ['specialist', 5], ['final', 5]]) {
    const result = compactConversationEvidence(input, 'Choose a product', phase).products;
    assert.equal(result.data.length, count);
    assert.ok(result.data.every(row => row.description.length === 650 && row.tags.length === 8));
    assert.equal(result.sample.truncated, true);
    assert.equal(result.sample.limit, count);
  }
  const small = compactConversationEvidence({ products: { ...source(rows.slice(0, 2)), sample: { truncated: true } } }, 'product');
  assert.equal(small.products.sample.truncated, true, 'upstream sampling must stay disclosed even below the new limit');
});

test('generic creative tasks receive a small product sample while named products retain full evidence', () => {
  const rows=Array.from({length:12},(_,i)=>({id:String(i),title:i===9?'Lotus Ring':`Ring ${i}`,description:'x'.repeat(500)}));
  const shared={products:source(rows)};
  const generic=compactConversationEvidence(shared,'Write a banner headline').products;
  assert.equal(generic.data.length,3);
  assert.equal(generic.sample.truncated,true);
  const named=compactConversationEvidence(shared,'Write a banner headline for Lotus Ring').products;
  assert.equal(named.data.length,8);
  assert.equal(named.data[0].title,'Lotus Ring');
});

test('planning, specialist and final turns retain recent requirements and drafts within the history budget', () => {
  const history=Array.from({length:6},(_,i)=>({role:i%2?'assistant':'user',content:`Turn ${i}: `+'x'.repeat(1200)}));
  for(const phase of ['plan','specialist','final']) {
    const result=compactConversationHistory(history,'New request',phase);
    assert.deepEqual(result.map(m=>m.content),history.slice(-4).map(m=>m.content));
    assert.ok(result.reduce((sum,m)=>sum+m.content.length,0)<=10000);
  }
});

test('history excludes the latest prompt before shortening, including requests longer than the old 1,800-character cap', () => {
  const prompt = 'Review these requirements: ' + 'specific requirement '.repeat(250);
  assert.ok(prompt.length > 1800 && prompt.length < 6000);
  const history = [
    { role: 'user', content: 'Earlier request', agent_id: null },
    { role: 'assistant', content: 'Earlier answer', agent_id: 'host' },
    { role: 'user', content: prompt, agent_id: null },
  ];
  const before = structuredClone(history);
  const payload = { request: prompt, privateConversation: compactConversationHistory(history, prompt) };
  assert.deepEqual(payload.privateConversation, history.slice(0, 2));
  assert.equal(JSON.stringify(payload).split('Review these requirements: ').length - 1, 1);
  assert.deepEqual(history, before);
  const sameWords = compactConversationHistory([{ role: 'assistant', content: 'Exact words', agent_id: 'host' }, { role: 'user', content: 'Exact words', agent_id: null }], 'Exact words');
  assert.equal(sameWords.length, 1);
  assert.equal(sameWords[0].role, 'assistant', 'only the repeated user request is excluded');
});

test('history and completed discussion keep recent bounded messages without fabricating turns', () => {
  const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', agent_id: `agent-${i}`, content: `${i}:` + 'x'.repeat(2000) }));
  const result = compactConversationHistory(history, 'A new request');
  assert.deepEqual(result.map(row => row.agent_id), ['agent-8', 'agent-9', 'agent-10', 'agent-11']);
  assert.deepEqual(result.map(row=>row.content),history.slice(-4).map(row=>row.content));
  const discussion = history.map(row => ({ agentId: row.agent_id, content: row.content }));
  const compacted = compactDiscussion(discussion);
  assert.deepEqual(compacted.map(row => row.agentId), ['agent-8', 'agent-9', 'agent-10', 'agent-11']);
  assert.deepEqual(compacted.map(row=>row.content),history.slice(-4).map(row=>row.content));
  assert.deepEqual(compactDiscussion([]), []);
  assert.deepEqual(compactConversationHistory(undefined, 'New request'), []);
});

test('same-task specialist work retains final caveats and requested deliverables for the host',()=>{
  const content='Detailed campaign draft. '+ 'Evidence and copy. '.repeat(250)+'\nFINAL QUALIFICATION: Product stock is unverified; do not claim availability.';
  assert.ok(content.length>1800&&content.length<6000);
  const discussion=[{agentId:'copywriter',content}];
  for(const phase of ['specialist','final'])assert.equal(compactDiscussion(discussion,{phase})[0].content,content);
});

test('edit follow-ups retain the substantive brief, intervening constraints and original evidence scope',()=>{
  const brief='Write three Instagram captions for product Lotus 42 using recorded product sales. Do not invent a discount.';
  const history=[{role:'user',content:brief},{role:'assistant',content:'Draft captions.'},{role:'user',content:'Keep it in Malayalam.'},{role:'assistant',content:'Malayalam draft.'},{role:'user',content:'What is the status?'},{role:'assistant',content:'Ready for review.'}];
  const scope=conversationRetryContext('Make it more premium.',history);
  assert.match(scope,/Lotus 42/);assert.match(scope,/Do not invent a discount/);assert.match(scope,/Malayalam/);assert.doesNotMatch(scope,/What is the status/);
  const selected=compactConversationHistory(history,'Make it more premium.','specialist');
  assert.equal(selected[0].content,brief,'root requirements survive several follow-up exchanges');
  assert.ok(conversationEvidenceKeys(`${scope}\nMake it more premium.`).includes('productSales7d'));
  assert.equal(conversationRetryContext('Prepare a new SEO report.',history),null);
});

test('every visible intermediate revision requirement survives more than two exchanges',()=>{
  const history=[{role:'user',content:'Write three social captions for product Lotus 42.'},{role:'assistant',content:'Initial draft.'},
    {role:'user',content:'Keep it in Malayalam and do not invent discounts.'},{role:'assistant',content:'Malayalam version.'},
    {role:'user',content:'Make it sound suitable for wedding gifting.'},{role:'assistant',content:'Wedding version.'},
    {role:'user',content:'Keep it under fifty words per caption.'},{role:'assistant',content:'Short version.'}];
  const selected=compactConversationHistory(history,'Make it more premium.','specialist');
  assert.deepEqual(selected.filter(m=>m.role==='user').map(m=>m.content),history.filter(m=>m.role==='user').map(m=>m.content));
  assert.match(conversationRetryContext('Make it more premium.',history),/do not invent discounts/);
});

test('long earlier messages disclose omissions and preserve both opening requirements and final qualifications',()=>{
  const first='OPENING REQUIREMENT: use verified products. '+ 'source detail '.repeat(600)+' FINAL REQUIREMENT: no invented discounts.';
  const draft='DRAFT START '+ 'copy detail '.repeat(700)+' FINAL CAVEAT: source period is incomplete.';
  const history=[{role:'user',content:first},{role:'assistant',content:draft}];
  const result=compactConversationHistory(history,'Make it more premium.');
  assert.ok(result.reduce((sum,m)=>sum+m.content.length,0)<=10000);
  assert.match(result[0].content,/OPENING REQUIREMENT/);assert.match(result[0].content,/FINAL REQUIREMENT/);
  assert.match(result[1].content,/DRAFT START/);assert.match(result[1].content,/FINAL CAVEAT/);
  assert.ok(result.every(m=>m.contextOmission?.omittedChars>0));
  assert.ok(result.every(m=>m.content.includes('[Middle omitted')));
});

test('colleague suggestions rank relevant actual agents and remain within the supplied requester scope', () => {
  const colleagues = conversationColleagues(roster, 'Ask Copywriter and Banner Designer for headline options and banners', 'creativeDirector');
  assert.equal(colleagues.length, 10);
  assert.equal(colleagues[0].agentId, 'designer');
  assert.ok(colleagues.slice(0, 3).some(row => row.agentId === 'copywriter'), 'the named copywriter is among the most relevant choices');
  assert.ok(!colleagues.some(row => row.agentId === 'creativeDirector'));
  assert.ok(colleagues.every(row => roster.some(agent => agent.id === row.agentId)));
  assert.ok(colleagues.every(row => row.role.length <= 120));
  const scoped = roster.filter(agent => agent.department_id === 'creative');
  const scopedResult = conversationColleagues(scoped, 'Ask a Sales Analyst or Copywriter', 'creativeDirector');
  assert.ok(scopedResult.every(row => row.department === 'creative'));
  assert.equal(scopedResult[0].agentId, 'copywriter');
  assert.deepEqual(conversationColleagues(scoped.slice(0, 1), 'Please help', scoped[0].id), []);
  const longRole = conversationColleagues([{ id: 'colleague', name: 'Colleague', role_desc: 'r'.repeat(1000), department_id: 'creative' }], 'help', 'host');
  assert.equal(longRole[0].role.length, 120);
});

test('a large realistic fixture records bounded JSON-payload savings without claiming measured model tokens', t => {
  const sales = salesSource();
  const shared = {
    brand: source({ voice: 'Brand voice. '.repeat(130), always: ['Warm and factual'], never: ['Invent offers'], notes: 'Brand notes. '.repeat(140) }),
    performance: source({ units: 174, revenue: 580000, spend: 20000, roas: 4.1 }),
    products: source(sales.data.map(row => ({ id: row.product_id, title: row.title, product_type: row.product_type, price: row.price, stock: row.stock, stock_source: row.stock_source, product_updated_at: observedAt }))),
    campaigns: source(Array.from({ length: 6 }, (_, i) => ({ id: `campaign-${i}`, name: `Campaign ${i}`, occasion: 'Festive collection', status: 'draft', budget_daily: 1000, start_date: window.from, end_date: window.to }))),
    social: source(Array.from({ length: 8 }, (_, i) => ({ platform: 'instagram', caption: `Caption ${i}: ` + 'Collection story. '.repeat(90), posted_at: observedAt, reach: 1000, likes: 70, saves: 20, comments: 6, shares: 12 }))),
    search: source(Array.from({ length: 12 }, (_, i) => ({ keyword: `Jewellery keyword ${i}`, avg_monthly_searches: 1000, competition: 'medium', trend_interest: 80, trend_change: 0.2, updated_at: observedAt }))),
    competitors: source(Array.from({ length: 6 }, (_, i) => ({ kind: 'collection', summary: `Observation ${i}: ` + 'Recorded competitor collection detail. '.repeat(40), source_url: `https://example.test/${i}`, seen_at: observedAt }))),
    sync: source(['shopify', 'odoo', 'meta', 'google'].map(provider => ({ provider, status: 'connected', last_synced_at: observedAt }))),
    productSales7d: sales,
    productSales30d: { ...structuredClone(sales), coverage: { ...sales.coverage, date_from_inclusive: '2026-09-27' } },
  };
  const prompt = 'Forecast demand for Lotus Pendant and review its stock';
  const history = Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', agent_id: 'forecaster', content: `Previous turn ${i}: ` + 'recorded discussion '.repeat(80) }));
  history.push({ role: 'user', agent_id: null, content: prompt });
  // Comparison is only the JSON evidence/history/roster payload. Shared system instructions and
  // provider tokenization are not included, so this is not a measured token or account-quota saving.
  const before = { request: prompt, sharedEvidence: shared, privateConversation: history, availableColleagues: roster.filter(agent => agent.id !== 'forecaster').map(agent => ({ agentId: agent.id, name: agent.name, role: agent.role_desc, department: agent.department_id })) };
  const after = { request: prompt, sharedEvidence: compactConversationEvidence(shared, prompt), privateConversation: compactConversationHistory(history.slice(-4), prompt), availableColleagues: conversationColleagues(roster, prompt, 'forecaster') };
  const beforeBytes = Buffer.byteLength(JSON.stringify(before));
  const afterBytes = Buffer.byteLength(JSON.stringify(after));
  const reduction = 1 - afterBytes / beforeBytes;
  t.diagnostic(`Fixture JSON payload: ${beforeBytes.toLocaleString('en-US')} → ${afterBytes.toLocaleString('en-US')} UTF-8 bytes (${(reduction * 100).toFixed(1)}% smaller); model tokens were not measured.`);
  assert.ok(beforeBytes > 60_000, 'fixture must exercise a materially large previous payload');
  assert.ok(afterBytes < 18_000, 'bounded selected context stays below the fixture payload ceiling');
  assert.ok(reduction > 0.7, 'fixture must reduce serialized payload size by more than 70%');
  assert.equal(after.sharedEvidence.productSales7d.data[0].title, 'Lotus Pendant');
  assert.equal(after.sharedEvidence.productSales30d.data[0].title, 'Lotus Pendant');
  assert.deepEqual(after.sharedEvidence.productSales7d.summary, sales.summary);
  assert.equal(after.privateConversation.length, 3);
  assert.equal(after.availableColleagues.length, 10);
});
