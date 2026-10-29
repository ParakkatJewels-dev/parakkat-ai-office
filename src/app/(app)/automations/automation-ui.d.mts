export function taskStatus(task: {kind:string;status:string;state?:{blockedReason?:string;headWorkflow?:any}}): string;
export function isOverdue(task: {due_at:string|null;status:string}, now?:number): boolean;
export function dueInIST(value:string): string|undefined;
export function submissionKey(previous:{signature:string;id:string}|null,body:unknown,makeId:()=>string): {signature:string;id:string};
export function productIds(value:string): number[];
export function actionLabel(kind:string,fallback?:string): string;
export function safeHref(value:unknown): string|null;
export function instagramReplyAvailability(inquiry:{channel:string;status:string;reply_text?:string|null;replied_at?:string|null;provider_deleted_at?:string|null;provider_received_at?:string|null;provider_account_id?:string|null},now?:number): {allowed:boolean;reason:string};
export function suggestedWorkflow(agent:{id:string;department_id:string}|undefined,templates:{kind:string;canRun:boolean;ownerAgent:string}[]): string|null;

export function headOwnerFor<T extends {id:string;department_id:string;is_lead?:boolean;enabled?:boolean}>(agents:T[],agentId?:string):T|null;

export function headReportHref(task:{state?:Record<string,any>}):string|null;
export function headAssignmentProgress(flow:Record<string,any>,agentId:string):{label:string;returned:boolean;blocked:boolean;revising:boolean};
export function headTaskProgress(task:{status:string;state?:Record<string,any>}):Array<{label:string;detail:string;done:boolean;state:string}>;

export function headReviewAttribution(flow:Record<string,any>):string;
