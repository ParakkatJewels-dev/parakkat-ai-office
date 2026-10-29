export type DirectDialogueEvent = { id:string; eventId:string; from:string; to:string; at:string; text:string; visitor:string; recipient:string; phase:'request'|'response'; privateTask:boolean; threadId:string|null; hostId:string|null; messageId:string|null };
export function directDialogueEvent(event: { id:number|string; at:string; kind:string; from_agent:string|null; to_agent:string|null; text:string; payload:Record<string,unknown>|null }): DirectDialogueEvent|null;
export function authorizedDialogueText(event:DirectDialogueEvent,snapshot:unknown): string|null;
