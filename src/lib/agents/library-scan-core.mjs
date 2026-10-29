// Pure, testable discovery/checkpoint rules. A page is committed only after every child was recorded.
export const LIBRARY_LIMITS = Object.freeze({ pages: 50, discoveryMs: 85_000, workMs: 230_000, leaseSeconds: 260, study: 12, concurrency: 4, imageMs: 40_000, scheduleMs: 540_000 });

export function parseDrivePage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Drive returned an invalid folder page.');
  if (value.incompleteSearch === true) throw new Error('Drive returned an incomplete folder search. The folder remains pending; reconnect or retry it.');
  if (value.files !== undefined && !Array.isArray(value.files)) throw new Error('Drive returned an invalid file list.');
  const files = value.files || [];
  if (files.some(f => !f || typeof f.id !== 'string' || !f.id || typeof f.name !== 'string' || typeof f.mimeType !== 'string')) throw new Error('Drive returned incomplete file metadata.');
  if (value.nextPageToken !== undefined && (typeof value.nextPageToken !== 'string' || !value.nextPageToken)) throw new Error('Drive returned an invalid next-page cursor.');
  return { files, next: value.nextPageToken || null };
}

export function changedDesigns(rows, known) {
  const previous = new Map(known.map(r => [r.drive_id, r]));
  return {
    fresh: rows.filter(r => !previous.has(r.drive_id)),
    // Missing old timestamps must not prevent a newly available revision from being studied.
    changed: rows.filter(r => previous.has(r.drive_id) && r.modified_at && r.modified_at !== previous.get(r.drive_id).modified_at &&
      (!previous.get(r.drive_id).modified_at || Date.parse(r.modified_at) > Date.parse(previous.get(r.drive_id).modified_at))),
  };
}

export const sameLibraryRevision = (current, claim) => !!current && current.status === 'new' && current.drive_id === claim.driveId && (current.modified_at || null) === (claim.modifiedAt || null);
export const invalidDrivePageToken = error => /(?:invalid|expired|rejected).*page.?token|page.?token.*(?:invalid|expired|rejected)/i.test(String(error?.message || error));
export const libraryRetryAt = (attempts, now = Date.now()) => new Date(now + Math.min(6 * 3_600_000, 540_000 * 2 ** Math.min(6, Math.max(0, attempts - 1)))).toISOString();
export function libraryStudyBlock(error) {
  const code = ['ai_budget','missing_key','invalid_key','quota','authentication','model_unavailable','invalid_model','invalid_request'].includes(error?.code) ? error.code : error?.name === 'AgentRuntimeError' ? 'instructions_unavailable' : null;
  return code ? {code,reason:`Image study is blocked: ${String(error.message || 'Check the image provider configuration.').slice(0,250)} After fixing it, use Resume study to retry.`,at:new Date().toISOString()} : null;
}

/** Durable adapters must preserve the cursor when savePage fails; retries then replay idempotently. */
export async function discoverLibrary({ nextFolder, list, savePage, failFolder, check, shouldStop = () => false, now = Date.now, maxPages = LIBRARY_LIMITS.pages, maxMs = LIBRARY_LIMITS.discoveryMs }) {
  const start = now(), attempted = new Set();
  let pages = 0, found = 0, foldersRead = 0, failures = 0;
  while (pages < maxPages && now() - start < maxMs && !shouldStop()) {
    await check();
    const folder = await nextFolder(attempted);
    if (!folder) break;
    try {
      const page = await list(folder);
      await check();
      const result = await savePage(folder, page);
      pages++; found += result.found;
      if (!page.next) { foldersRead++; attempted.add(folder.id); }
    } catch (error) {
      // If the deadline/lease/pause was lost, do not write failure checkpoints from an old owner.
      await check();
      // The discovery budget ending is normal continuation, not a failed folder/provider request.
      if (shouldStop()) break;
      failures++; attempted.add(folder.id);
      await failFolder(folder, error, invalidDrivePageToken(error));
    }
  }
  return { pages, discovered: found, foldersRead, failures };
}

export function libraryDescription(value) {
  if (!value || typeof value !== 'object' || typeof value.keep !== 'boolean') throw new Error('The image review did not say whether this is a finished design.');
  const text = (v, max = 1500) => typeof v === 'string' ? Array.from(v.trim()).slice(0, max).join('') : '';
  if (value.keep && (!text(value.style) || !text(value.layout))) throw new Error('The image review was missing its style or layout.');
  const fingerprint = {
    visualBrief: text(value.fingerprint?.visualBrief || value.style, 1200),
    composition: text(value.fingerprint?.composition || value.layout, 1000),
    palette: text(value.fingerprint?.palette || value.palette, 500),
    lighting: text(value.fingerprint?.lighting, 500),
    materials: text(value.fingerprint?.materials, 500),
    typography: text(value.fingerprint?.typography || value.typography, 500),
    productionNotes: text(value.fingerprint?.productionNotes, 800),
    avoid: text(value.fingerprint?.avoid, 500),
  };
  return { keep: value.keep, kind: ['post','story','banner','poster','other'].includes(value.kind) ? value.kind : 'other', occasion: text(value.occasion,160),
    style: text(value.style), palette: text(value.palette,500), layout: text(value.layout), typography: text(value.typography,500),
    tags: Array.isArray(value.tags) ? value.tags.filter(t => typeof t === 'string').slice(0,10).map(t => text(t,80)).filter(Boolean) : [],
    quality: Math.max(1, Math.min(5, Math.round(Number(value.quality) || 3))), fingerprint };
}

/** Consume the underlying promise even when cancellation arrived before handlers were attached. */
export function libraryAbortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason || new Error('Library work was interrupted.'));
    Promise.resolve(promise).then(resolve,reject).finally(() => signal.removeEventListener('abort',aborted));
    if (signal.aborted) aborted(); else signal.addEventListener('abort',aborted,{once:true});
  });
}
