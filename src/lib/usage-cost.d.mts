export type Price = { in_per_m: number; out_per_m: number; per_unit: number };
export type UsageBilling = {
  billingOutput?: number;
  priceFallback?: Price;
  imageCharge?: { priceKey: string; units: number; fallbackPrice: Price };
  costNote?: string;
};
export function priceFor(prices: Record<string, Price>, provider: string, model: string): Price;
export function costUsd(price: Price, use?: { input?: number; output?: number; units?: number }): number;
export function geminiImageBilling(model: string, imageSize: string, metadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; candidatesTokensDetails?: { modality?: string; tokenCount?: number }[] }, parts?: { thought?: boolean; inlineData?: unknown }[]): UsageBilling;
export function usageCostUsd(prices: Record<string, Price>, use: UsageBilling & { provider: string; model?: string; input?: number; output?: number; units?: number }): number;
export function agentFromPrompt<P extends { name: string }>(system: string, people: readonly P[]): P | null;
