// Estimating what each AI or API call costs, and knowing which agent made it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import ts from 'typescript';
import * as cost from '../src/lib/usage-cost.mjs';
import * as taskUsage from '../src/lib/task-usage-core.mjs';
const { priceFor, costUsd, agentFromPrompt, geminiImageBilling, usageCostUsd } = cost;

const P = { 'openai:gpt-4.1': { in_per_m: 2, out_per_m: 8, per_unit: 0 }, 'openai:*': { in_per_m: 5, out_per_m: 15, per_unit: 0 }, 'serpapi:*': { in_per_m: 0, out_per_m: 0, per_unit: 0.015 } };

test('the exact model wins, then the provider default, then free', () => {
  assert.equal(priceFor(P, 'openai', 'gpt-4.1').in_per_m, 2);
  assert.equal(priceFor(P, 'openai', 'gpt-9').in_per_m, 5);
  assert.deepEqual(priceFor(P, 'jev', 'x'), { in_per_m: 0, out_per_m: 0, per_unit: 0 });
});

test('tokens are priced per million and calls per unit', () => {
  assert.equal(costUsd(P['openai:gpt-4.1'], { input: 1000, output: 500, units: 1 }), 0.006);
  assert.equal(costUsd(P['serpapi:*'], { units: 4 }), 0.06);
});

test('the agent comes from the first line of its prompt', () => {
  const people = [{ id: 'cmo', name: 'AI Chief Marketing Officer' }, { id: 'sales', name: 'Sales Analyst' }];
  assert.equal(agentFromPrompt('You are Sales Analyst at Parakkat Jewels, a Kerala...', people).id, 'sales');
  assert.equal(agentFromPrompt('You classify marketing data.', people), null);
});

test('stable agent identity attributes a renamed agent and rejects unknown or human IDs', () => {
  const people=[{id:'sales',name:'Sales Analyst'},{id:'head',name:'Human Head',human:true}];
  assert.equal(agentFromPrompt('Agent identity: sales\n\nYou are Renamed Analyst at Parakkat',people)?.id,'sales');
  assert.equal(agentFromPrompt('Agent identity: unknown\n\nYou are Sales Analyst at Parakkat',people),null);
  assert.equal(agentFromPrompt('Agent identity: head\n',people),null);
});

