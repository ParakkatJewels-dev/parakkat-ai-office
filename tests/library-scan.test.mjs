import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import * as core from '../src/lib/agents/library-scan-core.mjs';
import {isDesignFile,searchWords,childrenQuery} from '../src/lib/agents/library-core.mjs';

test('full Drive queries include uncommon eligible images and never change across pagination',()=>{
  assert.equal(childrenQuery('folder','2026-10-01'),childrenQuery('folder',null));
  assert.equal(childrenQuery('folder'),"'folder' in parents and trashed = false");
  for(const mime of ['image/tiff','image/avif','image/bmp','image/heif'])assert.equal(isDesignFile(mime),true);
  for(const mime of ['image/gif','image/svg+xml','video/mp4'])assert.equal(isDesignFile(mime),false);
});
test('an incomplete or malformed Drive response cannot complete a folder',()=>{
  assert.throws(()=>core.parseDrivePage({incompleteSearch:true,files:[]}),/incomplete/);
  assert.throws(()=>core.parseDrivePage({files:{}}),/invalid/);
  assert.throws(()=>core.parseDrivePage({files:[{id:'x'}]}),/metadata/);
  assert.deepEqual(core.parseDrivePage({files:[],nextPageToken:'next'}),{files:[],next:'next'});
});
test('unchanged designs are free to rediscover; null old revision can become a new revision',()=>{
  const rows=[{drive_id:'same',modified_at:'2026-10-20'},{drive_id:'changed',modified_at:'2026-10-25'},{drive_id:'new',modified_at:null}];
  assert.deepEqual(core.changedDesigns(rows,[{drive_id:'same',modified_at:'2026-10-20'},{drive_id:'changed',modified_at:null}]),{fresh:[rows[2]],changed:[rows[1]]});
});
test('claim completion requires the exact new revision; late output cannot replace a newer file',()=>{
  const claim={driveId:'file',modifiedAt:'2026-10-20'};
  assert.equal(core.sameLibraryRevision({drive_id:'file',modified_at:'2026-10-20',status:'new'},claim),true);
  assert.equal(core.sameLibraryRevision({drive_id:'file',modified_at:'2026-10-21',status:'new'},claim),false);
  assert.equal(core.sameLibraryRevision({drive_id:'file',modified_at:'2026-10-20',status:'ready'},claim),false);
});
test('bounded discovery preserves a second-page cursor on failure and lets another folder progress',async()=>{
  const folders=[{id:'a',page_token:null},{id:'b',page_token:null}],finished=new Set(),failures=[];let cursor=null;
  const result=await core.discoverLibrary({check:async()=>{},nextFolder:async skip=>folders.find(f=>!skip.has(f.id)&&!finished.has(f.id)),
    list:async f=>{if(f.id==='a'&&f.page_token)throw new Error('provider failed');return {files:[],next:f.id==='a'?'page2':null};},
    savePage:async(f,p)=>{f.page_token=p.next;if(f.id==='a')cursor=p.next;if(!p.next)finished.add(f.id);return{found:0};},
    failFolder:async(f,e,reset)=>failures.push({id:f.id,reset}),
  });
  assert.equal(cursor,'page2');assert.deepEqual([...finished],['b']);assert.deepEqual(failures,[{id:'a',reset:false}]);assert.equal(result.failures,1);
});
test('page and time budgets stop discovery without declaring unfinished folders complete',async()=>{
  let calls=0;
  const result=await core.discoverLibrary({check:async()=>{},nextFolder:async()=>({id:'a'}),list:async()=>({files:[],next:'more'}),savePage:async()=>{calls++;return{found:0};},failFolder:async()=>{},maxPages:2});
  assert.equal(calls,2);assert.equal(result.foldersRead,0);
});
test('a lost lease/pause during a page never writes a failure checkpoint',async()=>{
  let checks=0,failures=0;
  await assert.rejects(core.discoverLibrary({check:async()=>{if(++checks>1)throw new Error('lease lost');},nextFolder:async()=>({id:'a'}),list:async()=>({files:[],next:null}),savePage:async()=>({found:0}),failFolder:async()=>{failures++;}}),/lease lost/);
  assert.equal(failures,0);
});
test('discovery budget cancellation preserves the cursor without creating a folder failure',async()=>{
  let stopped=false,failures=0,saved=0;
  const result=await core.discoverLibrary({check:async()=>{},shouldStop:()=>stopped,nextFolder:async()=>({id:'a'}),list:async()=>{stopped=true;throw new Error('budget expired');},savePage:async()=>{saved++;return{found:0};},failFolder:async()=>{failures++;}});
  assert.equal(failures,0);assert.equal(saved,0);assert.equal(result.failures,0);assert.equal(result.foldersRead,0);
});
test('invalid tokens restart safely and retries back off; bad model output is never silently ready',()=>{
  assert.equal(core.invalidDrivePageToken(new Error('Invalid pageToken')),true);
  assert.equal(core.invalidDrivePageToken(new Error('permission denied')),false);
  assert.equal(Date.parse(core.libraryRetryAt(1,0)),540000);
  assert.equal(Date.parse(core.libraryRetryAt(20,0)),6*3600000);
  assert.throws(()=>core.libraryDescription({style:'nice'}),/finished design/);
  assert.throws(()=>core.libraryDescription({keep:true,style:'nice'}),/layout/);
  assert.equal(core.libraryDescription({keep:false}).keep,false);
  assert.equal(core.libraryDescription({keep:true,style:'Rich maroon',layout:'Centered product',fingerprint:{lighting:'Warm brass diyas'}}).fingerprint.lighting,'Warm brass diyas');
});
test('already aborted work consumes a later promise rejection',async()=>{
  const controller=new AbortController();controller.abort(new Error('stop'));
  let reject;const underlying=new Promise((_,r)=>{reject=r;});
  await assert.rejects(core.libraryAbortable(underlying,controller.signal),/stop/);reject(new Error('late'));
  await new Promise(resolve=>setTimeout(resolve,10));
});

