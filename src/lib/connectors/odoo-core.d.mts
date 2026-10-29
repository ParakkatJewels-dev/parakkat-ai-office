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
export type OdooSalesState = { oldest?: string; newest?: string; pending?: { from: string; to: string }[]; coverage?: string | null; needs_continuation?: boolean };
export function salesDayWindows(today: string, state?: OdooSalesState): { from: string; to: string }[];
export function odooDeadline(): Error & { code: string };
export function isOdooDeadline(error: unknown): boolean;
export function isMissingOdooModel(error: unknown, model: string): boolean;
export function odooContinuationDue(state: OdooSalesState | null | undefined, updatedAt: string | null | undefined, lastAttempt: number | null | undefined, now?: number): boolean;
export function runSalesDays(args: {
  today: string; state?: OdooSalesState; deadline: number; now?: () => number; reserveMs?: number;
  read: (window: { from: string; to: string }) => Promise<{ branchRows: Record<string, unknown>[]; lineRows: Record<string, unknown>[]; coverage: string }>;
  commit: (window: { from: string; to: string }, result: { branchRows: Record<string, unknown>[]; lineRows: Record<string, unknown>[]; coverage: string }, state: OdooSalesState) => Promise<void>;
}): Promise<{ days: number; completedWindows: number; pendingDays: number; from: string | null; more: boolean; coverage: string | null; state: OdooSalesState }>;
