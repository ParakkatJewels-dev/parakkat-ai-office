import type { ConversationAgent } from './conversation-core.mjs';
export type ConversationRoute = { kind: 'direct' } | { kind: 'specialist'; agentId: string };
export function conversationRoutingCandidates(prompt: string, host: ConversationAgent, agents: ConversationAgent[]): ConversationAgent[];
export function deterministicConversationRoute(prompt: string, host: ConversationAgent, agents: ConversationAgent[], meetingRequested?: boolean): ConversationRoute | null;
export function conversationRoutingQuestion(candidates: ConversationAgent[]): { route: { instructions: string; criteria: Record<string, string> } };
export function acceptedConversationRoute(answer: Record<string, { choice: string; confidence: number; probabilities: Record<string, number> }> | undefined, candidates: ConversationAgent[]): ConversationRoute | null;
export function routedConversationPlan(route: ConversationRoute): { title: string; delegations: { agentId: string; task: string }[]; answer: string };
