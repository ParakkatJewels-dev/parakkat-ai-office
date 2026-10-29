import type { HiggsfieldAuthContext } from './auth.mjs';
export type HiggsfieldCallOptions = { signal?: AbortSignal; timeoutMs?: number; expectedAccountId?: string; expectedWorkspaceId?: string };
export class HiggsfieldMcpError extends Error { code: string; status?: number; rpcCode?: number; rpcMethod?: string; protocolVersion?: string; toolName?: string; rejection?: 'unknown_tool'|'invalid_params'; validationFields?: string[]; outcomeUnknown: boolean; submittedUnknown: boolean; constructor(message: string, code?: string, options?: { status?: number; outcomeUnknown?: boolean }); }
export { HiggsfieldMcpError as HiggsfieldError };
export const HIGGSFIELD_MCP_URL: string;
export function unwrapHiggsfieldResult(result: any): any;
export function selectedHiggsfieldWorkspace(result: any): { id: string; name: string };
export function callHiggsfieldTool(name: string, args?: Record<string, unknown>, options?: HiggsfieldCallOptions): Promise<any>;
export function listHiggsfieldTools(options?: HiggsfieldCallOptions & {cursor?: string}): Promise<{ tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>; nextCursor?: string }>;
export function createHiggsfieldMcpClient(options?: { fetch?: typeof fetch; getAuthContext?: (options?: { expectedAccountId?: string; expectedWorkspaceId?: string }) => Promise<HiggsfieldAuthContext> }): { callHiggsfieldTool: typeof callHiggsfieldTool; listHiggsfieldTools: typeof listHiggsfieldTools };
