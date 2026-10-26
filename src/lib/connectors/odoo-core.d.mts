export function normalizeOdooUrl(input: unknown): string | null;
export function guessDb(url: string | null | undefined): string;
export function istDay(v: unknown): string | null;
export function utcStart(day: string): string;
export function addDays(day: string, n: number): string;
export function m2o(v: unknown): { id: number; name: string } | null;
export function skuOf(p: { id: number; default_code?: string | false | null; barcode?: string | false | null }): string;
export function orderBranch(o: Record<string, any>, online?: string[]): { branch: string; kind: 'online' | 'other' };
export type SaleLine = { day: string | null; branch: string; kind: string; sku: string; product: string; units: number; revenue: number; order?: number | null };
export function totals(): {
  add(l: SaleLine): void;
  branchRows(): { day: string; branch: string; kind: string; orders: number; revenue: number }[];
  lineRows(): { day: string; branch: string; sku: string; product: string; units: number; revenue: number }[];
};
export function salesWindows(today: string, oldest: string | null | undefined, newest: string | null | undefined, backfill?: number, chunk?: number): { from: string; to: string }[];
