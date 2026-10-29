export function carouselIntent(request: string): string | null;
export function salesPosterIntent(request: string): { category: string | null; format: 'poster' | 'portrait' } | null;
export function carouselRedesignIntent(request: string): boolean;
export function carouselIdFromConversation(request: string, history?: { content?: string }[]): string | null;
export function carouselSelection(evidence: any): any[];
