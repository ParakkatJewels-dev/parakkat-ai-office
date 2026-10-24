export type GoogleChoice = { id: string; name: string; manager: boolean; via?: string };
export function googleId(id: unknown): string;
export function metaId(id: unknown): string;
export function chosen(list: unknown, single?: unknown): string[];
export function googleTargets(ids: string[], customers?: GoogleChoice[], login?: string): { id: string; login?: string }[];
export function googleLabel(c: GoogleChoice, customers?: GoogleChoice[]): string;
export function metaAdLabel(a: { id: string; name?: string }): string;
export function pageLabel(p: { id: string; name: string; ig_name?: string | null }): string;
