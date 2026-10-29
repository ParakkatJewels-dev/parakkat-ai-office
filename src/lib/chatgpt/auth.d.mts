export type ChatGPTModels = { manager: string | null; worker: string | null };
export type ChatGPTStatus = {
  enabled: boolean; connected: boolean; activeAccountId: string | null; usageBlocked: boolean;
  accounts: Array<{ id: string; label: string; email: string | null; active: boolean; connected: boolean; usageBlocked: boolean }>;
  models: ChatGPTModels;
};
export type LoginTransaction = Readonly<{ authorizationUrl: string; redirectUri: string; state: string; expiresAt: number }>;
export class ChatGPTAuthError extends Error { code: string; status?: number; constructor(message: string, code?: string, status?: number); }
export function authEnabled(): boolean;
export function ensureHost(): Promise<string>;
export function getChatGPTStatus(): Promise<ChatGPTStatus>;
export function createLogin(options?: { accountId?: string; port?: number; retryOf?: LoginTransaction }): Promise<LoginTransaction>;
export function completeLogin(transaction: LoginTransaction, callbackUrl: string | URL): Promise<void>;
export function getAuthContext(): Promise<{ accessToken: string; accountId: string; models: ChatGPTModels; usageBlocked: boolean }>;
export function getAccessToken(): Promise<string>;
export function selectAccount(id: string): Promise<void>;
export function setModels(models: ChatGPTModels, expectedAccountId?: string): Promise<void>;
export function markAccountUsageBlocked(accountId: string): Promise<void>;
export function clearAccountUsageBlock(accountId: string): Promise<void>;
export function disconnectAccount(id?: string): Promise<{ revoked: boolean }>;
export function exportCredentials(path: string): Promise<void>;
export function importCredentials(path: string): Promise<void>;
export function createAuthClient(options?: { directory?: string; enabled?: boolean; now?: () => number; fetch?: typeof fetch }): {
  ensureHost: typeof ensureHost; getChatGPTStatus: typeof getChatGPTStatus; createLogin: typeof createLogin; completeLogin: typeof completeLogin;
  getAuthContext: typeof getAuthContext; getAccessToken: typeof getAccessToken; selectAccount: typeof selectAccount; setModels: typeof setModels;
  markAccountUsageBlocked: typeof markAccountUsageBlocked; clearAccountUsageBlock: typeof clearAccountUsageBlock;
  disconnectAccount: typeof disconnectAccount; exportCredentials: typeof exportCredentials; importCredentials: typeof importCredentials;
};
