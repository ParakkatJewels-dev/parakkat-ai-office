export type Price = { in_per_m: number; out_per_m: number; per_unit: number };
export function priceFor(prices: Record<string, Price>, provider: string, model: string): Price;
export function costUsd(price: Price, use?: { input?: number; output?: number; units?: number }): number;
export function agentFromPrompt<P extends { name: string }>(system: string, people: readonly P[]): P | null;
