// NVIDIA hosted NIM chat completions. Keep this module free of server imports for offline tests.
export class NimError extends Error {
  constructor(message, code = 'nim_error') { super(message); this.name = 'NimError'; this.code = code; }
}

export const DEFAULT_NIM_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
export function cleanNimKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[\x21-\x7e]{16,512}$/.test(key)) throw new NimError('Enter a valid NVIDIA NIM API key without spaces or line breaks.', 'invalid_key');
  return key;
}
export function resolveNimConfig(saved, env = process.env) {
  const apiKey = saved?.apiKey || env.NVIDIA_NIM_API_KEY || '';
  const model = env.NVIDIA_NIM_MODEL || DEFAULT_NIM_MODEL;
  if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(model) || model.length > 100) throw new NimError('The NVIDIA NIM model setting is invalid.', 'invalid_model');
  return { apiKey, model, source: saved?.apiKey ? 'saved' : apiKey ? 'environment' : 'none' };
}
export const publicNimConfig = config => ({ configured: !!config.apiKey, model: config.model, source: config.source });
export function nimFailure(status) {
  if (status === 401 || status === 403) return new NimError('NVIDIA rejected this API key or model access. Check the NVIDIA API catalog.', 'authentication');
  if (status === 402) return new NimError('NVIDIA NIM needs available account credits.', 'credits');
  if (status === 429) return new NimError('NVIDIA NIM reached its rate or usage limit.', 'rate_limit');
  if (status === 404) return new NimError('The selected NVIDIA model is unavailable to this key. Choose a model listed in the NVIDIA API catalog.', 'model_unavailable');
  if (status >= 500) return new NimError('NVIDIA NIM is temporarily unavailable.', 'unavailable');
  return new NimError('NVIDIA NIM rejected the request or model.', 'request_failed');
}
async function boundedJSON(response) {
  if (!response.body) throw new NimError('NVIDIA NIM returned an empty response.', 'invalid_response');
  const reader=response.body.getReader(), chunks=[]; let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read(); if(done)break;
      size+=value.byteLength;
      if(size>1024*1024)throw new NimError('NVIDIA NIM returned an unexpectedly large response.', 'invalid_response');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch(error) {
    if(error instanceof NimError)throw error;
    throw new NimError('NVIDIA NIM returned an unreadable response.', 'invalid_response');
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
export function nimUsage(data) {
  const inputTokens=data?.usage?.prompt_tokens,outputTokens=data?.usage?.completion_tokens;
  const usageKnown=Number.isSafeInteger(inputTokens)&&inputTokens>=0&&Number.isSafeInteger(outputTokens)&&outputTokens>=0;
  return {inputTokens:usageKnown?inputTokens:undefined,outputTokens:usageKnown?outputTokens:undefined,usageKnown};
}
export async function nimJSON({apiKey,model,system,user,maxOutputTokens=1024,signal,fetch:request=globalThis.fetch}) {
  const key=cleanNimKey(apiKey);
  if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>4096)throw new NimError('The NVIDIA NIM output limit is invalid.', 'invalid_request');
  const deadline=AbortSignal.timeout(120000),bounded=signal?AbortSignal.any([signal,deadline]):deadline;
  bounded.throwIfAborted();
  let response;
  try {
    response=await request('https://integrate.api.nvidia.com/v1/chat/completions',{
      method:'POST',redirect:'error',cache:'no-store',signal:bounded,
      headers:{authorization:`Bearer ${key}`,'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({model,messages:[{role:'system',content:`${system}\nReply with one valid JSON object only. Do not include markdown fences.`},{role:'user',content:user}],max_tokens:maxOutputTokens,temperature:0.2,stream:false,
        ...(model==='nvidia/nemotron-3.5-lightning-30b-a3b'?{reasoning_budget:0}:{})}),
    });
  } catch { if(signal?.aborted)throw signal.reason;throw new NimError('NVIDIA NIM could not be reached before the deadline.', 'network'); }
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw nimFailure(response.status);}
  const data=await boundedJSON(response),usage=nimUsage(data);
  const content=data?.choices?.[0]?.message?.content;
  if(typeof content!=='string'||!content.trim())throw Object.assign(new NimError('NVIDIA NIM returned no final answer.', 'invalid_response'),{usage});
  let value;
  try {value=JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g,''));}
  catch {throw Object.assign(new NimError('NVIDIA NIM did not return valid JSON.', 'invalid_json'),{usage});}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new NimError('NVIDIA NIM did not return a JSON object.', 'invalid_json'),{usage});
  return {value,usage,model:typeof data.model==='string'?data.model:model};
}
