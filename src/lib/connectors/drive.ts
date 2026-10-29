import 'server-only';
import { accessToken, googleConfig } from './google';
import { bigThumb, childrenQuery } from '@/lib/agents/library-core.mjs';
import { libraryAbortable, parseDrivePage } from '@/lib/agents/library-scan-core.mjs';

/**
 * Google Drive, read only, through the same Google sign-in as Ads and Analytics (scope drive.readonly).
 * The design library reads the folders the Super Admin picked and takes a large thumbnail of each design,
 * which Drive makes for images, PDFs and Photoshop files alike, so a 200 MB PSD never has to be downloaded.
 */
const API = 'https://www.googleapis.com/drive/v3';
export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; thumbnailLink?: string; size?: string };

let tok: { at: number; v: string } | null = null;
async function token() {
  if (tok && Date.now() - tok.at < 30 * 6e4) return tok.v;
  const c = await googleConfig();
  if (!c) throw new Error('Google is not connected. Connect it on the Admin page, Connections.');
  tok = { at: Date.now(), v: await accessToken(c.refresh) };
  return tok.v;
}

async function call(path: string, params: Record<string, string>, parentSignal?: AbortSignal) {
  const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
  const auth = await libraryAbortable(token(),signal);
  signal.throwIfAborted();
  const res = await fetch(`${API}/${path}?${new URLSearchParams({ supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...params })}`, { headers: { authorization: `Bearer ${auth}` }, signal });
  const d = await res.json().catch(() => { throw new Error('Google Drive returned an unreadable response. The folder has not been marked complete.'); });
  if (!res.ok) {
    const msg: string = d.error?.message || `status ${res.status}`;
    if (res.status === 403 && /scope|insufficient/i.test(msg)) throw new Error('Google was connected before Drive access was added. Press Reconnect on Google in Admin, Connections, and allow Drive.');
    if (res.status === 403 && /has not been used|disabled/i.test(msg)) throw new Error('Switch on the Google Drive API in the Google Cloud project, then try again.');
    throw new Error(`Google Drive: ${msg}`);
  }
  return d;
}

/** Folders whose name contains the search, for the folder picker. Folders shared with you are included. */
export async function findFolders(q: string) {
  const name = q.trim().replace(/['\\]/g, '');
  const d = await call('files', { q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false${name ? ` and name contains '${name}'` : ''}`,
    fields: 'files(id, name, modifiedTime)', orderBy: 'modifiedTime desc', pageSize: '20', corpora: 'allDrives' });
  return (d.files || []) as { id: string; name: string; modifiedTime?: string }[];
}

export async function folderInfo(id: string) {
  const d = await call(`files/${encodeURIComponent(id)}`, { fields: 'id, name, mimeType' });
  if (d.mimeType !== 'application/vnd.google-apps.folder') throw new Error(`"${d.name}" is a file, not a folder.`);
  return { id: d.id as string, name: d.name as string };
}

/** Every page uses the same full query; unchanged designs are deduplicated before any paid analysis. */
export async function listChildren(folderId: string, pageToken?: string | null, signal?: AbortSignal) {
  const d = await call('files', { q: childrenQuery(folderId), fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,thumbnailLink,size)',
    pageSize: '200', corpora: 'allDrives', ...(pageToken ? { pageToken } : {}) },signal);
  return parseDrivePage(d);
}

/** A design as a picture the model can read: Drive's large thumbnail, else the file itself when it is a small image. */
export async function designImage(f: DriveFile, parentSignal?: AbortSignal): Promise<{ data: Buffer; mimeType: string }> {
  const signal = parentSignal ? AbortSignal.any([parentSignal,AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const auth = { authorization: `Bearer ${await libraryAbortable(token(),signal)}` };
  const image = async (response: Response, fallback: string) => {
    const mimeType = response.headers.get('content-type')?.split(';')[0] || fallback;
    if (!mimeType.startsWith('image/')) throw new Error('Drive returned a non-image preview.');
    const max = 12_000_000;
    if (Number(response.headers.get('content-length') || 0) > max) { await response.body?.cancel(); throw new Error('The Drive preview exceeds the 12 MB limit.'); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Drive returned an empty preview.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const {done,value} = await libraryAbortable(reader.read(),signal); if (done) break;
        size += value.byteLength; if (size > max) throw new Error('The Drive preview exceeds the 12 MB limit.'); chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!size) throw new Error('Drive returned an empty preview.');
    return {data:Buffer.concat(chunks),mimeType};
  };
  if (f.thumbnailLink) {
    const r = await fetch(bigThumb(f.thumbnailLink), { headers: auth, signal });
    if (r.ok) return image(r,'image/jpeg');
  }
  if (f.mimeType.startsWith('image/') && f.size && Number(f.size) > 0 && Number(f.size) < 12e6) {
    const r = await fetch(`${API}/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`, { headers: auth, signal });
    if (r.ok) return image(r,f.mimeType);
  }
  throw new Error('Drive has no preview of this file yet.');
}

export async function designImageById(id: string, signal?: AbortSignal, expectedModified?: string | null) {
  const file=await call(`files/${encodeURIComponent(id)}`,{fields:'id,name,mimeType,thumbnailLink,size,modifiedTime'},signal) as DriveFile;
  if(expectedModified&&(!file.modifiedTime||!Number.isFinite(Date.parse(expectedModified))||Date.parse(expectedModified)!==Date.parse(file.modifiedTime)))throw new Error('This Drive file revision could not be verified against discovery. Read its folders again before using this reference.');
  return designImage(file,signal);
}
