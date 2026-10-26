import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { geminiJSON, type Part } from '@/lib/llm/gemini';
import { has } from '@/lib/env';
import { errText } from '@/lib/errors';
import { withUsage } from '@/lib/usage';
import { designImageById, listChildren, type DriveFile } from '@/lib/connectors/drive';
import { isDesignFile, searchWords } from './library-core.mjs';
import { emit } from './events';

/**
 * The design library: Parakkat's past designs, read from the Drive folders the Super Admin picked.
 * Every few minutes the autopilot reads one page of one folder and has the Banner Designer study a batch of new
 * designs (occasion, style, palette, layout, type, finish). New designs then pick the closest few as references.
 */
export type Ref = { id: string; name: string; image_path: string; occasion: string | null; style: string | null; palette: string | null; layout: string | null; typography: string | null; kind: string | null };
type Described = { keep: boolean; kind: string; occasion: string; style: string; palette: string; layout: string; typography: string; tags: string[]; quality: number };

const RESCAN_H = 24, BATCH = 12;

/** One pass of the library job: read one page of the folder most due, then study up to a batch of new designs. */
export async function scanLibrary(db: SupabaseClient) {
  const { data: folder } = await db.from('design_library_folders').select('id, root_id, name, page_token, scanned_at, files')
    .or(`scanned_at.is.null,page_token.not.is.null,scanned_at.lt.${new Date(Date.now() - RESCAN_H * 36e5).toISOString()}`)
    .order('scanned_at', { ascending: true, nullsFirst: true }).limit(1).maybeSingle();
  let read = 0, found = 0, failed = '';
  if (folder) {
    try {
      // a rescan only asks for what changed since the last full pass (an hour of overlap for clock drift)
      const since = !folder.page_token && folder.scanned_at ? new Date(Date.parse(folder.scanned_at) - 36e5).toISOString() : null;
      const { files, next } = await listChildren(folder.id, folder.page_token, since);
      read = files.length;
      const subs = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
      const designs = files.filter(f => isDesignFile(f.mimeType));
      if (subs.length) await db.from('design_library_folders').upsert(subs.map(f => ({ id: f.id, root_id: folder.root_id, name: `${folder.name} / ${f.name}` })), { onConflict: 'id', ignoreDuplicates: true });
      if (designs.length) {
        const rows = designs.map((f: DriveFile) => ({ drive_id: f.id, folder_id: folder.id, name: f.name, mime: f.mimeType, modified_at: f.modifiedTime || null }));
        // a design changed in Drive is studied again
        const { data: known } = await db.from('design_refs').select('drive_id, modified_at').in('drive_id', rows.map(r => r.drive_id));
        const K = new Map((known || []).map(k => [k.drive_id, k.modified_at]));
        const fresh = rows.filter(r => !K.has(r.drive_id)), changed = rows.filter(r => K.has(r.drive_id) && r.modified_at && K.get(r.drive_id) && Date.parse(r.modified_at) > Date.parse(K.get(r.drive_id)!));
        if (fresh.length) { const { error } = await db.from('design_refs').insert(fresh); if (error) throw error; }
        for (const r of changed) await db.from('design_refs').update({ ...r, status: 'new', error: null }).eq('drive_id', r.drive_id);
        found = fresh.length + changed.length;
      }
      await db.from('design_library_folders').update({ page_token: next, error: null, files: (folder.page_token ? folder.files : 0) + designs.length,
        ...(next ? {} : { scanned_at: new Date().toISOString() }) }).eq('id', folder.id);
    } catch (e) {
      // the folder waits a day instead of failing every few minutes; the error shows in the Library tab
      failed = errText(e);
      await db.from('design_library_folders').update({ error: failed.slice(0, 300), page_token: null, scanned_at: new Date().toISOString() }).eq('id', folder.id);
    }
  }
  const d = await describeNew(db);
  if (d.studied) await emit(db, null, 'think', 'designer', `Studied ${d.studied} past Parakkat design${d.studied === 1 ? '' : 's'} from Drive${d.left ? `, ${d.left} to go` : ''}`);
  if (failed && !d.studied) throw new Error(`${folder!.name}: ${failed}`);
  return folder || d.studied ? `${folder ? `${folder.name}: ${failed ? `failed (${failed.slice(0, 80)})` : `${read} read, ${found} new`}` : 'no folder due'} · ${d.studied} studied${d.left ? `, ${d.left} waiting` : ''}` : 'nothing to do';
}

