export type SeoResult = { keywords: number; problems: string[] };
export type SeoJob = { name?: string; last_run_at: string | null; last_result: string | null };
export function seoSuccessSummary(result: unknown): string;
export function seoFailureSummary(error: unknown): string;
export function trackSeoJob(args: {
  run: (started: (at: string) => Promise<void>) => Promise<SeoResult>;
  readPrevious: () => Promise<SeoJob | null>;
  writeStarted: (job: SeoJob) => Promise<void>;
  writeFinished: (ownedStart: string, job: SeoJob) => Promise<void>;
}): Promise<SeoResult>;
export function latestSeoJob(job: SeoJob | null | undefined, run: { started_at: string; status: string; stage?: string; state?: unknown; error?: string | null } | null | undefined): SeoJob | null;
