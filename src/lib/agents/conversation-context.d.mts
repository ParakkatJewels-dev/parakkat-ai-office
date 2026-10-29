export function conversationEvidenceKeys(request:string):string[];
export function compactConversationEvidence(shared:Record<string,any>,request:string,phase?:string):Record<string,any>;
export function conversationColleagues(agents:Array<any>,request:string,hostId:string):Array<{agentId:string;name:string;role:string;department:string}>;
export function compactConversationHistory(history:Array<any>,currentPrompt:string,phase?:string):Array<any>;
export function conversationRetryContext(prompt:string,history:Array<any>):string|null;
export function needsConversationWorkHistory(request:string):boolean;
export function compactDiscussion(messages:Array<any>,options?:{phase?:string;meetingRequested?:boolean;assignment?:string}):Array<any>;
