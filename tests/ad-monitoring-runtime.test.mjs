import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as core from '../src/lib/connectors/ad-monitoring-core.mjs';
function metaHarness(fetcher){
 const state={snapshots:[],failed:[],selected:[]};
 const modules={'server-only':{},'@/lib/env':{opt:(_k,f)=>f},'./vault':{loadAccess:async()=>({tokens:{access_token:'fixture-token'},settings:{ad_account_ids:['123']}})},
 './accounts.mjs':{chosen:values=>values||[],metaId:id=>String(id).replace(/^act_/, '')},'@/lib/errors':{errText:e=>e.message},'./ad-monitoring-core.mjs':core,
 './ad-monitoring-store':{deselectAdAccounts:async(_d,_p,ids)=>{state.selected=ids;},storeAdSnapshot:async(...args)=>state.snapshots.push(args),recordAdReadFailure:async(_d,_p,id)=>state.failed.push(id)}};
 const source=readFileSync(new URL('../src/lib/connectors/meta.ts',import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports','require','fetch',compiled)(exports,n=>{assert.ok(n in modules,n);return modules[n];},fetcher);return {state,run:()=>exports.syncAdInsights({})};
}
const response=(data,ok=true)=>({ok,status:ok?200:500,json:async()=>data});
test('campaign inventory includes campaigns without insights and stores missing purchases as unknown',async()=>{
 const h=metaHarness(async input=>{const u=new URL(input);if(u.pathname.endsWith('/insights'))return response({data:[{date_start:'2026-10-25',campaign_id:'1',ad_id:'10',spend:'20',impressions:'200',clicks:'10'}]});if(u.pathname.endsWith('/campaigns'))return response({data:[{id:'1',name:'Running',status:'ACTIVE',effective_status:'ACTIVE'},{id:'2',name:'No delivery yet',status:'PAUSED'}]});return response({id:'act_123',currency:'INR',timezone_name:'Asia/Kolkata'});});
 await h.run();assert.equal(h.state.snapshots.length,1);const [,provider,account,campaigns,metrics,coverage]=h.state.snapshots[0];
 assert.equal(provider,'meta');assert.equal(account,'123');assert.equal(campaigns.length,2);assert.equal(metrics[0].purchases,null);assert.equal(metrics[0].revenue,null);assert.equal(coverage.inventory_complete,true);
});
test('a failed second inventory page never commits partial inventory or clears previous metrics',async()=>{
 const h=metaHarness(async input=>{const u=new URL(input);if(u.searchParams.has('after'))return response({error:{message:'read failed'}},false);if(u.pathname.endsWith('/campaigns'))return response({data:[{id:'1'}],paging:{next:'https://graph.facebook.com/v21.0/act_123/campaigns?after=2'}});return response({id:'act_123',currency:'INR',timezone_name:'Asia/Kolkata'});});
 await assert.rejects(h.run(),/could not be fully read/);assert.equal(h.state.snapshots.length,0);assert.deepEqual(h.state.failed,['123']);
});
test('unexpected pagination hosts are not fetched with provider credentials',async()=>{
 let unsafe=false;
 const h=metaHarness(async input=>{const u=new URL(input);if(u.hostname!=='graph.facebook.com')unsafe=true;if(u.pathname.endsWith('/campaigns'))return response({data:[],paging:{next:'https://untrusted.invalid/next?access_token=fixture-token'}});return response({currency:'INR',timezone_name:'Asia/Kolkata'});});
 await assert.rejects(h.run());assert.equal(unsafe,false);assert.equal(h.state.snapshots.length,0);
});
