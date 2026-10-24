export function keyFrom(secret: string | undefined): Buffer;
export function seal(value: unknown, key: Buffer): string;
export function open<T = any>(text: string, key: Buffer): T;
export function normalizeShop(input: unknown): string | null;
export function shopifyHmacOk(params: URLSearchParams, secret: string | undefined): boolean;
