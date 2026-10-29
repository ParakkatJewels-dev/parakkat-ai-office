export type PendingConversationRequest = { text: string; thread: string | null; meeting: boolean; id: string };
export function prepareConversationRequest(
  pending: PendingConversationRequest | null,
  input: { message: string; threadId: string | null; meeting: boolean },
  makeId: () => string,
): { pending: PendingConversationRequest; body: { message: string; threadId?: string; clientId: string; meeting: boolean } };
