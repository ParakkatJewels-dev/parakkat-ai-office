// Pure parts of the design library: reading a Drive folder link, which Drive files are designs, the search words
// for a brief, and how the reference images are labelled for the image model.

/** A Drive folder id from a link (drive.google.com/drive/folders/<id>, ?id=<id>) or the bare id. Null when it is neither. */
export function folderIdFrom(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}

/** Files Drive can make a picture of: images, PDFs, Photoshop and Illustrator files. Video and documents are skipped. */
export const DESIGN_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/vnd.adobe.photoshop', 'application/pdf', 'application/postscript', 'application/illustrator'];
export const isDesignFile = mime => DESIGN_MIMES.includes(mime) || (typeof mime === 'string' && mime.startsWith('image/') && mime !== 'image/gif' && mime !== 'image/svg+xml');

/** Drive's query for one folder's children: its designs and its subfolders, never the bin. */
export function childrenQuery(folderId, since) {
  const types = [...DESIGN_MIMES.map(m => `mimeType = '${m}'`), "mimeType = 'application/vnd.google-apps.folder'"].join(' or ');
  return `'${folderId.replace(/'/g, '')}' in parents and trashed = false and (${types})${since ? ` and modifiedTime > '${since}'` : ''}`;
}

/** A thumbnail link at a size the model can read the type and layout at. Drive's links end in =s220 or similar. */
export const bigThumb = (link, size = 1280) => String(link).replace(/=s\d+(-[a-z0-9-]+)?$/i, '') + `=s${size}`;

const STOP = new Set('a an and the for of on in to with this that from our we is are be it at by as or new week day days instagram post story banner poster web website make design please'.split(' '));
/** Words worth searching the library for, as an OR query websearch_to_tsquery understands. */
export function searchWords(...texts) {
  const words = texts.join(' ').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, 12).join(' or ');
}

/** The one-line summary of a past design that the art director reads, from what the describer saw. */
export function refLine(r, i) {
  return `Reference ${i + 1}${r.occasion ? ` (${r.occasion})` : ''}: ${[r.style, r.layout && `Layout: ${r.layout}`, r.palette && `Palette: ${r.palette}`, r.typography && `Type: ${r.typography}`].filter(Boolean).join(' ')}`;
}

/** Concepts used lately, so the next one is told what not to repeat. Newest first, trimmed, no repeats. */
export function recentConcepts(rows, max = 8) {
  const out = [];
  for (const r of rows) { const c = String(r?.concept || '').trim().replace(/\s+/g, ' ').slice(0, 220); if (c && !out.includes(c)) out.push(c); if (out.length >= max) break; }
  return out;
}

/** The next version's file name: banner.png, then banner-v2.png, banner-v3.png. */
export function versionPath(path, n) {
  const base = String(path).replace(/-v\d+(\.[a-z0-9]+)$/i, '$1');
  return n <= 1 ? base : base.replace(/(\.[a-z0-9]+)?$/i, m => `-v${n}${m}`);
}
