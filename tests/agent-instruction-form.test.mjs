import test from 'node:test';
import assert from 'node:assert/strict';
import { instructionLength,mayEditInstructions,submitInstructionForm } from '../src/app/(app)/agents/manage/instruction-form.mjs';

const form=(text='Use source dates.',revision='0',agent='analyticsLead')=>{const value=new FormData();value.set('agent_id',agent);value.set('instructions',text);value.set('revision',revision);return value;};
const row=(instructions='Use source dates.',revision=1)=>({agent_id:'analyticsLead',instructions,revision,updated_at:'2026-10-26T11:00:00Z'});
const deps=(override={})=>({role:'ecom_manager',readAccess:async()=>({departmentRole:'ecom_manager'}),save:async()=>({data:row(),error:null}),readCurrent:async()=>row('Newer saved text.',2),...override});

test('department management follows the actual assigned head role, never viewer or another head',()=>{
  assert.equal(mayEditInstructions('super_admin','creative_head'),true);
  assert.equal(mayEditInstructions('ecom_manager','ecom_manager'),true);
  assert.equal(mayEditInstructions('creative_head','ecom_manager'),false);
  assert.equal(mayEditInstructions('viewer','viewer'),false);
  assert.equal(mayEditInstructions('ecom_manager',null),false);
});

test('forged viewer submission never reaches permission reads or save',async()=>{
  let accessed=false;
  const state=await submitInstructionForm(form(),deps({role:'viewer',readAccess:async()=>{accessed=true;throw new Error();},save:async()=>{throw new Error('must not save');}}));
  assert.equal(state.status,'error');assert.equal(accessed,false);assert.match(state.message,/Only the Super Admin/);
});

test('another department head cannot submit even when form agent ID is forged',async()=>{
  let saved=false;
  const state=await submitInstructionForm(form(),deps({readAccess:async()=>({departmentRole:'perf_marketer'}),save:async()=>{saved=true;return {data:row(),error:null};}}));
  assert.equal(state.status,'error');assert.equal(saved,false);assert.equal(state.draft,'Use source dates.');
});

test('signed-in save sends exact optimistic revision and accepts composite or array response',async()=>{
  for(const array of [false,true]) {
    const state=await submitInstructionForm(form('  Use source dates.  ','4'),deps({save:async params=>{
      assert.deepEqual(params,{p_agent_id:'analyticsLead',p_instructions:'Use source dates.',p_expected_revision:4});return {data:array?[row('Use source dates.',5)]:row('Use source dates.',5),error:null};
    }}));
    assert.equal(state.status,'saved');assert.equal(state.current.revision,5);assert.equal(state.draft,'Use source dates.');
  }
});

test('conflict preserves user draft and returns latest readable snapshot without overwriting it',async()=>{
  let saves=0;
  const state=await submitInstructionForm(form('My unsaved guidance.','1'),deps({save:async()=>{saves++;return {data:null,error:{code:'40001',message:'private provider data'}};}}));
  assert.equal(state.status,'conflict');assert.equal(state.draft,'My unsaved guidance.');assert.equal(state.current.instructions,'Newer saved text.');assert.equal(state.current.revision,2);assert.equal(saves,1);
  assert.doesNotMatch(state.message,/private provider/);
});

test('conflict cannot leak a snapshot belonging to a different agent',async()=>{
  const state=await submitInstructionForm(form(),deps({save:async()=>({data:null,error:{code:'40001'}}),readCurrent:async()=>({...row(),agent_id:'cmo'})}));
  assert.equal(state.status,'conflict');assert.equal(state.current,null);assert.equal(state.draft,'Use source dates.');
});

test('RPC authorization changes are not retried or disguised as a save',async()=>{
  const state=await submitInstructionForm(form('Keep my draft.'),deps({save:async()=>({data:null,error:{code:'42501',message:'internal private details'}})}));
  assert.equal(state.status,'error');assert.match(state.message,/permission/);assert.equal(state.draft,'Keep my draft.');assert.doesNotMatch(state.message,/private/);
});

test('blank text deliberately clears while Unicode counts match PostgreSQL characters',async()=>{
  assert.equal(instructionLength('🪷'.repeat(6000)),6000);
  const cleared=await submitInstructionForm(form(' \n\t '),deps({save:async params=>{assert.equal(params.p_instructions,'');return {data:row('',3),error:null};}}));
  assert.equal(cleared.status,'saved');assert.equal(cleared.current.instructions,'');assert.match(cleared.message,/cleared/);
  const accepted=await submitInstructionForm(form('🪷'.repeat(6000)),deps({save:async params=>({data:row(params.p_instructions),error:null})}));
  assert.equal(accepted.status,'saved');
});

test('oversized text, null characters and malformed revisions cannot reach RPC',async()=>{
  for(const bad of [form('a'.repeat(6001)),form('null\u0000character'),form('text','-1'),form('text','1.1'),form('text','99999999999999999')]) {
    let saved=false;
    const state=await submitInstructionForm(bad,deps({save:async()=>{saved=true;return {data:row(),error:null};}}));
    assert.equal(state.status,'error');assert.equal(saved,false);
  }
});

test('unconfirmed or failed save retains draft and never exposes upstream error text',async()=>{
  for(const save of [async()=>{throw new Error('secret-token=example');},async()=>({data:null,error:null})]) {
    const state=await submitInstructionForm(form('Retain this.'),deps({save}));
    assert.equal(state.status,'error');assert.equal(state.draft,'Retain this.');assert.doesNotMatch(state.message,/secret-token|example/);
  }
});