/** Study a batch of new designs: copy a preview into storage and describe it, a few at a time. */
async function describeNew(db: SupabaseClient) {
  if (!has('GEMINI_API_KEY')) return { studied: 0, left: 0 };
  const { data: todo } = await db.from('design_refs').select('id, drive_id, name, mime').eq('status', 'new').order('created_at').limit(BATCH);
  let studied = 0;
  for (let i = 0; i < (todo || []).length; i += 4) {
    await Promise.all(todo!.slice(i, i + 4).map(async r => {
      try {
        // thumbnail links expire after a few hours, so each one is asked for fresh
        const img = await designImageById(r.drive_id!);
        const d = await withUsage({ feature: 'library', agent: 'designer' }, () => geminiJSON<Described>(`You are the Banner Designer at Parakkat Jewels, a heritage Kerala jeweller, studying the brand's past work so new designs can match it.
Describe this image as a designer would brief another. keep is false if it is not a finished marketing design (a raw product photo, a screenshot, a logo file, a document page).
kind is one of post, story, banner, poster, other. occasion is the festival, season or theme (Onam, Diwali, Akshaya Tritiya, wedding, daily wear, new collection...), or "general".
quality is 1 to 5 for how polished and premium it looks.
Shape: {"keep": true, "kind": "...", "occasion": "...", "style": "2 sentences of art direction: mood, background, props, lighting, how the jewellery is shown",
"palette": "main colours", "layout": "where the product, headline, logo and space sit", "typography": "type style and treatment", "tags": ["5 to 8 short words"], "quality": 3}`,
          [{ inlineData: { mimeType: img.mimeType, data: img.data.toString('base64') } }]));
        if (d.keep === false) { await db.from('design_refs').update({ status: 'skipped', error: 'Not a finished design', kind: d.kind || null }).eq('id', r.id); return; }
        const path = `library/${r.id}.${img.mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'}`;
        const up = await db.storage.from('creatives').upload(path, img.data, { contentType: img.mimeType, upsert: true });
        if (up.error) throw up.error;
        await db.from('design_refs').update({ status: 'ready', error: null, image_path: path, kind: d.kind || null, occasion: d.occasion || null, style: d.style || null, palette: d.palette || null,
          layout: d.layout || null, typography: d.typography || null, tags: (d.tags || []).slice(0, 10).map(String), quality: Math.max(1, Math.min(5, Math.round(Number(d.quality) || 3))) }).eq('id', r.id);
        studied++;
      } catch (e) {
        await db.from('design_refs').update({ status: 'failed', error: errText(e).slice(0, 300) }).eq('id', r.id);
      }
    }));
  }
  const { count } = await db.from('design_refs').select('id', { count: 'exact', head: true }).eq('status', 'new');
  return { studied, left: count || 0 };
}

/**
 * The past designs closest to a brief, chosen in the database: occasion and style words first, pinned and
 * well-finished ones ahead, recently used ones pushed back and a little chance mixed in for variety.
 */
export async function pickRefs(db: SupabaseClient, words: string[], n = 3, exclude: string[] = []): Promise<Ref[]> {
  const { data, error } = await db.rpc('pick_design_refs', { p_query: searchWords(...words), p_limit: n, p_exclude: exclude });
  if (error) return [];
  const refs = (data || []) as Ref[];
  if (refs.length) await db.rpc('mark_design_refs_used', { p_ids: refs.map(r => r.id) }).then(() => null, () => null);
  return refs;
}

/** The references as images for the model. A reference that cannot be read is left out, not fatal. */
export async function refParts(db: SupabaseClient, refs: Ref[]): Promise<{ ref: Ref; part: Part }[]> {
  const got = await Promise.all(refs.map(async ref => {
    const { data } = await db.storage.from('creatives').download(ref.image_path);
    if (!data) return null;
    return { ref, part: { inlineData: { mimeType: data.type || 'image/jpeg', data: Buffer.from(await data.arrayBuffer()).toString('base64') } } };
  }));
  return got.filter(Boolean) as { ref: Ref; part: Part }[];
}
