import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import {libraryStudyBlock} from '../src/lib/agents/library-scan-core.mjs';
import {geminiImageGenerationConfig} from '../src/lib/llm/gemini-core.mjs';
import {geminiImageBilling} from '../src/lib/usage-cost.mjs';
function geminiHarness(handoff=false){
 const state={denied:false,reservations:[],requests:[],imageReservations:0,usage:null,usageRows:[],metadata:{promptTokenCount:50,candidatesTokenCount:10,thoughtsTokenCount:5},parts:[{text:'{"ok":true}'},{inlineData:{mimeType:'image/png',data:'image'}}],configReads:0,config:{apiKey:'fixture',imageModel:'gemini-3-pro-image',imageSize:'2K',textModel:'gemini-3.8-flash'}};
 const modules={'@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>handoff},'server-only':{},'node:crypto':crypto,'@/lib/env':{opt:(_k,f)=>f},'@/lib/usage':{recordUsage:async row=>{state.usageRows.push(row);}},'@/lib/usage-cost.mjs':{geminiImageBilling},'@/lib/pause':{checkPause:async()=>{}},
 './gemini-config':{getGeminiConfig:async()=>{state.configReads++;return state.config;},recordGeminiImageResult:async()=>{}},
 './gemini-core.mjs':{GeminiError:Error,geminiImageGenerationConfig,geminiImage:()=>({data:Buffer.from('image'),mimeType:'image/png'}),geminiRequest:async r=>{state.requests.push(r);return {usageMetadata:state.metadata,candidates:[{content:{parts:state.parts}}]};}},
 '@/lib/agents/agent-instructions':{agentPrompt:async(_db,_id,p)=>p},'@/lib/agents/agent-instructions-core.mjs':{agentPromptId:()=>null},
 '@/lib/agents/agent-work':{withModelWork:(_s,_o,work)=>work()},
 '@/lib/ai-budget':{runAiBudgetedText:async(input,work)=>{state.reservations.push(input);if(state.denied)throw Object.assign(new Error('Waiting for allowance'),{code:'ai_budget'});return work({signal:AbortSignal.timeout(10000),maxOutputTokens:512,reportUsage:u=>{state.usage=u;}});},runAiBudgetedImage:async work=>{state.imageReservations++;if(state.denied)throw new Error('Image allowance');return work();}},
 };
 const source=readFileSync(new URL('../src/lib/llm/gemini.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports','require',compiled)(exports,n=>{assert.ok(n in modules,n);return modules[n];});return {state,api:exports};
}
test('direct Gemini vision is admitted once with media identity, conservative reservation and actual reasoning usage',async()=>{
 const h=geminiHarness();const r=await h.api.geminiJSON('Review',[{inlineData:{mimeType:'image/png',data:'private-image-bytes'}}],{db:{},id:'outputQc'});
 assert.equal(r.ok,true);assert.equal(h.state.reservations.length,1);assert.equal(h.state.reservations[0].extraInputTokens,8192);
 assert.ok(!h.state.reservations[0].user.includes('private-image-bytes'));assert.equal(h.state.requests[0].body.generationConfig.maxOutputTokens,512);
 assert.deepEqual(h.state.usage,{inputTokens:50,outputTokens:15,usageKnown:true});
});
test('budget rejection prevents direct text, vision and image network calls',async()=>{
 const h=geminiHarness();h.state.denied=true;
 await assert.rejects(h.api.geminiText('Trend review'),/allowance/);
 await assert.rejects(h.api.geminiJSON('Review',[],{db:{},id:'outputQc'}),/allowance/);
 await assert.rejects(h.api.generateGeminiTestImage(),/allowance/);
 assert.equal(h.state.requests.length,0);assert.equal(h.state.imageReservations,1);
});
test('Gemini chat owns one admission and capped output',async()=>{
 const h=geminiHarness();assert.deepEqual(await h.api.geminiChat('worker','Instructions','Evidence'),{ok:true});
 assert.equal(h.state.reservations.length,1);assert.equal(h.state.requests.length,1);
});

test('all image entry points use one captured model, key and explicit resolution',async()=>{
 const h=geminiHarness(),photo={inlineData:{mimeType:'image/png',data:'product'}},ref={inlineData:{mimeType:'image/png',data:'style'}};
 h.state.config={...h.state.config,imageModel:'gemini-nano-banana-2.1',imageSize:'4K'};
 await h.api.bannerImage('Brand campaign',[],'4:5',[photo],[{text:'Fingerprint'},ref],{db:{},id:'designer'});
 await h.api.carouselStyleBackground([{text:'Fingerprint'},ref],{db:{},id:'designer'});
 await h.api.generateGeminiTestImage();
 assert.equal(h.state.configReads,3,'configuration must be captured once per image operation');
 assert.equal(h.state.requests.length,3);assert.equal(h.state.imageReservations,3);
 assert.ok(h.state.requests.every(request=>request.model==='gemini-nano-banana-2.1'&&request.apiKey==='fixture'));
 assert.deepEqual(h.state.requests.map(request=>request.body.generationConfig.imageConfig),[
   {aspectRatio:'4:5',imageSize:'4K'},{aspectRatio:'4:5',imageSize:'4K'},{aspectRatio:'1:1',imageSize:'4K'},
 ]);
 const parts=h.state.requests[0].body.contents[0].parts;
 assert.ok(parts.includes(photo)&&parts.includes(ref));
 assert.match(parts.find(part=>part.text?.startsWith('STYLE REFERENCES')).text,/fingerprints/i);
});
test('library usage deferral blocks study without marking an unreviewed image failed',()=>{
 assert.equal(libraryStudyBlock({code:'ai_budget',message:'Wait for allowance'}).code,'ai_budget');
});
test('Pro image calls preserve total output usage and bill final images separately from text and thinking',async()=>{
 const h=geminiHarness();
 h.state.metadata={promptTokenCount:1000,candidatesTokenCount:1170,thoughtsTokenCount:100,candidatesTokensDetails:[{modality:'IMAGE',tokenCount:1120},{modality:'TEXT',tokenCount:50}]};
 h.state.parts.unshift({thought:true,inlineData:{mimeType:'image/png',data:'interim'}});
 await h.api.generateGeminiTestImage();
 const row=h.state.usageRows[0];
 assert.equal(row.output,1270);assert.equal(row.billingOutput,150);assert.equal(row.units,1);
 assert.equal(row.imageCharge.priceKey,'gemini:gemini-3-pro-image-image-2k');
 assert.equal(row.costNote,undefined);assert.equal(h.state.requests.length,1);
});
test('existing Flash image accounting is unchanged',async()=>{
 const h=geminiHarness();h.state.config.imageModel='gemini-3.1-flash-image';
 await h.api.generateGeminiTestImage();
 assert.equal(h.state.usageRows[0].output,15);assert.equal(h.state.usageRows[0].billingOutput,undefined);
 assert.equal(h.state.usageRows[0].imageCharge,undefined);
});

test('ChatGPT handoff blocks every Gemini generation entry before admission or network',async()=>{
 const h=geminiHarness(true), agent={db:{},id:'designer'};
 for(const work of [()=>h.api.geminiText('x'),()=>h.api.geminiChat('worker','x','x'),()=>h.api.geminiJSON('x',[],agent),()=>h.api.generateGeminiTestImage(),()=>h.api.bannerImage('x',[],'1:1',[],[],agent),()=>h.api.carouselStyleBackground([{text:'style'}],agent)]) await assert.rejects(work,/Gemini calls are disabled/);
 assert.equal(h.state.requests.length,0);assert.equal(h.state.reservations.length,0);assert.equal(h.state.imageReservations,0);
});
