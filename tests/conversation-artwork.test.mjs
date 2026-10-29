import test from 'node:test';
import assert from 'node:assert/strict';
import {artworkRevisionIntent,conversationDesignRevision,readConversationArtworks} from '../src/lib/agents/conversation-artwork.mjs';
const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222',three='33333333-3333-4333-8333-333333333333';
const assistant=(metadata,extra={})=>({role:'assistant',metadata,...extra});

test('only explicit visual revision requests enter the image route',()=>{
  for(const value of ['Redesign this poster with a blue background','Make this image more premium','Edit the artwork lighting','New version of this banner'])assert.equal(artworkRevisionIntent(value),true,value);
  for(const value of ['Make it more premium','Revise this caption','Do not redesign this poster','Redesign all five carousel cards','Create a top-selling product poster'])assert.equal(artworkRevisionIntent(value),false,value);
});

test('revision resolves only assistant-linked designs in the supplied private thread',()=>{
  const history=[assistant({design_id:two}),assistant({design_id:one}),{role:'user',metadata:{design_id:three}}];
  assert.equal(conversationDesignRevision('Redesign this poster',history),two);
  assert.equal(conversationDesignRevision(`/studio?made=${one}#d-${one} revise the image`,history),one);
  assert.equal(conversationDesignRevision(`/studio?made=${three}#d-${three} revise the image`,history),null);
  assert.equal(conversationDesignRevision('Redesign this poster',[{role:'user',metadata:{design_id:three}},{role:'assistant',content:`/studio?made=${three}`}]),null,'model/user text is not authority to mutate an artwork');
});

function reader(rows,{readError=null,signError=false}={}){
  const reads=[],signed=[];
  const db={
    from(table){
      assert.equal(table,'designs');
      let field,ids;
      const q={select:columns=>{assert.match(columns,/artwork_request_id/);return q;},in:(key,values)=>{field=key;ids=values;return q;},order:()=>q,limit:value=>{reads.push({field,ids,limit:value});return q;},then:(resolve,reject)=>Promise.resolve({data:rows.filter(row=>ids.includes(row[field])),error:readError}).then(resolve,reject)};
      return q;
    },
    storage:{
      from(bucket){
        assert.equal(bucket,'creatives');
        return {async createSignedUrls(paths,seconds){signed.push({paths,seconds});if(signError)throw new Error('Private storage failure');return {data:paths.map(path=>({path,signedUrl:`https://storage.example/${path}?temporary=true`}))};}};
      },
    },
  };
  return {db,reads,signed};
}

test('chat assets are read and signed only from caller-visible rows referenced by assistant metadata',async()=>{
  const r=reader([{id:one,status:'ready',headline:'Imported chain',image_path:'designs/one.png',artwork_request_id:two,artwork_origin:'chatgpt_import',versions:[{}]}]);
  const messages=[assistant({design_id:one}),assistant({design_id:three}),{role:'user',metadata:{design_id:two}}];
  const result=await readConversationArtworks(r.db,messages);
  assert.equal(result.length,1);assert.equal(result[0].id,one);assert.equal(result[0].version,2);assert.equal(result[0].imported,true);assert.equal(result[0].importProvider,'ChatGPT');
  assert.deepEqual(r.reads,[{field:'id',ids:[three,one],limit:20}]);
  assert.deepEqual(r.signed,[{paths:['designs/one.png'],seconds:3600}]);
  assert.equal(JSON.stringify(result).includes(three),false,'RLS-inaccessible referenced ID has no enriched asset');
});

test('Higgsfield imports keep their actual provenance and pending requests do not invent an image provider',async()=>{
  const r=reader([{id:one,status:'ready',artwork_origin:'higgsfield_import'},{id:two,status:'awaiting_import'}]);
  const result=await readConversationArtworks(r.db,[assistant({design_id:one}),assistant({design_id:two})]);
  const imported=result.find(row=>row.id===one),pending=result.find(row=>row.id===two);
  assert.equal(imported.imported,true);assert.equal(imported.importProvider,'Higgsfield');
  assert.equal(pending.imported,false);assert.equal(pending.importProvider,null);
});

test('automatic Higgsfield output has distinct provenance while a running replacement retains its old preview',async()=>{
  const r=reader([{id:one,status:'ready',artwork_origin:'higgsfield_oauth',image_path:'new.png'},{id:two,status:'generating',artwork_request_id:three,image_path:'previous.png'}]);
  const result=await readConversationArtworks(r.db,[assistant({design_id:one}),assistant({design_id:two})]);
  const ready=result.find(row=>row.id===one),pending=result.find(row=>row.id===two);
  assert.equal(ready.generatedProvider,'Higgsfield');assert.equal(ready.imported,false);assert.equal(ready.importProvider,null);
  assert.equal(pending.status,'generating');assert.equal(pending.requestId,three);assert.match(pending.imageUrl,/previous.png/);assert.equal(pending.generatedProvider,null);
});

test('carousel references load their visible cards and overlapping references are deduplicated',async()=>{
  const r=reader([{id:one,carousel_id:three,carousel_index:1,status:'awaiting_import',artwork_request_id:two,image_path:null},{id:two,carousel_id:three,carousel_index:2,status:'awaiting_import'}]);
  const result=await readConversationArtworks(r.db,[assistant({carousel_id:three}),assistant({design_id:one})]);
  assert.equal(result.length,2);assert.equal(result[0].requestId,two);assert.ok(result.every(row=>row.carouselId===three));assert.equal(r.signed.length,0);
});

test('no references causes no reads; lookup failure signs nothing; image failure does not leak storage details',async()=>{
  const empty=reader([]);assert.deepEqual(await readConversationArtworks(empty.db,[{role:'user',content:`/studio?made=${one}`}]),[]);assert.equal(empty.reads.length,0);
  const denied=reader([{id:one,image_path:'private.png'}],{readError:{message:'private detail'}});assert.deepEqual(await readConversationArtworks(denied.db,[assistant({design_id:one})]),[]);assert.equal(denied.signed.length,0);
  const failed=reader([{id:one,status:'needs_fix',image_path:'one.png',error:'secret provider text'}],{signError:true});const rows=await readConversationArtworks(failed.db,[assistant({design_id:one})]);assert.equal(rows[0].imageUrl,null);assert.equal(rows[0].needsAttention,true);assert.doesNotMatch(JSON.stringify(rows),/secret|Private storage/);
});
