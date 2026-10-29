import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import ts from 'typescript';
import sharp from 'sharp';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import * as core from '../src/lib/artwork/generation-core.mjs';
import * as imageCore from '../src/lib/artwork/import-core.mjs';

const descriptor={id:'gpt_image_2_5',output_type:'image',aspect_ratios:['1:1','4:5'],medias:[{type:'image',roles:['image_references']}],parameters:[{name:'variant',options:['flare','sunburst']},{name:'quality',options:['low','high']},{name:'resolution',options:['1k','2k']}]};
const code=ts.transpileModule(readFileSync(new URL('../src/lib/artwork/generation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const base={id:randomUUID(),source:'design',item_id:randomUUID(),request_id:randomUUID(),requested_by:randomUUID(),provider:'higgsfield',model:'gpt_image_2_5',account_id:'account',settings:{workspaceId:'workspace'},state:'queued',provider_request_id:null,usage:{}};
const providerId=randomUUID(),mediaId=randomUUID();
function harness(options={}) {
  let job={...base,...options.job},paused=false,balanceCalls=0;
  const calls={tools:[],updates:[],uploads:[],completed:[],artwork:[],renewals:[],projects:[],authorized:[],reserved:[]};
  const image=options.image||Buffer.from('reference');
  const bundle={packet:{format:'square',prompt:'Keep the exact chain in product-1.png.'},refs:[{id:'verified-reference'}],files:[{name:'product-1.png',data:image}]};
  const bucket={upload:async(path,bytes,opts)=>{calls.uploads.push({path,bytes,opts});return{error:options.uploadError?{}:null};},download:async()=>({data:new Blob([options.existing||image]),error:null})};
  const query={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{artwork_request_id:base.request_id},error:null})};
  const db={from:()=>query,storage:{from:name=>{assert.equal(name,'creatives');return bucket;}}};
  const auth=async()=>options.connection||{connected:true,accountId:'account',workspaceId:'workspace'};
  const artwork=async(j,files=false)=>{calls.artwork.push(files);if(options.stale&&calls.artwork.length>=options.stale)throw new Error('Request changed');if(options.pauseAt===calls.artwork.length)paused=true;return bundle;};
  const call=async(name,args,opts)=>{
    calls.tools.push({name,args:structuredClone(args),opts});
    if(options.throwAt===name)throw Object.assign(new Error('Connection lost'),{code:options.errorCode});
    switch(name){
      case 'models_get': return options.descriptor||descriptor;
      case 'estimate_image_cost': return {cost:{credits:7,credits_exact:7.5}};
      case 'balance': return {credits:Array.isArray(options.balance)?options.balance[balanceCalls++]:options.balance??100};
      case 'media_upload': return {uploads:[{media_id:mediaId,upload_url:'https://upload.test/ref',method:'PUT',content_type:'image/png'}]};
      case 'media_confirm': return {results:[{media_id:mediaId,status:options.confirmStatus||'confirmed'}]};
      case 'get_preferences': return {auto_create_project:!!options.project};
      case 'create_project': return {project_id:randomUUID(),default_folder_id:randomUUID()};
      case 'generate_image': return options.receipt||{results:[{id:providerId,model:base.model,status:'queued',type:'image'}]};
      case 'jobs_wait': return {jobs:[{job_id:providerId,status:options.providerState||'completed',type:'image',result_url:'https://result.test/image.png'}],poll_after_seconds:20};
      default: throw new Error(`Unexpected tool ${name}`);
    }
  };
  const projectClaim={state:'claimed',id:randomUUID(),token:randomUUID()};
  const jobs={
    authorizeGenerationPreparation:async(_db,input)=>{calls.authorized.push(input);if(options.unauthorized)throw new Error('No access');return{requestId:base.request_id,status:'awaiting_import',carouselId:null,campaignId:null};},
    generationJobForArtwork:async()=>options.existingJob||null,
    reserveGenerationJob:async(_db,input)=>{calls.reserved.push(input);return{...job,settings:input.settings,state:'queued'};},
    renewGenerationLease:async(_db,input)=>{calls.renewals.push(input);if(options.leaseLost)throw new Error('Lease expired');return job;},
    beginGenerationProject:async()=>options.destination||projectClaim,
    commitGenerationProject:async(_db,input)=>{calls.projects.push(input);return{state:'ready',folderId:input.folderId,projectId:input.projectId};},
    failGenerationProject:async()=>({state:'uncertain'}),
    claimGenerationJob:async()=>options.claimNull?null:options.claimTerminal?{...job,state:'uncertain'}:(job={...job,state:job.state==='queued'?'submitting':job.state}),
    updateGenerationJob:async(_db,input)=>{assert.equal(input.expectedState,job.state);calls.updates.push(input);job={...job,state:input.state,provider_request_id:input.providerRequestId||job.provider_request_id};return job;},
    completeGenerationJob:async(_db,input)=>{calls.completed.push(input);job.state='succeeded';return{status:'ready'};},
  };
  const modules={'server-only':{},'node:crypto':{randomUUID,createHash},'@/lib/supabase/admin':{supabaseAdmin:()=>db},'@/lib/higgsfield/auth.mjs':{getHiggsfieldStatus:auth},'@/lib/higgsfield/mcp.mjs':{callHiggsfieldTool:call},'@/lib/agents/design':{FORMATS:{square:{ratio:'1:1'}}},'@/lib/pause':{isPaused:async()=>paused},'./server':{generationArtwork:artwork,ArtworkError:Error},'./import-core.mjs':imageCore,'./generation-core.mjs':core,'./generation-jobs':jobs};
  const exports={};new Function('exports','require',code)(exports,name=>{assert.ok(name in modules,`Unexpected import ${name}`);return modules[name];});
  const worker=exports.createGenerationWorker({call,auth,artwork,publicUrl:async value=>value,fetch:async(_url,init)=>init.method==='PUT'?new Response('',{status:200}):new Response(image,{headers:{'content-type':options.mime||'image/png'}})});
  return{run:()=>worker(db,job),start:extra=>exports.startAutomaticArtwork({source:'design',id:base.item_id,userId:base.requested_by,...extra}),calls,get job(){return job;}};
}
test('generation requires the requested live model quality and references; no quality downgrade',()=>{
  const params=core.generationParams('gpt_image_2_5','4:5',descriptor);
  assert.deepEqual(params,{model:'gpt_image_2_5',aspect_ratio:'4:5',count:1,use_unlim:false,resolution:'2k',variant:'sunburst',quality:'high'});
  for(const broken of [{...descriptor,medias:[]},{...descriptor,medias:[{type:'image',roles:['image']}]},{...descriptor,parameters:[]},{...descriptor,id:'other'}])assert.throws(()=>core.generationParams('gpt_image_2_5','4:5',broken));
  assert.throws(()=>core.generationParams('gpt_image_2_5','9:16',descriptor));
  assert.throws(()=>core.quoteCredits({cost:{credits:4},adjustments:{quality:{used:'low'}}},params));
  assert.equal(core.quoteCredits({cost:{credits:7,credits_exact:7.5}},params),7.5);
  for(const result of [{credits:-1},{credits:'100'},{credits:Infinity},{error:'expired',credits:100}])assert.throws(()=>core.availableCredits(result));
});
test('valid modern provider job UUIDs retain their receipt rather than becoming uncertain',async()=>{
  const id='019a2e19-1234-7123-8123-0123456789ab';
  assert.equal(core.validProviderId(id),true);assert.equal(core.validProviderId('00000000-0000-0000-0000-000000000000'),false);
  const h=harness({receipt:{results:[{id,model:base.model,type:'image'}]}});await h.run();assert.equal(h.job.provider_request_id,id);assert.equal(h.job.state,'submitted');
});
test('media addresses reject local networks, credential URLs, redirects and mixed DNS',async()=>{
  for(const value of ['http://example.com/x','https://localhost/x','https://127.0.0.1/x','https://169.254.169.254/x','https://[::1]/x','https://user:pass@example.com/x','https://example.com:444/x'])await assert.rejects(core.publicMediaUrl(value,async()=>[{address:'127.0.0.1'}]));
  await assert.rejects(core.publicMediaUrl('https://media.test/x',async()=>[{address:'8.8.8.8'},{address:'10.0.0.1'}]));
  assert.equal(await core.publicMediaUrl('https://media.test/x',async()=>[{address:'8.8.8.8'}]),'https://media.test/x');
});
test('media fetch pins public DNS answers and strips auth headers instead of resolving again',async()=>{
  let resolutions=0,checked=false;
  const fetcher=core.createPublicMediaFetcher({resolve:async()=>{resolutions++;return[{address:resolutions===1?'8.8.8.8':'127.0.0.1'}];},request:(url,options,done)=>{
    assert.equal(url.hostname,'media.test');assert.deepEqual(options.headers,{accept:'image/png'});
    options.lookup('media.test',{all:true},(error,answers)=>{assert.equal(error,null);assert.deepEqual(answers,[{address:'8.8.8.8',family:4}]);checked=true;});
    const req=new EventEmitter();req.end=()=>{const stream=Readable.from([Buffer.from('image')]);stream.statusCode=200;stream.headers={'content-type':'image/png'};done(stream);};return req;
  }});
  const response=await fetcher('https://media.test/file',{headers:{accept:'image/png',authorization:'never-forward',cookie:'never-forward'}});
  assert.equal(await response.text(),'image');assert.equal(resolutions,1);assert.equal(checked,true);
});
test('provider quality changes are retained as a warning without losing the receipt',()=>{
  const params=core.generationParams(base.model,'1:1',descriptor);
  const normal={results:[{id:providerId,model:base.model,type:'image',params:{quality:'high'}}]};
  assert.equal(core.receiptQuality(normal,params).warning,undefined);
  const changed=core.receiptQuality({...normal,adjustments:{quality:{used:'low'}}},params);
  assert.match(changed.warning,/different output settings/);assert.equal(changed.actualSettings.quality,'low');
});
test('download validates MIME and streamed size before decoding or storing images',async()=>{
  await assert.rejects(core.readImageResponse(new Response('<html>',{headers:{'content-type':'text/html'}})));
  await assert.rejects(core.readImageResponse(new Response('12345',{headers:{'content-type':'image/png'}}),4));
  const result=await core.readImageResponse(new Response('1234',{headers:{'content-type':'image/png'}}),4);assert.equal(result.bytes.length,4);
});
test('zero credit and changed credit balance never submit a generation',async()=>{
  for(const balance of [0,[100,0]]){
    const h=harness({balance});await h.run();assert.equal(h.job.state,'blocked');assert.equal(h.calls.updates.at(-1).errorCode,'credits');
    assert.ok(!h.calls.tools.some(c=>c.name==='generate_image'));assert.equal(h.calls.completed.length,0);
    if(balance===0)assert.ok(!h.calls.tools.some(c=>c.name==='media_upload'));
  }
});
test('new explicit request authorizes and prepares its missing brief before reserving once',async()=>{
  const h=harness();const result=await h.start({projectScope:`thread:${base.item_id}`});
  assert.equal(result.started,true);assert.equal(h.calls.authorized.length,1);assert.deepEqual(h.calls.artwork,[false]);assert.equal(h.calls.reserved.length,1);
  assert.equal(h.calls.reserved[0].settings.projectScope,`thread:${base.item_id}`);assert.deepEqual(h.calls.tools,[]);
  const denied=harness({unauthorized:true});await assert.rejects(denied.start(),/No access/);assert.deepEqual(denied.calls.artwork,[]);assert.deepEqual(denied.calls.reserved,[]);
});
test('existing jobs preserve their conversation destination without preparing or generating again',async()=>{
  const h=harness({existingJob:{...base,settings:{projectScope:`thread:${base.item_id}`}}});await h.start();
  assert.deepEqual(h.calls.artwork,[]);assert.equal(h.calls.reserved[0].settings.projectScope,`thread:${base.item_id}`);assert.deepEqual(h.calls.tools,[]);
});
test('waiting and uncertain project creation never spend image credits or create replacements',async()=>{
  for(const state of ['waiting','uncertain']){
    const h=harness({project:true,destination:{state,id:randomUUID()}});await h.run();
    assert.ok(!h.calls.tools.some(c=>['create_project','generate_image'].includes(c.name)));assert.equal(h.job.state,state==='waiting'?'queued':'blocked');
  }
  const h=harness({project:true,throwAt:'create_project'});await h.run();assert.equal(h.job.state,'blocked');assert.ok(!h.calls.tools.some(c=>c.name==='generate_image'));
});
test('one explicit request submits once with confirmed reference IDs and stores the receipt',async()=>{
  const h=harness({project:true});assert.equal(await h.run(),'submitted');
  const sent=h.calls.tools.filter(c=>c.name==='generate_image');assert.equal(sent.length,1);
  assert.deepEqual(sent[0].args.params.medias,[{role:'image_references',value:mediaId}]);assert.equal(sent[0].args.params.quality,'high');assert.equal(sent[0].args.params.use_unlim,false);
  assert.equal(h.job.provider_request_id,providerId);assert.equal(h.calls.updates.at(-1).usage.credits,7.5);
  const create=h.calls.tools.find(c=>c.name==='create_project');assert.equal(create.args.idempotency_key,h.calls.projects[0].id);assert.equal(h.calls.renewals.length,1);
  assert.equal(h.calls.artwork.at(-1),false);assert.equal(h.calls.completed.length,0);
});
test('lost generation response and malformed receipt stop as uncertain and never repeat submission',async()=>{
  for(const options of [{throwAt:'generate_image'},{receipt:{results:[]}}]){
    const h=harness(options);assert.equal(await h.run(),'uncertain');assert.equal(h.job.state,'uncertain');
    await h.run();assert.equal(h.calls.tools.filter(c=>c.name==='generate_image').length,1);
  }
});
test('a provider unexpectedly submitting during a quote stops the image request as uncertain',async()=>{
  const h=harness({throwAt:'estimate_image_cost',errorCode:'cost_submission_unexpected'});assert.equal(await h.run(),'uncertain');assert.equal(h.job.state,'uncertain');
  assert.ok(!h.calls.tools.some(c=>c.name==='generate_image'));await h.run();assert.equal(h.calls.tools.filter(c=>c.name==='estimate_image_cost').length,1);
});
test('expired submission intents and already-claimed jobs cause no provider activity',async()=>{
  for(const options of [{claimTerminal:true},{claimNull:true}]){const h=harness(options);await h.run();assert.deepEqual(h.calls.tools,[]);assert.deepEqual(h.calls.updates,[]);}
});
test('stale revisions, pause, changed identity and failed reference upload cannot spend credits',async()=>{
  for(const options of [{stale:3},{pauseAt:3},{connection:{connected:true,accountId:'other',workspaceId:'workspace'}},{throwAt:'media_confirm'},{leaseLost:true}]){
    const h=harness(options);await h.run();assert.ok(!h.calls.tools.some(c=>c.name==='generate_image'));assert.equal(h.job.state,'blocked');
  }
});
test('completed job saves decoded pixels immutably then atomically marks ready for review',async()=>{
  const image=await sharp({create:{width:320,height:320,channels:3,background:'gold'}}).png().toBuffer();
  const h=harness({image,job:{state:'submitted',provider_request_id:providerId}});assert.equal(await h.run(),'succeeded');
  assert.deepEqual(h.calls.tools.map(c=>c.name),['jobs_wait']);assert.equal(h.calls.uploads.length,1);assert.equal(h.calls.uploads[0].opts.upsert,false);
  assert.equal(h.calls.completed[0].path,`higgsfield-generations/design/${base.item_id}/${base.request_id}/${base.id}.png`);
  assert.deepEqual(h.calls.completed[0].refIds,['verified-reference']);assert.equal(h.job.state,'succeeded');
});
test('pending, failed and damaged provider output preserve original job without replacement generation',async()=>{
  for(const options of [{providerState:'in_progress'},{providerState:'failed'},{image:Buffer.from('not an image')}]){
    const h=harness({...options,job:{state:'submitted',provider_request_id:providerId}});await h.run();
    assert.ok(!h.calls.tools.some(c=>c.name==='generate_image'));assert.equal(h.calls.completed.length,0);assert.equal(h.calls.uploads.length,0);
    assert.equal(h.job.provider_request_id,providerId);
  }
});
test('recollecting reuses only identical immutable bytes after ambiguous upload',async()=>{
  const image=await sharp({create:{width:320,height:320,channels:3,background:'gold'}}).png().toBuffer();
  for(const same of [true,false]){
    const h=harness({image,uploadError:true,existing:same?image:Buffer.from('different'),job:{state:'collecting',provider_request_id:providerId}});await h.run();
    assert.equal(h.calls.completed.length,same?1:0);assert.ok(!h.calls.tools.some(c=>c.name==='generate_image'));
  }
});

test('pinned media fetch rejects redirects without contacting the target or retaining the response stream',async()=>{
  let requests=0,destroyed=false;
  const fetcher=core.createPublicMediaFetcher({resolve:async()=>[{address:'8.8.8.8'}],request:(_url,_options,done)=>{
    requests++;
    const request=new EventEmitter();
    request.end=()=>{
      const stream=new Readable({read(){},destroy(error,callback){destroyed=true;callback(error);}});
      stream.statusCode=302;stream.headers={location:'https://169.254.169.254/latest/meta-data/'};
      done(stream);
    };
    return request;
  }});
  await assert.rejects(fetcher('https://media.test/image.png'),/redirects are not allowed/);
  assert.equal(requests,1);assert.equal(destroyed,true);
});

test('pinned media fetch rejects unsafe or empty DNS answers before opening a socket',async()=>{
  for(const addresses of [[],[{address:'127.0.0.1'}],[{address:'8.8.8.8'},{address:'169.254.169.254'}],[{address:'::ffff:127.0.0.1'}],[{address:'fd00::1'}]]){
    let connected=false;
    const fetcher=core.createPublicMediaFetcher({resolve:async()=>addresses,request:()=>{connected=true;throw new Error('Should never open a socket');}});
    await assert.rejects(fetcher('https://media.test/image.png'),/non-public media address/);
    assert.equal(connected,false);
  }
});
