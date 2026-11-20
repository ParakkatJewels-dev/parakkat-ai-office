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

/** AI suggestions are advisory; eligibility and an explicit user choice are authoritative. */
export function chooseArtworkProvider({selected,chatgpt,higgsfield,referenceCount=0,format='',suggestion}) {
  if(selected!=null&&selected!==''&&!['chatgpt','higgsfield'].includes(selected))throw new Error('Choose Auto, ChatGPT or Higgsfield.');
  const ready={chatgpt:!!chatgpt,higgsfield:!!higgsfield};
  if(selected){if(!ready[selected])return {provider:null,basis:'explicit',reason:`${selected==='chatgpt'?'ChatGPT':'Higgsfield'} is unavailable. Restore its connection or choose Auto.`};return {provider:selected,basis:'explicit',reason:'Explicitly selected for this artwork.'};}
  if(!ready.chatgpt&&!ready.higgsfield)return {provider:null,basis:'availability',reason:'Neither ChatGPT nor Higgsfield is ready for image generation. Check both connections in Settings.'};
  if(ready.chatgpt!==ready.higgsfield)return {provider:ready.chatgpt?'chatgpt':'higgsfield',basis:'availability',reason:'Only this provider passed the current connection and capacity checks.'};
  if(suggestion?.provider&&ready[suggestion.provider]&&typeof suggestion.reason==='string'&&suggestion.reason.trim())
    return {provider:suggestion.provider,basis:'ai',reason:suggestion.reason.trim().slice(0,300)};
  // Stable fallback if the text model cannot make a routing decision.
  const provider=referenceCount>5||['carousel_card','web_banner'].includes(format)?'higgsfield':'chatgpt';
  return {provider,basis:'policy',reason:provider==='higgsfield'?'The format or reference pack suits Higgsfield’s connected image workflow.':'A single artwork with up to five references suits the connected ChatGPT worker.'};
}
