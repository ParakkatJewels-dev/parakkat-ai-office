export function shopifyPhotoUrl(value: unknown): string | null;
export function fetchShopifyPhoto(value: unknown, fetcher?: typeof fetch): Promise<Buffer>;
export function imageReferencePart(bytes: Buffer): Promise<{inlineData:{mimeType:'image/png';data:string}}>;
export function renderCarouselCard(input: { title: string; index: number; total?: number; category?: string; sceneBytes: Buffer }): Promise<{data: Buffer; mimeType: 'image/png'; width: number; height: number}>;
