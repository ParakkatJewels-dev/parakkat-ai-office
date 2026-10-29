export type ChatGPTModel = { slug: string; display_name: string };
export type ChatGPTResult<T> = { value: T; model: string; inputTokens: number; outputTokens: number; usageKnown:boolean; reasoningTokens:number|null };
export type ChatGPTOptions = { signal?: AbortSignal; timeoutMs?: number; maxOutputTokens?:number; expectedAccountId?:string; expectedModel?:string };
export type ChatGPTModelOptions = { refresh?:boolean };
export class ChatGPTError extends Error { code: string; status?: number; providerCode?: string; requestId?: string; usage?:{model:string|null;inputTokens:number;outputTokens:number;usageKnown:boolean;reasoningTokens:number|null}; constructor(message: string, code?: string); }
export function listChatGPTModels(expectedAccountId?: string, options?:ChatGPTModelOptions): Promise<ChatGPTModel[]>;
export function resumeChatGPTUsage(accountId: string): Promise<void>;
export function chatGPTJSON<T>(tier: 'manager' | 'worker', system: string, user: string, options?: ChatGPTOptions): Promise<ChatGPTResult<T>>;
export function consumeResponsesStream(body: ReadableStream<Uint8Array> | null, options?: { maxBytes?: number; maxTextBytes?: number }): Promise<{ text: string; model: string | null; inputTokens: number; outputTokens: number; usageKnown:boolean; reasoningTokens:number|null }>;
export function createChatGPTClient(options?: {
  getAuthContext?: () => Promise<{ accessToken: string; accountId: string; models: { manager: string | null; worker: string | null }; usageBlocked?: boolean }>;
  markAccountUsageBlocked?: (accountId: string) => Promise<void>;
  clearAccountUsageBlock?: (accountId: string) => Promise<void>;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => number;
}): { listChatGPTModels(expectedAccountId?: string, options?:ChatGPTModelOptions): Promise<ChatGPTModel[]>; resumeChatGPTUsage(accountId: string): Promise<void>; chatGPTJSON<T>(tier: 'manager' | 'worker', system: string, user: string, options?: ChatGPTOptions): Promise<ChatGPTResult<T>> };
