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

/** Stable full enumeration. Filtering locally keeps uncommon image MIME types and old moved subfolders discoverable. */
export function childrenQuery(folderId) {
  return `'${String(folderId).replace(/['\\]/g, '')}' in parents and trashed = false`;
}

/** A thumbnail link at a size the model can read the type and layout at. Drive's links end in =s220 or similar. */
export const bigThumb = (link, size = 1280) => String(link).replace(/=s\d+(-[a-z0-9-]+)?$/i, '') + `=s${size}`;

const STOP = new Set('a an and the for of on in to with this that from our we is are be it at by as or new week day days instagram post story banner poster web website make design please'.split(' '));
/** Words worth searching the library for, as an OR query websearch_to_tsquery understands. */
export function searchWords(...texts) {
  const words = texts.join(' ').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, 12).join(' or ');
}

const REFERENCE_STOP = new Set(`${[...STOP].join(' ')} gold golden layered parakkat jewels jewellery jewelry product products selected official photo photos image images use using create generate keep same actual exact source reference references premium quality campaign brand brief human review publish draft stock selling top find latest recorded complete days`.split(' '));
const referenceTokens = value => [...new Set(String(value || '').toLowerCase().normalize('NFKD').match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(word => !REFERENCE_STOP.has(word));
const SUBJECTS = [
  ['neckwear', /\b(?:chains?|necklaces?)\b/i, 'chain or necklace'],
  ['ring', /\brings?\b/i, 'ring'], ['earwear', /\b(?:earrings?|jhumkas?|studs?)\b/i, 'earring or jhumka'],
  ['wristwear', /\b(?:bracelets?|bangles?)\b/i, 'bracelet or bangle'], ['pendant', /\bpendants?\b/i, 'pendant'],
  ['anklet', /\b(?:anklets?|payals?)\b/i, 'anklet or payal'], ['idol', /\b(?:idols?|deities|deity|figurines?)\b/i, 'idol or deity'],
];
const subjects = value => {
  const text=String(value||''),found=SUBJECTS.filter(([, pattern])=>pattern.test(text)).map(([name])=>name);
  // "Chain bracelet" describes wristwear, not a necklace reference.
  return found.some(name=>name==='wristwear'||name==='anklet')&&!/\bnecklaces?\b/i.test(text)?found.filter(name=>name!=='neckwear'):found;
};
function directionTerms(value) {
  const excluded=[];
  const positive=String(value || '').replace(/\b(?:no|without|avoid|exclude|do not (?:include|use|add))\s+([^.;\n]+?)(?=$|[.;\n]|\b(?:but|instead|with|and (?:use|keep|add))\b)/gi, (_match, banned) => {excluded.push(...referenceTokens(banned));return ' ';});
  if(excluded.some(word=>/^(?:ceremonial|temple|idols?|deit(?:y|ies)|rituals?|diyas?)$/.test(word)))excluded.push('ceremonial','temple','temples','idol','idols','deity','deities','ritual','rituals','diya','diyas');
  return {positive:referenceTokens(positive),excluded:[...new Set(excluded)]};
}
const referenceText = ref => [ref.name,...(Array.isArray(ref.tags)?ref.tags:[]),ref.kind,ref.occasion,ref.style,ref.palette,ref.layout,ref.typography,
  ...Object.entries(ref.fingerprint||{}).filter(([key])=>key!=='avoid').map(([,value])=>typeof value==='string'?value:'')].filter(Boolean).join(' ');

/** Supplemental indexed reads for a library larger than the bounded full scan. */
export function designReferenceQueries(words, options={}) {
  const wanted=subjects(options.productTitles?.length?options.productTitles.join(' '):words.join(' '));
  const category=SUBJECTS.filter(([name])=>wanted.includes(name)).map(([, ,query])=>query).join(' or ');
  const direction=directionTerms(options.direction).positive.slice(0,12).join(' or ');
  return [...new Set([category,direction].filter(Boolean))];
}

/** Subject and requested direction outrank popularity, quality ratings and recency. */
export function rankDesignReferences(refs, words, options={}) {
  const wanted=subjects(options.productTitles?.length?options.productTitles.join(' '):words.join(' '));
  const direction=directionTerms(options.direction),requested=referenceTokens(words.join(' ')).filter(word=>!direction.excluded.includes(word)),previous=new Set(options.previousIds||[]);
  const format=/story|reel/i.test(options.format||'')?'story':/banner|website/i.test(options.format||'')?'banner':/poster/i.test(options.format||'')?'poster':/post|portrait/i.test(options.format||'')?'post':null;
  const scored=refs.map(ref=>{
    const identity=[ref.name,...(ref.tags||[])].join(' '),direct=subjects(identity);
    const text=referenceText(ref),tokens=new Set(referenceTokens(text)),actual=subjects([identity,ref.style,ref.layout,ref.fingerprint?.visualBrief,ref.fingerprint?.composition].filter(Boolean).join(' '));
    const match=wanted.some(name=>actual.includes(name)),conflicting=actual.filter(name=>!wanted.includes(name)).length;
    const requestedChain=/\bchains?\b/i.test((options.productTitles||[]).join(' ')),directChain=requestedChain&&/\bchains?\b/i.test(identity)&&!direct.includes('wristwear')&&!direct.includes('anklet');
    return {ref,tokens,key:[wanted.length?(match?(wanted.some(name=>direct.includes(name))?3:2):actual.length?0:1):1,directChain?1:0,match?-conflicting:0,
      -direction.excluded.filter(word=>tokens.has(word)).length,
      direction.positive.filter(word=>tokens.has(word)).length,
      requested.filter(word=>tokens.has(word)).length,format&&ref.kind===format?1:0,
      Math.max(0,Math.min(5,Number(ref.quality)||0)),ref.pinned?1:0,previous.has(ref.id)?1:0]};
  });
  const compare=(a,b)=>{for(let i=0;i<a.key.length;i++){if(a.key[i]!==b.key[i])return b.key[i]-a.key[i];}return String(a.ref.id).localeCompare(String(b.ref.id));};
  scored.sort(compare);
  // Prefer compatible supporting references after choosing the strongest match.
  // Explicit subject/direction always remain ahead of stylistic consistency.
  const primary=scored.shift();if(!primary)return [];
  const palette=new Set(referenceTokens([primary.ref.palette,primary.ref.fingerprint?.palette,primary.ref.fingerprint?.lighting].join(' ')));
  for(const row of scored)row.key.splice(5,0,[...palette].filter(word=>row.tokens.has(word)).length);
  scored.sort(compare);
  return [primary,...scored].slice(0,Math.max(1,Math.min(3,Number(options.limit)||3))).map(row=>row.ref);
}

/** The one-line summary of a past design that the art director reads, from what the describer saw. */
export function refLine(r, i) {
  return `Reference ${i + 1}${r.occasion ? ` (${r.occasion})` : ''}: ${referenceFingerprint(r)}`;
}

/** Compact, reusable art direction retained after the uploaded preview is removed. */
export function referenceFingerprint(r) {
  const f = r?.fingerprint && typeof r.fingerprint === 'object' ? r.fingerprint : {};
  const fields = [
    ['Visual brief', f.visualBrief || r?.style], ['Composition', f.composition || r?.layout],
    ['Palette', f.palette || r?.palette], ['Lighting', f.lighting], ['Materials and props', f.materials],
    ['Typography', f.typography || r?.typography], ['How it was made', f.productionNotes], ['Avoid', f.avoid],
  ].filter(([, value]) => typeof value === 'string' && value.trim()).map(([name, value]) => [name, value.trim()]);
  if (!fields.length) return '';
  // Reserve every category's label before sharing the remaining space. Short
  // fields keep their full detail; long early descriptions cannot crowd out
  // lighting, typography, production notes or the constraints at the end.
  let remaining = 2200 - fields.reduce((total, [name]) => total + name.length + 2, 0) - (fields.length - 1) * 2;
  const excerpts = new Array(fields.length);
  fields.map(([name, value], index) => ({ name, value, index })).sort((a, b) => a.value.length - b.value.length)
    .forEach(({ name, value, index }, position) => {
      const budget = Math.min(value.length, Math.floor(remaining / (fields.length - position)));
      remaining -= budget;
      const excerpt = value.length <= budget ? value : `${value.slice(0, budget - 1).replace(/[\uD800-\uDBFF]$/, '').trimEnd()}…`;
      excerpts[index] = `${name}: ${excerpt}`;
    });
  return excerpts.join('; ');
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
