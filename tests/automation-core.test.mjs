import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canManageDepartment,scheduleSlot,mayTransition,validOutcome} from '../src/lib/automation/core.mjs';
import {catalogueChange,assertCatalogueSource,matchesCatalogueCopy} from '../src/lib/automation/catalogue-action.mjs';

test('current department roles govern task access, viewers never manage a department',()=>{
 const departments=[{id:'crm',human_head_role:'crm_head'}];
 assert.equal(canManageDepartment('crm_head','crm',departments),true);
 assert.equal(canManageDepartment('crm_head','catalog',departments),false);
 assert.equal(canManageDepartment('viewer','crm',[{id:'crm',human_head_role:'viewer'}]),false);
 assert.equal(canManageDepartment('super_admin','catalog',departments),true);
});
test('schedule waits for Indian start hour and cadence and has one replay key per slot',()=>{
 const s={enabled:true,local_hour:9,cadence_hours:24,last_queued_at:null};
 assert.equal(scheduleSlot(s,new Date('2026-10-26T03:00:00Z')),null);
 assert.equal(scheduleSlot(s,new Date('2026-10-26T03:30:00Z')),'2026-10-26:0');
 assert.equal(scheduleSlot(s,new Date('2026-10-26T10:00:00Z')),'2026-10-26:0');
 assert.equal(scheduleSlot({...s,last_queued_at:'2026-10-26T03:30:00Z'},new Date('2026-10-27T03:29:59Z')),null);
 assert.equal(scheduleSlot({...s,enabled:false},new Date('2026-10-27T10:00:00Z')),null);
});
test('task decisions cannot retry a running or completed action',()=>{
 assert.equal(mayTransition('running','retry'),false);
 assert.equal(mayTransition('completed','retry'),false);
 assert.equal(mayTransition('failed','retry'),true);
 assert.equal(mayTransition('review','accept'),true);
 assert.equal(mayTransition('queued','complete'),false);
});
test('outcomes require evidence structure and discard unsupported executable actions',()=>{
 assert.throws(()=>validOutcome({status:'completed',summary:'Done',markdown:''}));
 const out=validOutcome({status:'review',summary:'Draft',markdown:'Draft',evidence:[],warnings:[],actions:[{kind:'send_anything',label:'Send',payload:{}},{kind:'follow_up',label:'Prepare',payload:{title:'Draft'}}]});
 assert.equal(out.actions.length,1);assert.equal(out.actions[0].kind,'follow_up');
});
const payload={productId:123,originalTitle:'Old title',sourceUpdatedAt:'2026-10-25T10:00:00Z',title:'Reviewed title',description:'<script>alert(1)</script> & jewellery\nNext line\n\nSecond paragraph',seoTitle:'SEO title',seoDescription:'SEO description'};
test('catalogue copy is escaped plain text, with bounded reviewed fields',()=>{
 const change=catalogueChange(payload);
 assert.equal(change.id,'gid://shopify/Product/123');
 assert.equal(change.descriptionHtml,'<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; jewellery<br>Next line</p><p>Second paragraph</p>');
 for(const invalid of [{...payload,productId:1.5},{...payload,title:''},{...payload,seoTitle:'x'.repeat(71)},{...payload,sourceUpdatedAt:'unknown'}])assert.throws(()=>catalogueChange(invalid));
});
test('catalogue source must match the reviewed product revision and exact saved copy',()=>{
 const source={id:'gid://shopify/Product/123',title:'Old title',updatedAt:payload.sourceUpdatedAt};
 assert.doesNotThrow(()=>assertCatalogueSource(payload,source));
 assert.throws(()=>assertCatalogueSource(payload,{...source,updatedAt:'2026-10-25T10:01:00Z'}));
 assert.throws(()=>assertCatalogueSource(payload,{...source,title:'Someone else edited'}));
 const change=catalogueChange(payload);
 assert.equal(matchesCatalogueCopy({...change},change),true);
 assert.equal(matchesCatalogueCopy({...change,seo:{...change.seo,title:'different'}},change),false);
});

test('workflow requests accept the configured public origin behind a proxy and reject foreign or missing origins',async()=>{
 const {workflowOriginAllowed:allowed}=await import('../src/lib/automation/core.mjs');
 const internal='http://0.0.0.0:3000/api/automations',publicUrl='https://ai-office.parakkatjewels.in';
 assert.equal(allowed(publicUrl,internal,publicUrl),true);
 assert.equal(allowed('https://attacker.example',internal,publicUrl),false);
 assert.equal(allowed(null,internal,publicUrl),false);
 assert.equal(allowed('null',internal,publicUrl),false);
 assert.equal(allowed(publicUrl,internal,'invalid'),false);
 assert.equal(allowed('http://localhost:3000','http://localhost:3000/api/automations',undefined),true);
});
