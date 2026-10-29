export type HiggsfieldStatus = { connected: boolean; accountId?: string; accountName?: string; workspaceId?: string; workspaceName?: string; error?: string };
export type HiggsfieldAuthContext = { accessToken: string; accountId?: string; workspaceId?: string; workspaceTool?: 'list_workspaces'|'workspace_list' };
export class HiggsfieldAuthError extends Error { code: string; status?: number; constructor(message: string, code?: string, status?: number); }
export const HIGGSFIELD_STATE_COOKIE: string;
export function safeHiggsfieldAuthError(error: unknown): string;
export function getHiggsfieldStatus(): Promise<HiggsfieldStatus>;
export function startHiggsfieldLogin(userId: string, origin: string): Promise<{ url: string; state: string }>;
export function finishHiggsfieldLogin(userId: string, callbackUrl: string, cookieState: string): Promise<HiggsfieldStatus>;
export function getHiggsfieldAuthContext(options?: { expectedAccountId?: string; expectedWorkspaceId?: string }): Promise<HiggsfieldAuthContext>;
export function disconnectHiggsfield(): Promise<{ revoked: boolean }>;
export function createHiggsfieldAuthClient(options?: { directory?: string; env?: Record<string, string | undefined>; now?: () => number; fetch?: typeof fetch; requestTimeoutMs?: number; lockTimeoutMs?: number; diagnostic?: (event: Record<string, unknown>) => void; mcp?: { callHiggsfieldTool(name: string, args?: Record<string, unknown>): Promise<any>; listHiggsfieldTools?(options?:{cursor?:string;timeoutMs?:number}): Promise<any> } }): {
  getHiggsfieldStatus: typeof getHiggsfieldStatus; startHiggsfieldLogin: typeof startHiggsfieldLogin; finishHiggsfieldLogin: typeof finishHiggsfieldLogin;
  getHiggsfieldAuthContext: typeof getHiggsfieldAuthContext; disconnectHiggsfield: typeof disconnectHiggsfield;
};
