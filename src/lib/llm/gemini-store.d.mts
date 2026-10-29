import type { GeminiConfig } from './gemini-core.mjs';
export type GeminiStatus = Omit<GeminiConfig, 'apiKey'> & { configured: boolean; status: 'not_connected' | 'connected' | 'error' | 'configured'; error: string | null; checkedAt: string | null; updatedAt: string | null };
export function createGeminiStore(options?: { directory?: string; env?: Record<string, string | undefined> }): {
  getConfig(): Promise<GeminiConfig>; getStatus(): Promise<GeminiStatus>; saveKey(value: unknown): Promise<void>; useEnvironment(): Promise<void>;
  recordImageResult(config: GeminiConfig, error?: unknown): Promise<void>;
};
