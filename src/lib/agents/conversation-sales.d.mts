import type { SupabaseClient } from '@supabase/supabase-js';
export const CONVERSATION_PRODUCT_LIMIT: number;
export type SalesWindow = { from: string; to: string };
export function conversationSalesWindows(now?: Date): { sevenDays: SalesWindow; thirtyDays: SalesWindow; completeThirtyDays: SalesWindow; observedAt: string };
export function requestedSalesCategory(request: string): string | null;
export function conversationCategorySales(reader: SupabaseClient, signal: AbortSignal, window: SalesWindow, observedAt: string, category: string, limit?: number): Promise<Record<string, unknown>>;
export function normalizeConversationSales(result: unknown, window: SalesWindow, observedAt: string, limit?: number): Record<string, unknown>;
export function conversationProductSales(reader: SupabaseClient, signal: AbortSignal, window: SalesWindow, observedAt: string): Promise<Record<string, unknown>>;
export function conversationProductCatalog(reader: SupabaseClient, signal: AbortSignal, observedAt: string): Promise<Record<string, unknown>>;
