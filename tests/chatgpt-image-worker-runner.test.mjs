import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, chmod, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { childEnvironment, codexArguments, validateJob, pngInfo, sha256, prepareJob, atomicJson, createWorker as createRealWorker, runCodex, readOutput, createApi, collectNativeOutput, createThreadParser, generationPrompt } from '../deploy/chatgpt-image-worker/worker-core.mjs';
const createWorker=options=>createRealWorker({checkLogin:async()=>{},...options,...(options.generate?{generate:async args=>(await options.generate(args))||{threadId:ids.holder,sha256:sha256(png)}}:{})});

const ids={jobId:'12345678-1234-4234-8234-123456789001',holder:'12345678-1234-4234-8234-123456789002',itemId:'12345678-1234-4234-8234-123456789003',requestId:'12345678-1234-4234-8234-123456789004'};
const png=await sharp({create:{width:512,height:512,channels:3,background:'#d4ac55'}}).png().toBuffer();
const job=()=>({...ids,source:'design',packet:{source:'design',id:ids.itemId,requestId:ids.requestId,prompt:'Create a clean jewellery image from the supplied product photograph.'},files:[{name:'product-1.png',base64:png.toString('base64'),sha256:sha256(png)}]});
async function temp(t){const directory=await mkdtemp(path.join(os.tmpdir(),'chatgpt-worker-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
const statePath=root=>path.join(root,'control',ids.jobId,'state.json');
async function nativeFixture(root,threadId=ids.holder){const codeHome=path.join(root,'codex-auth'),session=path.join(codeHome,'generated_images',threadId);await mkdir(session,{recursive:true});await writeFile(path.join(session,'exec-native.png'),png);return {codeHome,session};}

test('Codex receives an allowlist environment and subscription-only flags',()=>{
  const clean=childEnvironment({HOME:'/home/node',PATH:'/usr/bin',CODEX_HOME:'/auth',TMPDIR:'/tmp',LANG:'C.UTF-8',SSL_CERT_FILE:'/etc/ssl/certs/ca-certificates.crt',OPENAI_API_KEY:'paid',CODEX_API_KEY:'paid2',CODEX_ACCESS_TOKEN:'token',CHATGPT_IMAGE_WORKER_SECRET:'internal',SUPABASE_SERVICE_ROLE_KEY:'db',NODE_OPTIONS:'--require malicious.js'});
  assert.deepEqual(clean,{HOME:'/home/node',PATH:'/usr/bin',CODEX_HOME:'/auth',TMPDIR:'/tmp',LANG:'C.UTF-8',SSL_CERT_FILE:'/etc/ssl/certs/ca-certificates.crt'});
  const args=codexArguments('/work/a');
  assert.ok(args.includes('forced_login_method="chatgpt"'));assert.ok(args.includes('features.image_generation=true'));
  assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('--ignore-rules'));assert.ok(args.includes('workspace-write'));
  assert.ok(!args.includes('--with-api-key'));assert.throws(()=>codexArguments('/work/a',{sandbox:'unexpected'}));
  assert.equal(childEnvironment({SSL_CERT_FILE:'/tmp/arbitrary-ca.pem'}).SSL_CERT_FILE,undefined);
});

test('the native tool prompt includes the full brief and ordered absolute references without requiring a shell',()=>{
  const manifest=validateJob(job()).manifest,prompt=generationPrompt(manifest,'/work/job');
  assert.ok(prompt.includes(manifest.packet.prompt));assert.match(prompt,/\/work\/job\/inputs\/product-1\.png/);assert.match(prompt,/Do not call terminal/);assert.match(prompt,/supervisor collects/);assert.ok(codexArguments('/work/job').includes('--json'));
});

test('only a top-level trusted thread.started JSON event sets the native session',()=>{
  const parser=createThreadParser();
  parser.push(`${JSON.stringify({type:'item.completed',item:{text:JSON.stringify({type:'thread.started',thread_id:ids.itemId})}})}\n`);assert.equal(parser.threadId,null);
  const event=`${JSON.stringify({type:'thread.started',thread_id:ids.holder})}\n`;assert.equal(parser.push(event.slice(0,15)),null);assert.equal(parser.push(event.slice(15)),ids.holder);
  parser.push(`${JSON.stringify({type:'thread.started',thread_id:ids.itemId})}\n`);assert.equal(parser.threadId,ids.holder);
});

test('native collection selects only the exact thread and accepts an existing output only with the same hash',async t=>{
  const root=await temp(t),native=await nativeFixture(root),directory=path.join(root,'result');await mkdir(directory);
  const receipt=await collectNativeOutput({codeHome:native.codeHome,threadId:ids.holder,directory});assert.equal(receipt.sha256,sha256(png));assert.equal(receipt.threadId,ids.holder);assert.equal(receipt.sourceFile,path.join(native.session,'exec-native.png'));
  assert.equal((await collectNativeOutput({codeHome:native.codeHome,threadId:ids.holder,directory})).sha256,receipt.sha256);
  await assert.rejects(collectNativeOutput({codeHome:native.codeHome,threadId:ids.itemId,directory}),error=>error.code==='ENOENT');
  await chmod(path.join(directory,'output.png'),0o600);await writeFile(path.join(directory,'output.png'),Buffer.from('untrusted output'));
  await assert.rejects(collectNativeOutput({codeHome:native.codeHome,threadId:ids.holder,directory}),/does not match/);
});

test('native collection rejects missing receipts, multiple images and symlink files or directories',async t=>{
  const root=await temp(t),native=await nativeFixture(root),directory=path.join(root,'result');await mkdir(directory);
  await assert.rejects(collectNativeOutput({codeHome:native.codeHome,threadId:null,directory}),/receipt/);
  await writeFile(path.join(native.session,'second.png'),png);await assert.rejects(collectNativeOutput({codeHome:native.codeHome,threadId:ids.holder,directory}),/exactly one/);await rm(path.join(native.session,'second.png'));
  await symlink(path.join(native.session,'exec-native.png'),path.join(directory,'output.png'));await assert.rejects(collectNativeOutput({codeHome:native.codeHome,threadId:ids.holder,directory}),/symlink/);await rm(path.join(directory,'output.png'));
  const linkedId=ids.itemId;await symlink(native.session,path.join(native.codeHome,'generated_images',linkedId));await assert.rejects(collectNativeOutput({codeHome:native.codeHome,threadId:linkedId,directory}),/symlinks/);
  await rm(path.join(native.session,'exec-native.png'));await writeFile(path.join(root,'existing.png'),png);await symlink(path.join(root,'existing.png'),path.join(native.session,'exec-native.png'));await assert.rejects(collectNativeOutput({codeHome:native.codeHome,threadId:ids.holder,directory}),/exactly one/);
});

test('a real CLI JSON stream collects native output without any model file-copy command',async t=>{
  const root=await temp(t),native=await nativeFixture(root),directory=path.join(root,'result');await mkdir(directory);const threads=[];
  const receipt=await runCodex({directory,prompt:'one native image',env:{CODEX_HOME:native.codeHome,PATH:process.env.PATH},onThread:async value=>{threads.push(value);},spawnFn:(_binary,args,options)=>{assert.ok(args.includes('--json'));return spawn(process.execPath,['-e',`process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'${ids.holder}'})+'\\n');`],options);}});
  assert.deepEqual(threads,[ids.holder]);assert.equal(receipt.sha256,sha256(png));assert.equal((await readOutput(directory)).sha256,receipt.sha256);
});

test('stderr or model output paths cannot authorize collecting an earlier native image',async t=>{
  const root=await temp(t),native=await nativeFixture(root),directory=path.join(root,'result');await mkdir(directory);await writeFile(path.join(directory,'output.png'),png);
  await assert.rejects(runCodex({directory,prompt:'test',env:{CODEX_HOME:native.codeHome},spawnFn:(_binary,_args,options)=>spawn(process.execPath,['-e',`process.stderr.write(JSON.stringify({type:'thread.started',thread_id:'${ids.holder}'})+'\\n');process.stdout.write(JSON.stringify({type:'item.completed',item:{text:'${native.session}/exec-native.png'}})+'\\n');`],options)}),/receipt/);
});

test('failure to persist the trusted thread receipt stops and drains the child without collection',async t=>{
  const root=await temp(t),native=await nativeFixture(root),directory=path.join(root,'result');await mkdir(directory);let child;
  await assert.rejects(runCodex({directory,prompt:'test',env:{CODEX_HOME:native.codeHome},onThread:async()=>{throw new Error('disk unavailable');},spawnFn:(_binary,_args,options)=>{child=spawn(process.execPath,['-e',`process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'${ids.holder}'})+'\\n');setInterval(()=>{},1000);`],options);return child;}}),/receipt could not be persisted.*uncertain/);
  assert.ok(child.exitCode!==null||child.signalCode!==null);await assert.rejects(readFile(path.join(directory,'output.png')),error=>error.code==='ENOENT');
});

test('restart never imports a model-supplied output with no native receipt',async t=>{
  const root=await temp(t),prepared=await prepareJob(root,job());await writeFile(path.join(prepared.directory,'output.png'),png);await atomicJson(statePath(root),{...prepared.state,phase:'generating',generationStarted:true});
  const calls=[];const worker=createWorker({root,api:async body=>{calls.push(body);return {};}});assert.equal((await worker.recover())[0].result,'uncertain');assert.ok(!calls.some(call=>call.action==='complete'));
});

test('reference bundles reject path traversal, altered bytes, duplicate names and stale request identity',()=>{
  const traversal=job();traversal.files[0].name='../../auth.json';assert.throws(()=>validateJob(traversal),/filename/);
  const altered=job();altered.files[0].sha256='0'.repeat(64);assert.throws(()=>validateJob(altered),/integrity/);
  const duplicate=job();duplicate.files.push({...duplicate.files[0]});assert.throws(()=>validateJob(duplicate),/filename/);
  const stale=job();stale.packet.requestId=ids.holder;assert.throws(()=>validateJob(stale),/prompt/);
  const checked=validateJob(job());assert.equal(checked.files[0].bytes.length,png.length);assert.match(checked.manifestHash,/^[a-f0-9]{64}$/);
});

test('PNG verification rejects truncated or corrupted output and checks dimensions',()=>{
  assert.equal(pngInfo(png).width,512);assert.equal(pngInfo(png).height,512);
  assert.throws(()=>pngInfo(png.subarray(0,png.length-1)),/Truncated/);
  const corrupt=Buffer.from(png);corrupt[40]^=1;assert.throws(()=>pngInfo(corrupt),/Corrupt/);
  assert.throws(()=>pngInfo(Buffer.from('not an image')),/complete PNG/);
});

test('one generation is durably saved and duplicate delivery cannot regenerate it',async t=>{
  const root=await temp(t),calls=[];let generated=0;
  const worker=createWorker({root,api:async body=>{calls.push(body);return {ok:true};},generate:async({directory,prompt,env})=>{generated++;assert.match(prompt,/exactly ONE call/);await writeFile(path.join(directory,'output.png'),png);}});
  assert.equal(await worker.processJob(job()),'completed');
  assert.equal(await worker.processJob(job()),'completed');
  assert.equal(generated,1);assert.equal(calls.filter(call=>call.action==='dispatch').length,1);
  assert.equal(calls.filter(call=>call.action==='complete').length,1);
  assert.equal(JSON.parse(await readFile(statePath(root),'utf8')).phase,'completed');
  assert.equal(calls.find(call=>call.action==='complete').output.sha256,sha256(png));
});

test('a lost completion response retries saved output and never invokes Codex again',async t=>{
  const root=await temp(t);let generated=0,completes=0;
  const api=async body=>{if(body.action==='complete'&&++completes<=2)throw new Error('network interrupted');return {ok:true};};
  const worker=createWorker({root,api,generate:async({directory})=>{generated++;await writeFile(path.join(directory,'output.png'),png);}});
  assert.equal(await worker.processJob(job()),'pending_import');
  assert.equal(JSON.parse(await readFile(statePath(root),'utf8')).phase,'output_ready');
  const restarted=createWorker({root,api,generate:async()=>{throw new Error('must never regenerate');}});
  assert.deepEqual(await restarted.recover(),[{jobId:ids.jobId,result:'completed'}]);assert.equal(generated,1);assert.equal(completes,3);
});

test('a lost dispatch response becomes uncertain before any generator can be repeated',async t=>{
  const root=await temp(t),calls=[];let generated=0;
  const worker=createWorker({root,api:async body=>{calls.push(body);if(body.action==='dispatch')throw new Error('receipt lost');return {};},generate:async()=>{generated++;}});
  assert.equal(await worker.processJob(job()),'uncertain');
  assert.equal(await worker.processJob(job()),'uncertain');assert.equal(generated,0);
  assert.equal(calls.filter(call=>call.action==='dispatch').length,1);
  assert.equal(JSON.parse(await readFile(statePath(root),'utf8')).phase,'uncertain');
});

test('generation timeout remains uncertain and no retry occurs after process restart',async t=>{
  const root=await temp(t);let generated=0;
  const worker=createWorker({root,api:async()=>({}),generate:async()=>{generated++;throw new Error('generation timed out');}});
  assert.equal(await worker.processJob(job()),'uncertain');
  await createWorker({root,api:async()=>({}),generate:async()=>{generated++;}}).recover();
  assert.equal(generated,1);
});

test('a missing ChatGPT login blocks before dispatch without calling any generator',async t=>{
  const root=await temp(t),calls=[];let generated=0;
  const worker=createWorker({root,checkLogin:async()=>{throw new Error('not signed in');},api:async body=>{calls.push(body);return {};},generate:async()=>{generated++;}});
  assert.equal(await worker.processJob(job()),'blocked');assert.equal(generated,0);
  assert.ok(!calls.some(call=>call.action==='dispatch'));assert.equal(calls.at(-1).kind,'preflight');
});

test('explicit preflight retry reuses frozen inputs with the new server lease holder',async t=>{
  const root=await temp(t),calls=[];let signedIn=false,generated=0;
  const worker=createWorker({root,checkLogin:async()=>{if(!signedIn)throw new Error('not signed in');},api:async body=>{calls.push(body);return {};},generate:async({directory})=>{generated++;await writeFile(path.join(directory,'output.png'),png);}});
  assert.equal(await worker.processJob(job()),'blocked');signedIn=true;
  const retried={...job(),holder:'12345678-1234-4234-8234-123456789099'};
  assert.equal(await worker.processJob(retried),'completed');assert.equal(generated,1);
  assert.equal(calls.find(call=>call.action==='dispatch').holder,retried.holder);
  assert.equal(JSON.parse(await readFile(statePath(root),'utf8')).holder,retried.holder);
});

test('server reclaim after an unacknowledged dispatch permits a first generation with a fresh lease',async t=>{
  const root=await temp(t);let paused=true,generated=0;
  const worker=createWorker({root,api:async body=>{if(body.action==='dispatch'&&paused){const error=new Error('paused before dispatch');error.status=409;throw error;}return {};},generate:async({directory})=>{generated++;await writeFile(path.join(directory,'output.png'),png);}});
  assert.equal(await worker.processJob(job()),'uncertain');assert.equal(generated,0);paused=false;
  assert.equal(await worker.processJob({...job(),holder:'12345678-1234-4234-8234-123456789099'}),'completed');assert.equal(generated,1);
});

test('restart can import a complete output left after dispatch without another generation',async t=>{
  const root=await temp(t),prepared=await prepareJob(root,job()),native=await nativeFixture(root);
  await atomicJson(statePath(root),{...prepared.state,phase:'generating',threadId:ids.holder});
  const calls=[];const worker=createWorker({root,childEnv:{CODEX_HOME:native.codeHome},api:async body=>{calls.push(body);return {};},generate:async()=>{throw new Error('must not generate');}});
  assert.deepEqual(await worker.recover(),[{jobId:ids.jobId,result:'completed'}]);assert.equal(calls.length,1);assert.equal(calls[0].action,'complete');
});

test('saved inputs and output hashes cannot change during retries',async t=>{
  const root=await temp(t),prepared=await prepareJob(root,job());
  await chmod(path.join(prepared.directory,'inputs/product-1.png'),0o600);
  await writeFile(path.join(prepared.directory,'inputs/product-1.png'),Buffer.from('changed'));
  await assert.rejects(prepareJob(root,job()),/pixels changed/);
  await writeFile(path.join(prepared.directory,'output.png'),png);
  await atomicJson(statePath(root),{...prepared.state,phase:'output_ready',nativeReceipt:{threadId:ids.holder,sha256:sha256(png)},outputHash:'0'.repeat(64)});
  const calls=[];const results=await createWorker({root,api:async body=>{calls.push(body);return {};}}).recover();
  assert.equal(results[0].result,'uncertain');assert.ok(!calls.some(call=>call.action==='complete'));
});

test('an obsolete request rejects import without regenerating or retaining a retry loop',async t=>{
  const root=await temp(t),prepared=await prepareJob(root,job());
  await atomicJson(statePath(root),{...prepared.state,phase:'generating',nativeReceipt:{threadId:ids.holder,sha256:sha256(png)}});await writeFile(path.join(prepared.directory,'output.png'),png);
  const error=new Error('conflict');error.status=409;
  const worker=createWorker({root,api:async()=>{throw error;}});
  assert.equal((await worker.recover())[0].result,'stale');assert.deepEqual(await worker.recover(),[]);
});

test('an empty queue makes no generation request',async t=>{
  const root=await temp(t);let generated=0;
  const worker=createWorker({root,api:async body=>{assert.equal(body.action,'claim');return {job:null};},generate:async()=>{generated++;}});
  assert.equal((await worker.tick()).result,'idle');assert.equal(generated,0);
});

test('low disk headroom stops new claims without deleting other project data',async t=>{
  const root=await temp(t);let called=0;
  const worker=createWorker({root,diskAvailable:async()=>1024,api:async()=>{called++;return {job:job()};},generate:async()=>{throw new Error('must not generate');}});
  assert.equal((await worker.tick()).result,'disk_headroom_required');assert.equal(called,0);
});

test('subprocess timeout terminates the process and is reported as uncertain',async t=>{
  const directory=await temp(t);let child;
  await assert.rejects(runCodex({directory,prompt:'test',timeoutMs:30,spawnFn:(_binary,_args,options)=>{child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],options);return child;}}),/timed out.*uncertain/);
  assert.ok(child.exitCode!==null||child.signalCode!==null);
});

test('output symlinks are never read as generated images',async t=>{
  const directory=await temp(t),external=path.join(directory,'existing.png');await writeFile(external,png);await symlink(external,path.join(directory,'output.png'));
  await assert.rejects(readOutput(directory),error=>error.code==='ELOOP');
});

test('the API client does not leak provider bodies and refuses credential-bearing URLs',async()=>{
  assert.throws(()=>createApi({url:'https://user:pass@example.com/worker',secret:'x'.repeat(32)}),/endpoint/);
  const api=createApi({url:'https://example.com/api/internal/chatgpt-artwork',secret:'x'.repeat(32),fetchFn:async(_url,options)=>{assert.equal(options.redirect,'error');return new Response('sensitive backend details',{status:503});}});
  await assert.rejects(api({action:'claim'}),error=>error.status===503&&!error.message.includes('sensitive'));
});