const proModel='gemini-3-pro-image';
const finalImage={inlineData:{mimeType:'image/png',data:'final'}};
const proMetadata={promptTokenCount:1000,candidatesTokenCount:1170,thoughtsTokenCount:100,candidatesTokensDetails:[{modality:'IMAGE',tokenCount:1120},{modality:'TEXT',tokenCount:50}]};
test('Pro costs combine text/thinking and one final image without billing the image tokens twice',()=>{
  const billing=geminiImageBilling(proModel,'2K',proMetadata,[{thought:true,inlineData:{}},finalImage]);
  assert.equal(billing.billingOutput,150);assert.equal(billing.imageCharge.units,1);assert.equal(billing.costNote,undefined);
  const use={provider:'gemini',model:proModel,input:1000,output:1270,...billing};
  assert.ok(Math.abs(usageCostUsd({},use)-(0.002+0.0018+0.134))<1e-12);
  const custom={
    [`gemini:${proModel}`]:{in_per_m:3,out_per_m:10,per_unit:0.134},
    [`gemini:${proModel}-image-2k`]:{in_per_m:0,out_per_m:0,per_unit:0.2},
  };
  assert.ok(Math.abs(usageCostUsd(custom,use)-(0.003+0.0015+0.2))<1e-12,'resolution row owns image fee even with a legacy main-row fee');
  custom[`gemini:${proModel}-image-2k`].per_unit=0;
  assert.ok(Math.abs(usageCostUsd(custom,use)-0.0045)<1e-12,'an explicit zero price remains zero');
});
test('Pro 4K uses its own image price and counts only final images',()=>{
  const billing=geminiImageBilling(proModel,'4K',{promptTokenCount:1000,candidatesTokenCount:4050,thoughtsTokenCount:100,candidatesTokensDetails:[{modality:'IMAGE',tokenCount:4000},{modality:'TEXT',tokenCount:50}]},[finalImage,{thought:true,inlineData:{}},finalImage]);
  assert.equal(billing.billingOutput,150);assert.equal(billing.imageCharge.units,2);
  assert.equal(billing.imageCharge.priceKey,`gemini:${proModel}-image-4k`);
  assert.ok(Math.abs(usageCostUsd({}, {provider:'gemini',model:proModel,input:1000,output:4150,...billing})-0.4838)<1e-12);
  assert.equal(geminiImageBilling(proModel,'1K',proMetadata,[finalImage]).imageCharge.priceKey,`gemini:${proModel}-image-2k`);
});
test('unknown or inconsistent image modalities produce an explicit bounded estimate with nonzero image cost',()=>{
  for(const patch of [{candidatesTokensDetails:undefined},{candidatesTokensDetails:[{modality:'IMAGE',tokenCount:-1}]},{candidatesTokensDetails:[{modality:'IMAGE',tokenCount:2000}]}]){
    const billing=geminiImageBilling(proModel,'2K',{...proMetadata,...patch},[finalImage]);
    assert.equal(billing.billingOutput,150);assert.match(billing.costNote,/Estimated text\/image split/);
  }
  const small=geminiImageBilling(proModel,'2K',{promptTokenCount:10,candidatesTokenCount:10,thoughtsTokenCount:5},[finalImage]);
  assert.equal(small.billingOutput,5);assert.match(small.costNote,/clamped at zero/);
  const missing=geminiImageBilling(proModel,'2K',{},[finalImage]);
  assert.match(missing.costNote,/cost incomplete/);assert.equal(usageCostUsd({}, {provider:'gemini',model:proModel,...missing}),0.134);
  const unknown=geminiImageBilling(proModel,'2K',{...proMetadata,candidatesTokensDetails:[{modality:'IMAGE',tokenCount:1120},{modality:'OTHER',tokenCount:50}]},[finalImage]);
  assert.equal(unknown.billingOutput,150);assert.match(unknown.costNote,/Unrecognized output modality/);
});
test('models outside Pro retain their existing token and per-call accounting',()=>{
  assert.deepEqual(geminiImageBilling('gemini-3.1-flash-image','2K',proMetadata,[finalImage]),{});
  assert.equal(usageCostUsd(P,{provider:'openai',model:'gpt-4.1',input:1000,output:500}),0.006);
});
test('recordUsage stores provider totals unchanged while estimating cost from the separate billing output',async()=>{
  const rows=[],db={from(table){return table==='usage_prices'?{select:async()=>({data:[]})}:{insert:async row=>{rows.push(row);return {error:null};}};}};
  const modules={'server-only':{},'node:async_hooks':{AsyncLocalStorage},'@/lib/supabase/admin':{supabaseAdmin:()=>db},'@/office/roster.mjs':{PEOPLE:[]},'./usage-cost.mjs':cost,'./task-usage-core.mjs':taskUsage};
  const source=readFileSync(new URL('../src/lib/usage.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};
  new Function('exports','require',compiled)(exports,name=>{assert.ok(name in modules,name);return modules[name];});
  const billing=geminiImageBilling(proModel,'2K',{...proMetadata,candidatesTokensDetails:undefined},[finalImage]);
  await exports.recordUsage({provider:'gemini',model:proModel,input:1000,output:1270,...billing});
  assert.equal(rows.length,1);assert.equal(rows[0].input_tokens,1000);assert.equal(rows[0].output_tokens,1270);
  assert.ok(Math.abs(rows[0].cost_usd-0.1378)<1e-12);assert.match(rows[0].cost_note,/Estimated text\/image split/);
});
test('Pro price migration preserves customized prices and separates image charges',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261028000200_gemini_pro_prices.sql',import.meta.url),'utf8');
  assert.match(sql,/on conflict \(key\) do nothing/i);
  assert.match(sql,/gemini:gemini-3-pro-image', 2, 12, 0/);
  assert.match(sql,/image-2k', 0, 0, 0\.134/);assert.match(sql,/image-4k', 0, 0, 0\.24/);
});
