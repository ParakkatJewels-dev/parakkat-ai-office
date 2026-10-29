import 'server-only';
import { createHash } from 'node:crypto';
import { has, opt } from '@/lib/env';
import { recordUsage } from '@/lib/usage';
import { geminiChat } from './gemini';
import { checkPause } from '@/lib/pause';
import { getChatGPTStatus } from '@/lib/chatgpt/auth.mjs';
import { chatGPTJSON, ChatGPTError } from './chatgpt.mjs';
import { withModelWork } from '@/lib/agents/agent-work';
import { runAiBudgetedText } from '@/lib/ai-budget';
import { getGeminiConfig } from './gemini-config';
import { canUseNim } from './nim-config';
import { nimChat } from './nim';
import { preferredTextProvider, type ModelUseCase } from './model-routing.mjs';

export type Tier = 'manager' | 'worker';
export type ChatOptions = { timeoutMs?: number; signal?: AbortSignal; maxOutputTokens?:number; useCase?:ModelUseCase };
const model = (tier: Tier) => tier === 'manager' ? opt('OPENAI_MANAGER_MODEL', 'gpt-4.1') : opt('OPENAI_WORKER_MODEL', 'gpt-4.1-mini');

/** Errors that mean OpenAI cannot answer anything right now (no key, no credits, bad key, overloaded), not a bad prompt. */
const down = (status: number) => status === 401 || status === 402 || status === 403 || status === 429 || status >= 500;
const PAUSE = 10 * 60_000;
let openaiDownUntil = 0;

/** Which text model answers first. LLM_PROVIDER=gemini makes Gemini the main one; the other is the fallback. */
const order = (): ('openai' | 'gemini')[] => {
  const all: ('openai' | 'gemini')[] = opt('LLM_PROVIDER', 'openai') === 'gemini' ? ['gemini', 'openai'] : ['openai', 'gemini'];
  return all.filter(p => p === 'openai' ? has('OPENAI_API_KEY') && Date.now() >= openaiDownUntil : has('GEMINI_API_KEY'));
};

/** ChatGPT must be available whenever it owns a decision or review. */
export const canWrite = async () => {
  const provider=opt('LLM_PROVIDER','openai');
  if(provider==='nim')return canUseNim().catch(()=>false);
  if (provider !== 'chatgpt') return has('OPENAI_API_KEY') || has('GEMINI_API_KEY');
  try { const status = await getChatGPTStatus(); return status.enabled && status.connected && !status.usageBlocked; }
  catch { return false; }
};

class Down extends Error {}

async function openaiJSON<T>(tier: Tier, system: string, user: string, signal: AbortSignal, maxOutputTokens:number, reportUsage:(value:{inputTokens?:number;outputTokens?:number;usageKnown?:boolean})=>void): Promise<T> {
  const t0 = Date.now(), m = model(tier);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: m,
      max_completion_tokens: maxOutputTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: `${system}\nReply with one JSON object only.` }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    await recordUsage({ provider: 'openai', model: m, system, ok: false, ms: Date.now() - t0 });
    const msg = `OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`;
    throw down(res.status) ? new Down(msg) : new Error(msg);
  }
  const data = await res.json();
  reportUsage({inputTokens:data.usage?.prompt_tokens,outputTokens:data.usage?.completion_tokens,usageKnown:Number.isSafeInteger(data.usage?.prompt_tokens)&&data.usage.prompt_tokens>=0&&Number.isSafeInteger(data.usage?.completion_tokens)&&data.usage.completion_tokens>=0});
  await recordUsage({ provider: 'openai', model: data.model?.replace(/-\d{4}-\d{2}-\d{2}$/, '') || m, system, input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens, ms: Date.now() - t0 });
  const text: string = data.choices?.[0]?.message?.content ?? '{}';
  try { return JSON.parse(text) as T; } catch { throw new Error(`OpenAI returned text that is not JSON: ${text.slice(0, 200)}`); }
}

/**
 * Ask a text model for a JSON object. Agent prompts describe the shape they want in `system`.
 * OpenAI answers by default; when it is out of credits, rejects the key or is down, Gemini answers instead
 * and OpenAI is skipped for ten minutes, so the agents never stall on one provider.
 */
export async function chatJSON<T>(tier: Tier, system: string, user: string, options: ChatOptions = {}): Promise<T> {
  return withModelWork(system,{timeoutMs:options.timeoutMs??240_000,signal:options.signal},()=>chatJSONWork<T>(tier,system,user,options));
}

