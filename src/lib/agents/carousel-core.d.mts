export function carouselIntent(request: string): string | null;
export function requestedPosterCount(request: string): number;
export function requestedPosterProductCount(request: string): number;
export function posterGenderMatches(tags: string[] | null | undefined, request: string): boolean;
export function salesPosterIntent(request: string): { category: string | null; format: 'poster' | 'portrait'; count: number; productCount: number; cohesiveSeries:boolean } | null;
export function productArtworkIntent(request:string):{format:'poster'|'web_banner'|'portrait';count:number;cohesiveSeries:boolean;ids:number[];handles:string[]}|null;
export function carouselRedesignIntent(request: string): boolean;
export function carouselIdFromConversation(request: string, history?: { content?: string }[]): string | null;
export function carouselSelection(evidence: any): any[];
