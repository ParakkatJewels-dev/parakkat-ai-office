export const MAX_SPECIALISTS: number;
export const MAX_REPLY_CHARS: number;
export type ConversationAgent = { id: string; name: string; role_desc: string; department_id: string; is_lead: boolean; enabled: boolean };
export type ConversationTurn = { agentId: string; name: string; content: string };
export type ConversationStep = { phase: 'plan' | 'specialist' | 'final'; prompt: string; agents: ConversationAgent[]; meetingRequested: boolean; assignment?: string; transcript: ConversationTurn[] };
export type ConversationMessage = { role: 'progress' | 'handoff' | 'meeting' | 'assistant'; agentId: string; recipientAgentId?: string; content: string; meetingId?: string | null; metadata?: Record<string, unknown> };
export function conversationText(value: unknown, max?: number): string;
export function normalizeConversationPlan(value: unknown, agents: ConversationAgent[], hostId: string, forceMeeting?: boolean): { title: string; opening: string; answer: string; delegations: { agentId: string; task: string }[] };
export function normalizeConversationReply(value: unknown): string;
export function conversationFailure(error: unknown): string;
export function conversationDialogueEvent(message: ConversationMessage, context: {taskId:string;threadId:string;hostAgentId:string;messageId:string}): {
  kind:'walk'|'report';from:string;to:string;text:string;
  payload:{interaction_mode:'direct';dialogue_phase:'request'|'response';dialogue_id:string;visitor_agent_id:string;recipient_agent_id:string;host_agent_id:string;task_id:string;thread_id:string;message_id:string};
} | null;
export function coordinateConversation(options: {
  host: ConversationAgent; agents: ConversationAgent[]; prompt: string; meetingRequested: boolean;
  ask(agent: ConversationAgent, step: ConversationStep): Promise<unknown>;
  message(message: ConversationMessage): Promise<void>;
  startMeeting(title: string, participants: string[]): Promise<string>;
  finishMeeting(id: string, summary: string): Promise<void>;
}): Promise<{ reply: string; meetingId: string | null; participants: string[] }>;
