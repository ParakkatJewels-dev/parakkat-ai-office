import test from 'node:test';
import assert from 'node:assert/strict';
import {outcomeBrief,campaignStatusLabel} from '../src/app/(app)/outcomes/outcome-brief.mjs';

const base={source_kind:'provider_campaign',approval_state:'proposed',execution_state:'not_started',outcome_state:'awaiting_data',metric_config:null,observation:{campaignMonitoring:{mode:'current',reason:'recent_delivery',recentDeliveryAt:'2026-10-26'}}};
test('plain outcome explains the current ad without inventing a result',()=>{
  const result=outcomeBrief(base);
  assert.match(result.headline,/not available/i);
  assert.match(result.explanation,/refresh the ad data/i);
  assert.match(result.next,/refresh/i);
  assert.doesNotMatch(`${result.headline} ${result.explanation}`,/profitable|successful campaign/i);
});
test('recorded delivery is shown even when a campaign has no success target',()=>{
 const row={...base,observation:{...base.observation,deliverySummary:{from:'2026-10-20',to:'2026-10-26',timezone:'Asia/Kolkata',impressions:12500,clicks:320,spend:4100,recordedDays:5,currency:'INR',lastSyncedAt:'2026-10-27T09:00:00Z'}}};
 const result=outcomeBrief(row);
 assert.match(result.headline,/12,500 impressions/);
 assert.match(result.explanation,/320 clicks/);
 assert.match(result.explanation,/INR 4,100/);
 assert.match(result.explanation,/not live/);
 assert.match(result.next,/choose a result/i);
});
test('draft, approval and missing delivery each say the next human action',()=>{
  assert.match(outcomeBrief({...base,source_kind:'campaign',approval_state:'needs_correction'}).next,/correct/i);
  assert.match(outcomeBrief({...base,source_kind:'campaign',approval_state:'awaiting_human'}).next,/approval/i);
  assert.match(outcomeBrief({...base,source_kind:'campaign',approval_state:'approved'}).headline,/not confirmed it went live/i);
});
test('unknown coverage and absent results stay unknown in plain language',()=>{
  assert.match(outcomeBrief({...base,observation:{campaignMonitoring:{mode:'scope_unknown'}}}).headline,/cannot tell/i);
  assert.match(outcomeBrief({...base,source_kind:'campaign',approval_state:'approved',execution_state:'provider_confirmed'}).headline,/not enough reliable data/i);
  assert.equal(campaignStatusLabel('ENABLED'),'On');
  assert.equal(campaignStatusLabel('PAUSED'),'Paused');
});
