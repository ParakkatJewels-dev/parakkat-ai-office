import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDeterministicConversation, deterministicPreferencesSupported, deterministicStatusAnswer, deterministicMetricsAnswer } from '../src/lib/agents/conversation-deterministic.mjs';

const now = new Date('2026-10-27T04:30:00Z');
const match = prompt => matchDeterministicConversation(prompt, { now });
const emptyRuntime = { instructions:'', context:{brand:{voice:'Warm and factual'},lessons:[]} };

test('exact self-status requests route without inference, while ambiguous tasks and meetings do not',()=>{
  for (const prompt of ['Status?','Your current work status','What are you working on?','Are you busy right now?','Give me your progress','Please show your status.']) assert.deepEqual(match(prompt),{kind:'status'},prompt);
  for (const prompt of ['What is the campaign status?','What is her status?','Check the status and plan our ads','Why are you not working?','What are you working on and what should change?','Give me the report','continue','Are sales good?','Show revenue','Show profits last month']) assert.equal(match(prompt),null,prompt);
  assert.equal(matchDeterministicConversation('Status',{meetingRequested:true,now}),null);
});

test('numeric requests require a recognized source/metric and explicit supported window',()=>{
  assert.deepEqual(match('Show Shopify revenue for the last 7 days'),{kind:'metrics',metric:'shopify_revenue',window:{from:'2026-10-21',to:'2026-10-27'}});
  assert.deepEqual(match('What was ad ROAS for 2026-10-01 to 2026-10-26 UTC?'),{kind:'metrics',metric:'ad_roas',window:{from:'2026-10-01',to:'2026-10-26'}});
  for (const prompt of ['Show Shopify revenue today','Show revenue for last 7 days','Show Shopify revenue for last week','Show Shopify revenue for 2026-10-01 to 2026-10-26','Show Shopify revenue for 2026-02-30 to 2026-03-01 UTC','Ad spend 2026-10-28 to 2026-10-29 UTC','Show ad spend for last 7 days and recommend changes','Show Meta ad spend for last 7 days']) assert.equal(match(prompt),null,prompt);
});

test('saved instructions and response preferences retain the model path',()=>{
  assert.equal(deterministicPreferencesSupported(emptyRuntime),true);
  for (const instructions of ['Answer in Malayalam.','Use detailed English explanations.','Check the current plan first.']) assert.equal(deterministicPreferencesSupported({...emptyRuntime,instructions}),false);
  assert.equal(deterministicPreferencesSupported({...emptyRuntime,context:{brand:{notes:'Reply in Malayalam.'}}}),false);
  assert.equal(deterministicPreferencesSupported({...emptyRuntime,context:{lessons:[{source:'manual',lesson:'Write the answer as a table.'}]}}),false);
  assert.equal(deterministicPreferencesSupported(null),false);
});

test('historical activity cannot become working-now status and missing visibility does not imply no work',()=>{
  const input={hostName:'Sales',observedAt:now.toISOString(),live:{available:true},activity:{available:true,data:[{at:'2026-10-26T12:00:00Z',text:'Reviewing sales'}]},reports:{available:true,data:[]}};
  const text=deterministicStatusAnswer(input);
  assert.match(text,/No other live work is registered/);assert.match(text,/historical record, not proof it is still running/);assert.doesNotMatch(text,/Working now:/);
  assert.match(deterministicStatusAnswer({...input,activity:{available:true,data:[]}}),/does not prove there has been no work/);
  assert.match(deterministicStatusAnswer({...input,live:{available:false}}),/current activity is unknown/);
  assert.doesNotMatch(deterministicStatusAnswer({...input,live:{available:true,work:{state:'working',label:'Old work',startedAt:'2026-10-26T10:00:00Z',expiresAt:'2026-10-26T10:01:00Z'}}}),/Working now:/);
});

