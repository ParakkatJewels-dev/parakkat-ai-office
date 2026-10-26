import 'server-only';
import { accessToken, googleConfig } from './google';
import { bigThumb, childrenQuery } from '@/lib/agents/library-core.mjs';

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

async function call(path: string, params: Record<string, string>) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams({ supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...params })}`, { headers: { authorization: `Bearer ${await token()}` } });
  const d = await res.json().catch(() => ({}));
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

/** One page of a folder's designs and subfolders. since limits a rescan to what changed. */
export async function listChildren(folderId: string, pageToken?: string | null, since?: string | null) {
  const d = await call('files', { q: childrenQuery(folderId, since), fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, thumbnailLink, size)',
    pageSize: '200', corpora: 'allDrives', ...(pageToken ? { pageToken } : {}) });
  return { files: (d.files || []) as DriveFile[], next: (d.nextPageToken || null) as string | null };
}

/** A design as a picture the model can read: Drive's large thumbnail, else the file itself when it is a small image. */
export async function designImage(f: DriveFile): Promise<{ data: Buffer; mimeType: string }> {
  const auth = { authorization: `Bearer ${await token()}` };
  if (f.thumbnailLink) {
    const r = await fetch(bigThumb(f.thumbnailLink), { headers: auth });
    if (r.ok) return { data: Buffer.from(await r.arrayBuffer()), mimeType: r.headers.get('content-type')?.split(';')[0] || 'image/jpeg' };
  }
  if (f.mimeType.startsWith('image/') && Number(f.size || 0) < 12e6) {
    const r = await fetch(`${API}/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`, { headers: auth });
    if (r.ok) return { data: Buffer.from(await r.arrayBuffer()), mimeType: f.mimeType };
  }
  throw new Error('Drive has no preview of this file yet.');
}

export async function designImageById(id: string) {
  return designImage(await call(`files/${encodeURIComponent(id)}`, { fields: 'id, name, mimeType, thumbnailLink, size' }) as DriveFile);
}
