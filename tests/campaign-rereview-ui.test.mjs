import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {campaignReviewState} from '../src/app/(app)/approvals/approval-ui.mjs';
import {campaignArtifact} from '../src/lib/agents/quality-core.mjs';
import {UUID} from '../src/lib/automation/core.mjs';

const id='4b0474b7-3d5d-4e9e-8e47-2d52ab5ecab4';
const approval={id,status:'pending',required_roles:['creative_head'],quality_snapshot:null};
const creatives=[{id:'asset',headline:'Supported copy',body:'Body',image_path:'image-v1.png',art_status:'ready'}];
const plan={name:'Campaign',budget_daily:100,channels:['meta']};
plan.quality={version:1,passed:true,claims:'clean',policy:'ok',cmoApproved:true,artifact:campaignArtifact(plan,creatives)};
const campaign={status:'in_approval',plan,creatives,external_ids:null};

test('legacy or stale approval offers only an eligible authorized user a fresh review',()=>{
  assert.deepEqual(campaignReviewState(approval,campaign,'creative_head'),{current:false,canRequest:true});
  assert.equal(campaignReviewState(approval,campaign,'super_admin').canRequest,true);
  for(const role of ['viewer','finance_head'])assert.equal(campaignReviewState(approval,campaign,role).canRequest,false);
  for(const status of ['approved','publishing','publish_review','live','rejected'])assert.equal(campaignReviewState(approval,{...campaign,status},'super_admin').canRequest,false);
  assert.equal(campaignReviewState({...approval,status:'changes'},campaign,'super_admin').canRequest,false);
  assert.equal(campaignReviewState(approval,{...campaign,external_ids:{meta:{campaign_id:'existing'}}},'super_admin').canRequest,false);
});

test('fresh snapshot equality is field-order independent and any asset change invalidates it',()=>{
  const checked={...approval,quality_snapshot:Object.fromEntries(Object.entries(plan.quality).reverse())};
  assert.deepEqual(campaignReviewState(checked,campaign,'creative_head'),{current:true,canRequest:false});
  const changed={...campaign,creatives:[{...creatives[0],body:'New body'}]};
  assert.deepEqual(campaignReviewState(checked,changed,'creative_head'),{current:false,canRequest:true});
});

const code=ts.transpileModule(readFileSync(new URL('../src/app/(app)/approvals/actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function actions(result={data:id,error:null}) {
  const calls=[],paths=[],redirects=[];let immediate=0;
  const db={rpc:async(name,args)=>{calls.push({name,args});return result;}};
  const modules={'next/cache':{revalidatePath:path=>paths.push(path)},'next/navigation':{redirect:path=>{redirects.push(path);throw Object.assign(Error('Redirect'),{isRedirect:true});}},'@/lib/supabase/server':{supabaseServer:async()=>db},'@/lib/supabase/admin':{supabaseAdmin:()=>{immediate++;}},'@/lib/agents/publish':{publishApproved:async()=>{immediate++;}},'@/lib/auth/session':{requireUser:async()=>({db})},'@/lib/automation/core.mjs':{UUID}};
  const exports={};new Function('exports','require',code)(exports,name=>{assert.ok(name in modules,`Unmocked import ${name}`);return modules[name];});
  return {request:exports.requestCampaignReview,calls,paths,redirects,get immediate(){return immediate;}};
}

test('fresh-review action queues the authenticated RPC and revalidates without advancing or publishing',async()=>{
  const h=actions(),form=new FormData();form.set('id',id);await assert.rejects(h.request(form),error=>error.isRedirect===true);
  assert.deepEqual(h.calls,[{name:'request_campaign_rereview',args:{p_approval:id}}]);
  assert.deepEqual(h.paths,['/approvals','/admin','/automations']);assert.equal(h.immediate,0);
  assert.match(decodeURIComponent(h.redirects[0]),/Fresh quality review queued/);
});

test('invalid, unauthorized or busy rereview requests cannot claim success',async()=>{
  const invalid=actions(),bad=new FormData();bad.set('id','not-a-uuid');await assert.rejects(invalid.request(bad));assert.equal(invalid.calls.length,0);
  for(const code of ['42501','40001','22023']){
    const h=actions({data:null,error:{code,message:'Internal detail must not leak'}}),form=new FormData();form.set('id',id);await assert.rejects(h.request(form));
    assert.match(h.redirects[0],/error=/);assert.doesNotMatch(decodeURIComponent(h.redirects[0]),/Internal detail|review queued/);assert.equal(h.paths.length,0);assert.equal(h.immediate,0);
  }
});
