export function folderIdFrom(input: unknown): string | null;
export const DESIGN_MIMES: string[];
export function isDesignFile(mime: string): boolean;
export function childrenQuery(folderId: string, since?: string | null): string;
export function bigThumb(link: string, size?: number): string;
export function searchWords(...texts: string[]): string;
export function refLine(r: { occasion?: string | null; style?: string | null; layout?: string | null; palette?: string | null; typography?: string | null }, i: number): string;
export function recentConcepts(rows: { concept?: string | null }[], max?: number): string[];
export function versionPath(path: string, n: number): string;
