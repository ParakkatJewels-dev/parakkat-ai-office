import sharp from 'sharp';
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
export const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function validOrigin(request, appUrl) {
  const origins = [new URL(request.url).origin];
  try { if (appUrl) origins.push(new URL(appUrl).origin); } catch {}
  return origins.includes(request.headers.get('origin')) && request.headers.get('sec-fetch-site') !== 'cross-site';
}
/** Bound the multipart body before FormData allocates image buffers. */
export async function boundedFormData(request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;') || !request.body) throw new Error('Choose an image file to import.');
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new Error('The image must be no larger than 20 MiB.');
  const reader = request.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('The image must be no larger than 20 MiB.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), {headers: {'content-type': request.headers.get('content-type')}}).formData();
}
/** Decode all pixels; reject animated, disguised, truncated and oversized inputs. */
export async function validateArtwork(bytes, declaredType) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Choose an image larger than 0 bytes and no larger than 20 MiB.');
  const formats = {png: ['image/png','png'], jpeg: ['image/jpeg','jpg'], webp: ['image/webp','webp']};
  try {
    const input = sharp(bytes, {limitInputPixels: 40_000_000, failOn:'warning', animated:true});
    const info = await input.metadata(), format = formats[info.format];
    if (!format || format[0] !== declaredType || (info.pages || 1) !== 1 || !info.width || !info.height || Math.min(info.width, info.height) < 256 || Math.max(info.width, info.height) > 10000) throw new Error('invalid');
    await input.stats();
    return {mimeType:format[0],extension:format[1],width:info.width,height:info.height};
  } catch { throw new Error('Upload a complete, still PNG, JPEG or WebP image, at least 256 pixels on each side and no more than 40 megapixels.'); }
}

// ZIP STORE: the image files are already compressed. No executable paths or archive dependencies.
const crcTable = Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++) n=(n&1)?0xedb88320^(n>>>1):n>>>1; return n>>>0;});
const crc32 = bytes => {let c=0xffffffff; for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
export function zipFiles(files) {
  const parts=[], directory=[];let offset=0;
  if (files.length > 20) throw new Error('Too many reference files.');
  for (const file of files) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(file.name) || file.name.includes('..')) throw new Error('Invalid archive filename.');
    const name=Buffer.from(file.name), data=Buffer.from(file.data), crc=crc32(data), local=Buffer.alloc(30), central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    parts.push(local,name,data);directory.push(central,name);offset+=local.length+name.length+data.length;
  }
  const central=Buffer.concat(directory), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,central,end]);
}
