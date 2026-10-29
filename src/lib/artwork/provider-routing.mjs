/** The saved artifact supplies a revision default; selecting a provider never starts work. */
export function revisionArtworkProvider(selected, origin) {
  if (selected != null && selected !== '') {
    if (selected !== 'chatgpt' && selected !== 'higgsfield') throw new Error('Choose ChatGPT or Higgsfield for this artwork revision.');
    return selected;
  }
  return ['chatgpt_import','chatgpt'].includes(origin) ? 'chatgpt' : 'higgsfield';
}

/** Only an unambiguous provider named in this revision request overrides its saved origin. */
export function requestedArtworkProvider(request) {
  const excluded = new Set();
  const text = String(request || '').replace(/\b(?:do not|don't|never|avoid|without|not|rather than|instead of)\s+(?:(?:use|using|with|via|through|in|on)\s+)?(?:the\s+)?(?:native\s+)?(chatgpt|higgsfield)\b/gi,(_match,name)=>{excluded.add(name.toLowerCase());return '';});
  const providers = [...new Set((text.match(/\b(?:chatgpt|higgsfield)\b/gi) || []).map(name=>name.toLowerCase()))];
  if (providers.length === 1 && !excluded.has(providers[0])) return providers[0];
  return excluded.has('higgsfield') && !excluded.has('chatgpt') ? 'chatgpt' : null;
}

export function chatGPTRevisionMessage(count) {
  return `ChatGPT brief${count === 1 ? '' : 's'} prepared for ${count} image${count === 1 ? '' : 's'}. Open the artwork request, generate the image in ChatGPT, then import it for human review. AI Office does not generate ChatGPT images automatically.`;
}
