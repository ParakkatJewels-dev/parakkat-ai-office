export class GeminiError extends Error { code: string; constructor(message: string, code?: string); }
export type GeminiConfig = { apiKey: string; source: 'saved' | 'environment' | 'none'; imageModel: string; imageSize: '1K' | '2K' | '4K'; textModel: string };
export function cleanGeminiKey(value: unknown): string;
export function resolveGeminiConfig(saved: { tokens: { access_token: string } } | null, env?: Record<string, string | undefined>): GeminiConfig;
export function publicGeminiConfig(config: GeminiConfig): Omit<GeminiConfig, 'apiKey'> & { configured: boolean };
export function geminiImageGenerationConfig(config: GeminiConfig, aspectRatio?: string): { responseModalities: string[]; imageConfig: { aspectRatio?: string; imageSize?: string } };
export function geminiFailure(status: number, data?: any): GeminiError;
export function geminiRequest(options: { apiKey: string; model: string; body?: Record<string, unknown>; signal?: AbortSignal; fetch?: typeof fetch }): Promise<any>;
export function checkGeminiModel(apiKey: string, model: string, request?: typeof fetch): Promise<void>;
export function geminiImage(parts: unknown): { data: Buffer; mimeType: string };
