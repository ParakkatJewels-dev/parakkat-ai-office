export function odooBranchNames(values: unknown): string[];
export function includedOdooBranch(branch: unknown, excluded: unknown): boolean;
export function withoutOdooBranches<T extends { not: (column: string, operator: string, value: string) => T }>(query: T, excluded: unknown, column?: string): T;
export function selectedOdooBranches(choices: unknown, included: unknown): string[];
