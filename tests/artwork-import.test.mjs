import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { boundedFormData, validateArtwork, validOrigin, zipFiles, MAX_BODY_BYTES } from '../src/lib/artwork/import-core.mjs';

for(const [format,mime] of [['png','image/png'],['jpeg','image/jpeg'],['webp','image/webp']]) {
  test(`import validates real ${format} pixels and MIME`,async()=>{
    const bytes=await sharp({create:{width:320,height:400,channels:3,background:'#9c7850'}}).toFormat(format).toBuffer();
    assert.equal((await validateArtwork(bytes,mime)).width,320);
    await assert.rejects(validateArtwork(bytes,'image/svg+xml'),/still PNG/);
    await assert.rejects(validateArtwork(bytes.subarray(0,Math.floor(bytes.length/2)),mime),/still PNG/);
  });
}
test('disguised SVG and undersized images are rejected',async()=>{
  await assert.rejects(validateArtwork(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"></svg>'),'image/png'),/still PNG/);
  const tiny=await sharp({create:{width:20,height:20,channels:3,background:'red'}}).png().toBuffer();
  await assert.rejects(validateArtwork(tiny,'image/png'),/256/);
});
test('origin must match app and cannot be cross-site',()=>{
  const req=headers=>new Request('http://internal/api/import',{headers});
  assert.equal(validOrigin(req({origin:'https://office.example'}),'https://office.example'),true);
  assert.equal(validOrigin(req({origin:'https://evil.example'}),'https://office.example'),false);
  assert.equal(validOrigin(req({origin:'https://office.example','sec-fetch-site':'cross-site'}),'https://office.example'),false);
  assert.equal(validOrigin(req({}),'https://office.example'),false);
});
test('multipart size is bounded before parsing, including absent Content-Length',async()=>{
  const huge=new Request('https://office.test/import',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=x','content-length':String(MAX_BODY_BYTES+1)},body:'x'});
  await assert.rejects(boundedFormData(huge),/20 MiB/);
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_BODY_BYTES+1));c.close();}});
  const streamed=new Request('https://office.test/import',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=x'},body:stream,duplex:'half'});
  await assert.rejects(boundedFormData(streamed),/20 MiB/);
  const form=new FormData();form.set('requestId','request');form.set('file',new File(['abc'],'art.png',{type:'image/png'}));
  const parsed=await boundedFormData(new Request('https://office.test/import',{method:'POST',body:form}));
  assert.equal(parsed.get('requestId'),'request');assert.equal(await parsed.get('file').text(),'abc');
});
test('ZIP contains exact binary files and central directory offsets',()=>{
  const bytes=zipFiles([{name:'brief.txt',data:'hello'},{name:'product-1.png',data:Buffer.from([0,255,15])}]);
  let offset=0;
  for(const [name,data] of [['brief.txt',Buffer.from('hello')],['product-1.png',Buffer.from([0,255,15])]]) {
    assert.equal(bytes.readUInt32LE(offset),0x04034b50);
    const size=bytes.readUInt32LE(offset+18),n=bytes.readUInt16LE(offset+26);
    assert.equal(bytes.subarray(offset+30,offset+30+n).toString(),name);
    assert.deepEqual(bytes.subarray(offset+30+n,offset+30+n+size),data);offset+=30+n+size;
  }
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);
  assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);
  assert.equal(bytes.readUInt32LE(bytes.length-6),offset);
  assert.throws(()=>zipFiles([{name:'../bad',data:'x'}]),/filename/);
});
