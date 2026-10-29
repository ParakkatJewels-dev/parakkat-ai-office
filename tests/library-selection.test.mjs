import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as core from '../src/lib/agents/library-core.mjs';
const ref=(id,subject,extra={})=>({id,name:`${subject} design`,style:`Polished ${subject} photography`,tags:[subject],quality:3,pinned:false,kind:'post',palette:'Ivory gold',...extra});
const options={productTitles:['Fine Millennium Chain Gold Layered'],format:'Instagram portrait'};
test('exact jewellery subject outranks pinned high-quality idol, gifting and ring references',()=>{
  const candidates=[ref('idol','idol',{quality:5,pinned:true}),ref('gifts','gifting',{quality:5,pinned:true}),ref('ring','ring',{quality:5,pinned:true}),ref('chain','chain',{quality:2,last_used_at:new Date().toISOString()})];
  assert.equal(core.rankDesignReferences(candidates,['gold layered campaign'],options)[0].id,'chain');
  assert.equal(core.rankDesignReferences(candidates,['Ring'],{limit:1})[0].id,'ring','automatic carousel category remains supported');
});
test('a chain bracelet is not mistaken for the requested necklace and pure subject precedes mixed sets',()=>{
  const direction='Keep the exact chain link pattern and proportions with clean lighting.';
  const rows=[ref('bracelet','chain bracelet',{quality:5,style:'Keep the exact chain link pattern and proportions with clean lighting.'}),ref('necklace','necklace',{quality:3}),ref('set','necklace earrings',{quality:5})];
  assert.equal(core.rankDesignReferences(rows,[direction],{...options,direction})[0].id,'necklace');
});
test('actual chain product references outrank a showroom that only mentions necklaces in its background',()=>{
  const direction='No ceremonial props, badges, offers, or other text.';
  const rows=[ref('showroom','store opening',{style:'Bright showroom with necklaces on wall displays',quality:5}),ref('chain','gold chain',{style:'Chain on a dark bust with festive diyas',quality:3}),ref('necklace','necklace',{quality:5})];
  assert.equal(core.rankDesignReferences(rows,['Chain',direction],{...options,direction})[0].id,'chain');
});
test('manager direction outranks popularity and explicit negative clauses are never positive preferences',()=>{
  const candidates=[ref('temple','chain',{quality:5,pinned:true,style:'Chain on ceremonial temple props with diyas',palette:'Maroon'}),ref('blue','chain',{quality:2,palette:'Deep blue silk',style:'Clean chain on silk with controlled lighting'})];
  const direction='Keep the exact chain. No added jewellery, ceremonial props, badges, offers, or other text. Use deep blue silk.';
  assert.equal(core.rankDesignReferences(candidates,[direction],{...options,direction})[0].id,'blue');
  const queries=core.designReferenceQueries([direction],{...options,direction});
  assert.equal(queries[0],'chain or necklace');assert.doesNotMatch(queries[1],/ceremonial|badges|offers/);assert.match(queries[1],/blue/);
});
test('the best prior reference remains eligible and ties are stable regardless of input order',()=>{
  const best=ref('best','chain',{quality:5}),other=ref('other','chain',{quality:3}),before=structuredClone([other,best]);
  const ranked=core.rankDesignReferences([other,best],['Chain'],{...options,previousIds:['best']});assert.equal(ranked[0].id,'best');
  assert.deepEqual(core.rankDesignReferences([best,other],['Chain'],{...options,previousIds:['best']}),ranked);
  assert.deepEqual([other,best],before);assert.equal(core.rankDesignReferences([],['Chain'],options).length,0);
});
test('supporting references prefer compatible palettes without overruling explicit direction or subject',()=>{
  const ranked=core.rankDesignReferences([ref('a','chain',{palette:'Deep blue silk',quality:5}),ref('b','chain',{palette:'Deep blue silk',quality:2}),ref('c','chain',{palette:'Bright green foliage',quality:4}),ref('d','idol',{palette:'Deep blue silk',quality:5})],['Chain'],options);
  assert.deepEqual(ranked.map(ref=>ref.id),['a','b','c']);
});
const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/agents/library.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness({rows=[],count=rows.length,error=null,supplement=[]}={}){
  const reads=[],marks=[];
  const db={from(table){let targeted=false;const query={select:()=>query,eq:()=>query,not:()=>query,order:()=>query,textSearch:(_field,value)=>{targeted=true;reads.push(value);return query;},limit:n=>{reads.push(n);return query;},then:(resolve,reject)=>Promise.resolve({data:targeted?supplement:rows,count,error}).then(resolve,reject)};assert.equal(table,'design_refs');return query;},rpc:async(name,args)=>{marks.push({name,args});return {error:null};}};
  const exports={};new Function('exports','require',compiled)(exports,id=>id==='./library-core.mjs'?core:{});
  return {reads,marks,run:()=>exports.pickRefs(db,['Chain campaign'],3,['best'],options)};
}
test('real selector reads bounded metadata and preserves the best previous reference without random RPC retrieval',async()=>{
  const h=harness({rows:[ref('idol','idol',{quality:5}),ref('best','chain')]});
  assert.equal((await h.run())[0].id,'best');assert.deepEqual(h.reads,[500]);
  assert.equal(h.marks.length,1);assert.equal(h.marks[0].name,'mark_design_refs_used');assert.equal(h.marks[0].args.p_ids[0],'best');
});
test('large libraries supplement the bounded scan with targeted category metadata',async()=>{
  const h=harness({rows:Array.from({length:500},(_,i)=>ref(`idol-${i}`,'idol')),count:900,supplement:[ref('best','chain')]});
  assert.equal((await h.run())[0].id,'best');assert.deepEqual(h.reads,[500,'chain or necklace',150]);
});
test('library read failure is distinct from a legitimately empty library',async()=>{
  const failed=harness({error:new Error('Database unavailable')});await assert.rejects(failed.run(),/Design library:/);assert.equal(failed.marks.length,0);
  const empty=harness({rows:[]});assert.deepEqual(await empty.run(),[]);assert.equal(empty.marks.length,0);
});