async function chatJSONWork<T>(tier: Tier, system: string, user: string, options: ChatOptions): Promise<T> {
  const timeout = AbortSignal.timeout(Math.max(1, Math.min(options.timeoutMs ?? 240_000, 240_000)));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  signal.throwIfAborted();
  await checkPause();
  signal.throwIfAborted();
  if (opt('LLM_PROVIDER','openai') === 'nim')return nimChat<T>(system,user,{signal,...options});
  if (opt('LLM_PROVIDER', 'openai') === 'chatgpt') {
    const status=await getChatGPTStatus();
    if(!status.enabled||!status.connected||!status.activeAccountId)throw new ChatGPTError('Connect a ChatGPT account in Settings → AI providers before starting text work.','authentication');
    // A NIM draft is useful only when its required ChatGPT review can run.
    const route=preferredTextProvider(options.useCase,{chatReady:!status.usageBlocked,
      nimReady:options.useCase==='reviewed_draft'||options.useCase==='reviewed_specialist'?await canUseNim().catch(()=>false):false});
    if(route==='wait')
      throw new ChatGPTError('Text work is waiting for ChatGPT plan usage so direct answers and required head or QC reviews keep their quality gate.','usage_paused');
    // Route only named, bounded workloads. Provider failures are not retried
    // against another paid model; a retry would spend twice for one task.
    if(route==='nim')return nimChat<T>(system,user,{signal,...options});
    const selectedModel=process.env[tier==='manager'?'CHATGPT_MANAGER_MODEL':'CHATGPT_WORKER_MODEL']||status.models[tier]||'';
    return runAiBudgetedText({provider:'chatgpt',accountKey:selectedModel?status.activeAccountId:'',model:selectedModel,system,user,signal,timeoutMs:options.timeoutMs,maxOutputTokens:options.maxOutputTokens},async run=>{
      const started=Date.now();
      try {
        await checkPause();
        const result = await chatGPTJSON<T>(tier, system, user, { signal:run.signal,timeoutMs:options.timeoutMs,maxOutputTokens:run.maxOutputTokens,expectedAccountId:status.activeAccountId!,...(selectedModel?{expectedModel:selectedModel}:{}) });
        run.reportUsage({inputTokens:result.inputTokens,outputTokens:result.outputTokens,usageKnown:result.usageKnown});
        await recordUsage({ provider: 'chatgpt', model: result.model, system, input: result.usageKnown?result.inputTokens:undefined, output: result.usageKnown?result.outputTokens:undefined, ms: Date.now() - started });
        return result.value;
      } catch (error) {
        const usage=error instanceof ChatGPTError ? error.usage : undefined;
        if(usage?.usageKnown)run.reportUsage(usage);
        await recordUsage({ provider: 'chatgpt', model:usage?.model||selectedModel,system, input:usage?.usageKnown?usage.inputTokens:undefined,output:usage?.usageKnown?usage.outputTokens:undefined,ok: false, ms: Date.now() - started });
        throw error;
      }
    });
  }
  const providers = order();
  if (!providers.length) throw new Error('No text model is set up. Connect ChatGPT on the self-hosted server and set LLM_PROVIDER=chatgpt, or configure an API provider in the server environment.');
  let last: unknown;
  for (const p of providers) {
    try {
      signal.throwIfAborted();
      const selectedModel=p==='openai'?model(tier):tier==='manager'?opt('GEMINI_MANAGER_MODEL',opt('GEMINI_TEXT_MODEL','gemini-3.8-flash')):opt('GEMINI_TEXT_MODEL','gemini-3.8-flash');
      const geminiConfig=p==='gemini'?await getGeminiConfig():undefined;
      // Gemini owns admission for all of its entry points, including direct vision reviews.
      if(p==='gemini')return await geminiChat<T>(tier,system,user,{signal,config:geminiConfig,maxOutputTokens:options.maxOutputTokens});
      const accountKey=createHash('sha256').update(geminiConfig?.apiKey||process.env.OPENAI_API_KEY||'').digest('hex');
      return await runAiBudgetedText({provider:p,accountKey,model:selectedModel,system,user,signal,timeoutMs:options.timeoutMs,maxOutputTokens:options.maxOutputTokens},async run=>{
        await checkPause();
        return openaiJSON<T>(tier,system,user,run.signal,run.maxOutputTokens,run.reportUsage);
      });
    } catch (e) {
      if (p === 'openai' && e instanceof Down) { openaiDownUntil = Date.now() + PAUSE; last = e; continue; }
      throw e;
    }
  }
  throw last;
}
