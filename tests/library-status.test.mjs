import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLibraryRuntime,libraryDisplayState,readLibraryFolderPages,safeLibraryNote } from '../src/app/(app)/studio/library-status.mjs';

const now=Date.parse('2026-10-26T12:00:00Z');
const input=()=>({cursor:{updated_at:'2026-10-26T11:59:50Z',state:{state:'reading',holder:'worker-private-id',startedAt:'2026-10-26T11:59:00Z',activeFolderName:'Kiran',lastResult:'A page was indexed.',claims:[{id:'privateclaim'}],folderRetries:{private:true}}},lease:{holder:'worker-private-id',until:'2026-10-26T12:02:00Z'},paused:false,designerEnabled:true,geminiConfigured:true});
const counts={pendingFolders:41,waiting:0,failed:0,folderErrors:0};
const runtime=(changes={})=>projectLibraryRuntime({...input(),...changes},now);

test('the real incident:41 pending folders and no waiting designs is queued without an active lease',()=>{
  const status=libraryDisplayState(runtime({lease:null}),counts);
  assert.equal(status.state,'queued');assert.equal(status.active,false);assert.equal(status.poll,true);
  assert.match(status.message,/41 folders waiting to be read; 0 designs waiting/);
  assert.match(status.message,/No active library worker is confirmed/);
});

test('a matching fresh owned lease is required for active reading or study',()=>{
  assert.equal(libraryDisplayState(runtime(),counts).state,'reading');
  for(const mutate of [value=>{value.lease.holder='other';},value=>{value.lease.until='2026-10-26T11:59:59Z';},value=>{value.cursor.updated_at='2026-10-26T11:55:29Z';},value=>{value.cursor.updated_at='2026-10-26T12:01:00Z';}]) {
    const value=input();mutate(value);assert.equal(projectLibraryRuntime(value,now).active,false);
  }
  const study=input();study.cursor.state.state='studying';const status=libraryDisplayState(projectLibraryRuntime(study,now),{...counts,waiting:139});
  assert.equal(status.state,'studying');assert.equal(status.active,true);assert.match(status.message,/139 designs waiting/);
});

test('private lease, claims and retry data never appear in the page projection',()=>{
  const projected=runtime();assert.equal(projected.active,true);
  assert.doesNotMatch(JSON.stringify(projected),/worker-private-id|privateclaim|folderRetries|claims|"holder"|"lease"/);
});

test('pause overrides a fresh worker indicator without claiming completion',()=>{
  const status=libraryDisplayState(runtime({paused:true}),{...counts,waiting:12});
  assert.equal(status.state,'paused');assert.equal(status.active,false);assert.equal(status.poll,false);assert.match(status.message,/12 designs waiting/);
});

test('missing Gemini or disabled designer explains the study blocker and preserves queue counts',()=>{
  const noKey=libraryDisplayState(runtime({lease:null,geminiConfigured:false}),{...counts,waiting:139});
  assert.equal(noKey.state,'blocked');assert.match(noKey.message,/Add a Gemini key/);assert.match(noKey.message,/139 designs waiting/);
  const disabled=libraryDisplayState(runtime({lease:null,designerEnabled:false}),{...counts,waiting:139});
  assert.equal(disabled.state,'blocked');assert.match(disabled.message,/Designer is disabled/);
});

test('discovery may proceed before there is a Gemini study queue',()=>{
  const status=libraryDisplayState(runtime({lease:null,geminiConfigured:false}),counts);
  assert.equal(status.state,'queued');assert.match(status.message,/41 folders/);
});

test('failed studies and folder errors are visible separately rather than represented as skipped',()=>{
  const status=libraryDisplayState(runtime({lease:null}),{pendingFolders:1,waiting:0,failed:3,folderErrors:1});
  assert.equal(status.state,'attention');assert.equal(status.active,false);
  assert.match(status.message,/3 designs failed and 1 folder reported an error/);assert.doesNotMatch(status.message,/skipped/);
});

test('unknown reads do not invent a zero queue or claim worker activity',()=>{
  const status=libraryDisplayState(runtime({readError:true}),{pendingFolders:null,waiting:null,failed:null,folderErrors:null,readError:true});
  assert.equal(status.state,'unknown');assert.equal(status.active,false);assert.doesNotMatch(status.message,/0|finished|running/);
});

test('an empty queue is not a claim to have inspected every current Drive file',()=>{
  const status=libraryDisplayState(runtime({lease:null}),{pendingFolders:0,waiting:0,failed:0,folderErrors:0});
  assert.equal(status.state,'idle');assert.equal(status.poll,false);assert.match(status.message,/later scans/);
});

test('folder pagination reads beyond the old500 cap and marks incomplete reads honestly',async()=>{
  const rows=Array.from({length:1001},(_,id)=>({id})),pages=[];
  const result=await readLibraryFolderPages(async(from,to)=>{pages.push([from,to]);return {data:rows.slice(from,to+1),error:null};});
  assert.equal(result.rows.length,1001);assert.equal(result.complete,true);assert.deepEqual(pages,[[0,999],[1000,1999]]);
  const partial=await readLibraryFolderPages(async(from,to)=>from===0?{data:rows.slice(from,to+1),error:null}:{data:null,error:{message:'unavailable'}});
  assert.equal(partial.rows.length,1000);assert.equal(partial.complete,false);
});

test('provider bearer and credential fragments are removed from bounded status notes',()=>{
  const note=safeLibraryNote('Failure Bearer test-secret access_token=private-token client_secret:private-key '+'.'.repeat(1000));
  assert.doesNotMatch(note,/test-secret|private-token|private-key/);assert.ok(note.length<=500);
});
