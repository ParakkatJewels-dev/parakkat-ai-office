export const OPPORTUNITY_SCHEDULE: { every: number; hours: [number, number] };
export function chooseDueJob<T extends { name: string; every: number; hours?: [number, number] }>(jobs: T[], last: Record<string, number>, now?: Date): T | null;
