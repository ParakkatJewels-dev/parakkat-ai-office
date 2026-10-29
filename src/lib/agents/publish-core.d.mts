export const MANUAL_CHANNEL_MESSAGE: string;
export const REVIEW_MESSAGE: string;
export function publicationBlock(campaign: { status?: string; channels?: string[] } | null | undefined): string | null;
export function hasConfirmedPublication(campaign: any, approvalId: string): boolean;
export type PublicationStore = {
  read(id: string): Promise<{ approval: any; campaign: any }>;
  claim(id: string, ids: Record<string, unknown>): Promise<boolean>;
  checkpoint(id: string, attempt: string, ids: Record<string, unknown>): Promise<void>;
  finish(id: string, approvalId: string, ids: Record<string, unknown>): Promise<void>;
  release(id: string, attempt: string, ids: Record<string, unknown>): Promise<void>;
  review(id: string, attempt: string, ids: Record<string, unknown>): Promise<void>;
};
export function publishApprovedPlan(options: {
  approvalId: string; store: PublicationStore;
  prepare(campaign: any): Promise<any>;
  launch(campaign: any, prepared: any): Promise<any>;
  checkPause(): Promise<void>;
  notify?(campaign: any): Promise<void>;
  now?(): string;
}): Promise<Record<string, any>>;
