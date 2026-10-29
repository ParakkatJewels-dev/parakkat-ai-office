const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = value => typeof value === 'string' && UUID.test(value) ? value : null;

/** A revision must identify visual work; ordinary copy revisions keep their existing route. */
export function artworkRevisionIntent(request) {
  const text = String(request || '');
  if (/\b(?:do not|don't|never)\s+(?:redesign|rework|revise|redo|change|edit|make)\b/i.test(text)) return false;
  if (/\b(?:carousel|carrousel|carsoule|five[ -]?card|5[ -]?card|all five cards|all 5 cards)\b/i.test(text)) return false;
  const revision = /\b(?:redesign|rework|revise|redo|change|edit|new version)\b/i.test(text)
    || /\bmake\b.+\b(?:premium|elegant|brighter|darker|cleaner|lighter|minimal|background|colour|color|lighting)\b/i.test(text);
  return revision && (/\b(?:poster|image|artwork|banner|design)\b/i.test(text) || /\/studio\?made=|#d-/i.test(text));
}

/** Only an assistant-linked design from this private thread is a revision target. History is newest first. */
export function conversationDesignRevision(request, history = []) {
  const known = [];
  for (const row of history) {
    const value = row?.role === 'assistant' ? id(row.metadata?.design_id) : null;
    if (value && !known.includes(value)) known.push(value);
  }
  const text = String(request || '');
  const explicit = text.match(/(?:\/studio\?made=|#d-|\bdesign(?:\s+id)?\s*[:#]\s*)([0-9a-f-]{36})\b/i)?.[1];
  if (explicit) return known.includes(explicit) ? explicit : null;
  return known[0] || null;
}

/** Enrich only IDs from an already-authorized thread, using the caller's RLS client throughout. */
export async function readConversationArtworks(reader, messages = []) {
  const designIds = [], carouselIds = [];
  for (const row of [...messages].reverse()) {
    if (row?.role !== 'assistant') continue;
    const design = id(row.metadata?.design_id), carousel = id(row.metadata?.carousel_id);
    if (design && !designIds.includes(design) && designIds.length < 20) designIds.push(design);
    if (carousel && !carouselIds.includes(carousel) && carouselIds.length < 6) carouselIds.push(carousel);
  }
  const columns = 'id,status,headline,brief,image_path,artwork_request_id,artwork_origin,error,versions,carousel_id,carousel_index';
  const reads = [];
  if (designIds.length) reads.push(reader.from('designs').select(columns).in('id', designIds).limit(20));
  if (carouselIds.length) reads.push(reader.from('designs').select(columns).in('carousel_id', carouselIds).order('carousel_index').limit(30));
  if (!reads.length) return [];
  const results = await Promise.all(reads).catch(() => []);
  if (results.length !== reads.length) return [];
  if (results.some(result => result.error || !Array.isArray(result.data))) return [];
  const rows = [...new Map(results.flatMap(result => result.data).filter(row => id(row.id)
    && (designIds.includes(row.id) || carouselIds.includes(row.carousel_id))).map(row => [row.id, row])).values()];
  const paths = [...new Set(rows.map(row => row.image_path).filter(path => typeof path === 'string' && path))];
  const signed = paths.length ? await reader.storage.from('creatives').createSignedUrls(paths, 3600).catch(() => ({data: []})) : {data: []};
  const urls = new Map((signed.data || []).filter(row => row.path && typeof row.signedUrl === 'string').map(row => [row.path, row.signedUrl]));
  return rows.map(row => ({
    ...(process.env.CHATGPT_IMAGE_WORKER_ENABLED === 'true' ? {automaticChatGPT:true} : {}),
    id: row.id, status: String(row.status || ''), requestId: id(row.artwork_request_id), imported: ['chatgpt_import','higgsfield_import'].includes(row.artwork_origin),
    importProvider: row.artwork_origin === 'higgsfield_import' ? 'Higgsfield' : row.artwork_origin === 'chatgpt_import' ? 'ChatGPT' : null,
    generatedProvider: row.artwork_origin === 'higgsfield_oauth' ? 'Higgsfield' : null,
    title: String(row.headline || row.brief || 'Artwork').slice(0, 300),
    imageUrl: urls.get(row.image_path) || null, version: row.image_path ? (Array.isArray(row.versions) ? row.versions.length : 0) + 1 : null,
    carouselId: id(row.carousel_id), carouselIndex: Number.isInteger(row.carousel_index) ? row.carousel_index : null,
    // Detailed operational/provider errors are not needed to render an asset in a private conversation.
    needsAttention: !!row.error || row.status === 'failed' || row.status === 'needs_fix',
  }));
}
