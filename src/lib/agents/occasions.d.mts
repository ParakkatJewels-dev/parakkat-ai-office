export type Occasion = { name: string; date: string; lead: number; why: string };
export const OCCASIONS: Occasion[];
export function upcoming(today?: Date, days?: number): (Occasion & { left: number; due: boolean })[];
export function covered(occasion: string, existing: string[]): boolean;