test('live work is reported using the registry label, with recorded reports separately identified',()=>{
  const text=deterministicStatusAnswer({hostName:'Sales',observedAt:now.toISOString(),live:{available:true,work:{state:'working',label:'Reviewing recorded sales',startedAt:'2026-10-27T04:29:00Z',expiresAt:'2026-10-27T04:31:00Z'}},activity:{available:false},reports:{available:true,data:[{title:'Saved result',status:'with_head',updated_at:'2026-10-26T12:00:00Z'}]}});
  assert.match(text,/Working now: Reviewing recorded sales/);assert.match(text,/Latest visible report.*Saved result — with.head/s);assert.match(text,/Recent activity records are unavailable/);
});

test('empty aggregate zeros remain unknown and an unavailable source never becomes zero',()=>{
  const intent=match('Show performance totals for last 7 days');
  const zero={revenue:0,units:0,spend:0,ad_revenue:0,days:[],platforms:[]};
  const text=deterministicMetricsAnswer(intent,{available:true,data:zero},now.toISOString());
  assert.match(text,/Shopify revenue: unknown/);assert.match(text,/advertising spend: unknown/);assert.match(text,/unknown, not zero/);assert.doesNotMatch(text,/₹0/);
  const unavailable=deterministicMetricsAnswer(intent,{available:false,data:{...zero,days:[['2026-10-26',0]]}},now.toISOString());
  assert.match(unavailable,/source could not be read/);assert.doesNotMatch(unavailable,/₹0/);
});

test('recorded zeros, exact UTC window and source limits survive deterministic formatting',()=>{
  const intent=match('Show performance totals for last 7 days');
  const data={revenue:0,units:0,spend:100,ad_revenue:250,days:[['2026-10-25',0],['2026-10-26',0]],platforms:[{platform:'meta',spend:100,revenue:250}]};
  const text=deterministicMetricsAnswer(intent,{available:true,data},now.toISOString());
  assert.match(text,/2026-10-21 through 2026-10-27, inclusive \(UTC date buckets\)/);assert.match(text,/Shopify revenue: ₹0/);assert.match(text,/units sold: 0/);assert.match(text,/ROAS: 2.5×/);
  assert.match(text,/current UTC day is partial/);assert.match(text,/2 sales dates have recorded rows/);assert.match(text,/sync completeness is not verified/);assert.match(text,/may overlap/);assert.match(text,/not profit/);
  assert.match(deterministicMetricsAnswer(intent,{available:true,data:{...data,spend:0}},now.toISOString()),/ROAS: unknown/);
  assert.match(deterministicMetricsAnswer(intent,{available:true,data:{...data,revenue:null,units:null}},now.toISOString()),/Shopify revenue: unknown/);
});

test('malformed numeric domains never produce invented units, negative ad totals or infinite ROAS',()=>{
  const intent=match('Show performance totals for last 7 days');
  const base={revenue:10,units:2,spend:1,ad_revenue:5,days:[['2026-10-26',10]],platforms:[{platform:'meta'}]};
  for (const units of [1.5,-1,Number.MAX_SAFE_INTEGER+1,'0x10','1e3',true,'',null]) {
    const text=deterministicMetricsAnswer(intent,{available:true,data:{...base,units}},now.toISOString());
    assert.match(text,/Shopify units sold: unknown/,String(units));
  }
  for (const value of [-1,Number.MAX_SAFE_INTEGER+1,'0x10','1e3',false,Infinity]) {
    const text=deterministicMetricsAnswer(intent,{available:true,data:{...base,spend:value,ad_revenue:value}},now.toISOString());
    assert.match(text,/advertising spend: unknown/);assert.match(text,/attributed revenue: unknown/);assert.match(text,/ROAS: unknown/);
  }
  const overflow=deterministicMetricsAnswer(intent,{available:true,data:{...base,spend:Number.MIN_VALUE,ad_revenue:100}},now.toISOString());
  assert.match(overflow,/ROAS: unknown/);assert.doesNotMatch(overflow,/Infinity|∞|NaN/);
  const valid=deterministicMetricsAnswer(intent,{available:true,data:{...base,revenue:'-5.50',units:'3.0',spend:'2.50',ad_revenue:'7.50'}},now.toISOString());
  assert.match(valid,/Shopify revenue: ₹-5.5/);assert.match(valid,/units sold: 3/);assert.match(valid,/ROAS: 3×/);
});
