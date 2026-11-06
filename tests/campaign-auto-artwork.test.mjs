import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticCampaignArtworkUser } from '../src/lib/agents/campaign-auto-artwork.mjs';

const user='11111111-1111-4111-8111-111111111111';
const request='22222222-2222-4222-8222-222222222222';
const env={CHATGPT_IMAGE_WORKER_ENABLED:'true',CHATGPT_IMAGE_AUTOMATION_USER_ID:user,CHATGPT_IMAGE_AUTO_CAMPAIGN_AFTER:'2026-11-06T17:00:00Z'};
const creative={created_at:'2026-11-06T17:01:00Z',art_status:'awaiting_import',artwork_request_id:request,image_path:null};

test('automatic campaign generation starts only for new pending requests with a configured actor',()=>{
  assert.equal(automaticCampaignArtworkUser(creative,env),user);
  assert.equal(automaticCampaignArtworkUser({...creative,created_at:'2026-11-06T16:59:59Z'},env),null);
  assert.equal(automaticCampaignArtworkUser({...creative,art_status:'ready'},env),null);
  assert.equal(automaticCampaignArtworkUser({...creative,image_path:'previous.png'},env),null);
  assert.equal(automaticCampaignArtworkUser(creative,{...env,CHATGPT_IMAGE_AUTOMATION_USER_ID:''}),null);
  assert.equal(automaticCampaignArtworkUser(creative,{...env,CHATGPT_IMAGE_WORKER_ENABLED:'false'}),null);
});