// Execute the real TypeScript orchestrator with injected providers and an in-memory PostgREST double.
// These integration tests do not call Gemini, Drive, storage, or a live database.
const source=readFileSync(new URL('../src/lib/agents/library.ts',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class Paused extends Error {}
const folder=(id,extra={})=>({id,root_id:id,name:id,files:0,page_token:null,scanned_at:null,error:null,created_at:'2026-10-01',...extra});
const file=(id,extra={})=>({id,name:id,mimeType:'image/jpeg',modifiedTime:'2026-10-20T00:00:00Z',...extra});
function harness({folders=[folder('root')],refs=[],progress={},busy=false,pages={},configured=true,pause=false,failWrite=null,model,handoff=false}={}) {
  const tables={design_library_folders:structuredClone(folders),design_refs:structuredClone(refs),sync_cursors:progress.state?[structuredClone(progress)]:[],autopilot_jobs:[],agents:[{id:'designer',enabled:true}],job_locks:[]};
  const calls={drive:[],model:0,upload:0,writes:[]};let failed=false;
  const key=t=>t==='design_refs'?'drive_id':t==='sync_cursors'||t==='autopilot_jobs'||t==='job_locks'?'name':'id';
  function from(table) {
    let operation='select',payload=null,filters=[],max=Infinity,single=false,count=false,returning=false,sorts=[],abort;
    const q={
      select:(_columns,opts={})=>{count=!!opts.count;returning=true;return q;},update:v=>{operation='update';payload=v;return q;},upsert:(v,opts)=>{operation='upsert';payload=v;q.ignore=opts?.ignoreDuplicates;return q;},
      eq:(k,v)=>{filters.push(r=>(k==='state->>holder'?r.state?.holder:r[k])===v);return q;},is:(k,v)=>{filters.push(r=>(r[k]??null)===v);return q;},
      gt:(k,v)=>{filters.push(r=>r[k]>v);return q;},in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},
      not:(k,op,v)=>{filters.push(op==='in'?r=>!v.slice(1,-1).split(',').includes(r[k]):r=>(r[k]??null)!==v);return q;},
      or:s=>{filters.push(r=>s.split(',').some(c=>{const [k,op,...rest]=c.split('.'),v=rest.join('.');return op==='is'?r[k]==null:op==='not'?r[k]!=null:op==='lt'?r[k]!=null&&r[k]<v:false;}));return q;},
      order:(k,opts={})=>{sorts.push([k,opts]);return q;},limit:n=>{max=n;return q;},maybeSingle:()=>{single=true;return q;},abortSignal:s=>{abort=s;return q;},
      then:(resolve,reject)=>Promise.resolve().then(()=>{
        abort?.throwIfAborted();
        if(operation!=='select')calls.writes.push({table,operation,payload:structuredClone(payload)});
        if(!failed&&failWrite?.(table,operation,payload)){failed=true;return {data:null,error:new Error('simulated write failure'),count:null};}
        let rows=tables[table].filter(r=>filters.every(f=>f(r)));
        for(const [k,opts] of sorts.toReversed())rows.sort((a,b)=>a[k]==null?(b[k]==null?0:-1):b[k]==null?1:String(a[k]).localeCompare(String(b[k]))*(opts.ascending===false?-1:1));
        const total=rows.length;rows=rows.slice(0,max);
        if(operation==='upsert') {rows=[];for(const item of Array.isArray(payload)?payload:[payload]){const match=tables[table].find(r=>r[key(table)]===item[key(table)]);if(match){if(!q.ignore)Object.assign(match,structuredClone(item));rows.push(match);}else{const row={...(table==='design_refs'?{id:randomUUID(),status:'new',created_at:'2026-10-26'}:table==='design_library_folders'?{page_token:null,scanned_at:null,files:0,error:null,created_at:'2026-10-26'}:{}),...structuredClone(item)};tables[table].push(row);rows.push(row);}}}
        if(operation==='update')for(const row of rows)Object.assign(row,structuredClone(payload));
        return {data:single?(structuredClone(rows[0])||null):structuredClone(rows),error:null,count:count?total:null};
      }).then(resolve,reject),
    };return q;
  }
  const db={from,rpc:(name,args)=>{
    const operation={abortSignal:()=>operation,then:(resolve,reject)=>Promise.resolve().then(()=>{
      if(name==='acquire_job_lock'){if(busy)return {data:false,error:null};tables.job_locks=[{name:args.p_name,holder:args.p_holder,until:new Date(Date.now()+args.p_seconds*1000).toISOString()}];return {data:true,error:null};}
      tables.job_locks=tables.job_locks.filter(r=>r.holder!==args.p_holder);return {data:null,error:null};
    }).then(resolve,reject)};return operation;
  },storage:{from:()=>({upload:async()=>{calls.upload++;return{error:null};}})}};
  const deps={isChatGPTHandoff:()=>handoff,randomUUID,geminiJSON:async()=>{calls.model++;return model?model():{keep:true,style:'Polished gold',layout:'Product centered',tags:['gold']};},geminiConfigured:async()=>configured,
    checkPause:async()=>{if(pause)throw new Paused('paused');},Paused,errText:e=>e.message||String(e),withUsage:(_,fn)=>fn(),withAgentWork:(_,fn)=>fn(),designImageById:async()=>({data:Buffer.from('preview'),mimeType:'image/jpeg'}),
    listChildren:async(id,token)=>{calls.drive.push([id,token]);const p=pages[`${id}:${token||''}`]||{files:[],next:null};if(p instanceof Error)throw p;return p;},isDesignFile,searchWords,...core,emit:async()=>{}};
  const exports={};new Function('exports',...Object.keys(deps),compiled)(exports,...Object.values(deps));return {db,tables,calls,...exports};
}
test('real discovery-only runner traverses nested folders and records all files without paid calls',async()=>{
  const h=harness({pages:{'root:':{files:[file('one'),file('sub',{mimeType:'application/vnd.google-apps.folder'})],next:'two'},'root:two':{files:[file('two',{mimeType:'image/tiff'})],next:null},'sub:':{files:[file('three')],next:null}}});
  const result=await h.scanLibrary(h.db,{trigger:'manual',discoverOnly:true});
  assert.match(result,/3 new or changed/);assert.equal(h.tables.design_refs.length,3);assert.equal(h.tables.design_library_folders.length,2);assert.equal(h.calls.model,0);assert.equal(h.calls.upload,0);
  assert.equal(h.tables.sync_cursors[0].state.counts.pendingFolders,0);assert.equal(h.tables.sync_cursors[0].state.state,'queued');
});
test('real runner follows more than 200 file results without changing or dropping the page cursor',async()=>{
  const h=harness({pages:{'root:':{files:Array.from({length:200},(_,i)=>file(`first${i}`)),next:'page2'},'root:page2':{files:Array.from({length:37},(_,i)=>file(`second${i}`)),next:null}}});
  await h.scanLibrary(h.db,{trigger:'manual',discoverOnly:true});assert.equal(h.tables.design_refs.length,237);assert.equal(h.tables.design_library_folders[0].files,237);assert.deepEqual(h.calls.drive,[['root',null],['root','page2']]);assert.equal(h.calls.model,0);
});
test('a failed folder backoff survives another successfully completed folder checkpoint',async()=>{
  const h=harness({folders:[folder('bad'),folder('good')],pages:{'bad:':new Error('Drive unavailable'),'good:':{files:[file('good')],next:null}}});
  await h.scanLibrary(h.db,{trigger:'manual',discoverOnly:true});assert.ok(h.tables.sync_cursors[0].state.folderRetries.bad.retryAfter);assert.equal(h.tables.design_library_folders[0].scanned_at,null);assert.ok(h.tables.design_library_folders[1].scanned_at);
  const before=h.calls.drive.length;await h.scanLibrary(h.db,{trigger:'manual',discoverOnly:true});assert.equal(h.calls.drive.length,before);
});
test('partial insert then checkpoint failure is safely replayed with no duplicate references',async()=>{
  const h=harness({pages:{'root:':{files:[file('one')],next:null}},failWrite:(table,op,payload)=>table==='design_library_folders'&&op==='update'&&payload.scanned_at});
  await h.scanLibrary(h.db,{trigger:'manual',discoverOnly:true});assert.equal(h.tables.design_refs.length,1);assert.equal(h.tables.design_library_folders[0].scanned_at,null);
  await h.resetLibraryScan(h.db);await h.scanLibrary(h.db,{trigger:'manual',discoverOnly:true});
  assert.equal(h.tables.design_refs.length,1);assert.ok(h.tables.design_library_folders[0].scanned_at);assert.equal(h.calls.model,0);
});
test('manual resume preserves completed folders and active page tokens, busy requests change nothing',async()=>{
  const h=harness({folders:[folder('done',{scanned_at:'2026-10-26T01:00:00Z',files:8}),folder('pending',{page_token:'second',files:200})],progress:{name:'design_library',state:{version:2}}});
  const result=await h.resetLibraryScan(h.db);assert.equal(result.busy,false);assert.equal(h.tables.design_library_folders[0].scanned_at,'2026-10-26T01:00:00Z');assert.equal(h.tables.design_library_folders[1].page_token,'second');
  const busy=harness({busy:true});assert.equal((await busy.resetLibraryScan(busy.db)).busy,true);await busy.scanLibrary(busy.db);assert.deepEqual(busy.calls.writes,[]);assert.equal(busy.calls.model,0);
});
test('resuming queued or failed image studies does not reset completed folder inventories',async()=>{
  for(const status of ['new','failed']) {
    const h=harness({folders:[folder('done',{scanned_at:'2026-10-26T01:00:00Z',files:8})],refs:[{id:'x',drive_id:'x',status,modified_at:null}]});
    await h.resetLibraryScan(h.db);assert.equal(h.tables.design_library_folders[0].scanned_at,'2026-10-26T01:00:00Z');assert.equal(h.tables.design_library_folders[0].files,8);assert.equal(h.tables.design_refs[0].status,'new');
  }
});
test('interrupted paid claims become explicit failures, while completed references are preserved',async()=>{
  const refs=[{id:'a',drive_id:'a',status:'new',modified_at:'2026-10-20T00:00:00Z'},{id:'b',drive_id:'b',status:'ready',modified_at:null}];
  const h=harness({folders:[],refs,progress:{name:'design_library',state:{version:2,claims:[{id:'a',driveId:'a',modifiedAt:refs[0].modified_at},{id:'b',driveId:'b',modifiedAt:null}]}}});
  await h.scanLibrary(h.db,{trigger:'manual'});assert.equal(h.tables.design_refs[0].status,'failed');assert.equal(h.tables.design_refs[1].status,'ready');assert.equal(h.calls.model,0);
});
test('real study path persists claims before calling model and records model validation failure explicitly',async()=>{
  let h;h=harness({pages:{'root:':{files:[file('a'),file('b')],next:null}},model:()=>{assert.equal(h.tables.sync_cursors[0].state.claims.length,1);return {keep:true};}});
  await h.scanLibrary(h.db,{trigger:'manual',studyLimit:1});assert.equal(h.calls.model,1);assert.equal(h.calls.upload,0);assert.equal(h.tables.design_refs.filter(r=>r.status==='failed').length,1);assert.equal(h.tables.design_refs.filter(r=>r.status==='new').length,1);
  assert.ok(h.calls.writes.some(w=>w.table==='sync_cursors'&&w.payload.state?.claims?.length===1));
});
test('provider-wide quota errors block further paid batches while discovery and queued files remain intact',async()=>{
  const h=harness({pages:{'root:':{files:Array.from({length:20},(_,i)=>file(`file${i}`)),next:null}},model:()=>{throw Object.assign(new Error('Quota exhausted'),{code:'quota'});}});
  await h.scanLibrary(h.db,{trigger:'manual'});assert.ok(h.calls.model>0&&h.calls.model<=4);assert.equal(h.tables.design_refs.filter(r=>r.status==='new').length,20);assert.equal(h.tables.sync_cursors[0].state.state,'blocked');
  const calls=h.calls.model;await h.scanLibrary(h.db,{trigger:'manual'});assert.equal(h.calls.model,calls);assert.equal(h.tables.sync_cursors[0].state.studyBlock.code,'quota');
  await h.resetLibraryScan(h.db);assert.equal(h.tables.sync_cursors[0].state.studyBlock,null);assert.ok(h.tables.design_library_folders[0].scanned_at);
});
test('lease loss after a model response prevents preview upload and ready writes',async()=>{
  let h;h=harness({pages:{'root:':{files:[file('a')],next:null}},model:()=>{h.tables.job_locks=[];return {keep:true,style:'Gold',layout:'Center'};}});
  await h.scanLibrary(h.db,{trigger:'manual'});assert.equal(h.calls.upload,0);assert.equal(h.tables.design_refs[0].status,'new');assert.equal(h.tables.sync_cursors[0].state.claims.length,1);
});
test('a newer design revision arriving during study is left queued and never overwritten by late output',async()=>{
  let h;h=harness({pages:{'root:':{files:[file('a')],next:null}},model:()=>{h.tables.design_refs[0].modified_at='2026-10-27T00:00:00Z';return {keep:true,style:'Gold',layout:'Center'};}});
  await h.scanLibrary(h.db,{trigger:'manual'});assert.equal(h.calls.upload,0);assert.equal(h.tables.design_refs[0].status,'new');assert.equal(h.tables.design_refs[0].modified_at,'2026-10-27T00:00:00Z');
});
test('paused worker makes no discovery, model call, or progress reset',async()=>{
  const h=harness({pause:true});assert.match(await h.scanLibrary(h.db,{trigger:'manual'}),/paused/);assert.equal(h.calls.model,0);assert.equal(h.calls.drive.length,0);assert.deepEqual(h.calls.writes,[]);
});

test('ChatGPT handoff discovers new references without any Gemini study',async()=>{
 const h=harness({handoff:true,pages:{'root:':{files:[{id:'new-photo',name:'chain.jpg',mimeType:'image/jpeg',modifiedTime:'2026-10-28T00:00:00Z'}],next:null}}});
 const result=await h.scanLibrary(h.db,{trigger:'manual'});
 assert.match(result,/Gemini study is disabled/);assert.equal(h.calls.model,0);assert.equal(h.calls.upload,0);assert.equal(h.tables.design_refs.length,1);assert.equal(h.tables.design_refs[0].status,'new');
});
