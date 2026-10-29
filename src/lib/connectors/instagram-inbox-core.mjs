import { createHmac, timingSafeEqual } from 'node:crypto';

export const INSTAGRAM_INBOX_PERMISSIONS = ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata'];
export const INSTAGRAM_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INSTAGRAM_WEBHOOK_MAX_BYTES = 1024 * 1024;
const numericId = value => typeof value === 'string' && /^\d{1,50}$/.test(value);
const opaqueId = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u0020]/.test(value);
const clean = (value, limit) => typeof value === 'string' ? Array.from(value.replaceAll('\0', '')).slice(0, limit).join('').trim() : '';
export const instagramInboxError = (code, message, requiresReview = false) => Object.assign(new Error(message), { code, requiresReview });

export function instagramWebhookToken(appSecret, dedicatedToken) {
  if (typeof dedicatedToken === 'string' && dedicatedToken.length >= 16) return dedicatedToken;
  return typeof appSecret === 'string' && appSecret.length >= 16
    ? createHmac('sha256', appSecret).update('parakkat-ai-office:instagram-webhook:v1').digest('base64url') : null;
}

export function instagramVerificationChallenge(params, expectedToken) {
  const token = params.get('hub.verify_token') || '', challenge = params.get('hub.challenge') || '';
  if (params.get('hub.mode') !== 'subscribe' || !expectedToken || !/^\d{1,100}$/.test(challenge)) return null;
  const actual = Buffer.from(token), expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? challenge : null;
}

export function instagramSignatureValid(raw, signature, appSecret) {
  if (!appSecret || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const actual = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(raw).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Enforce the byte limit while streaming, before JSON parsing or signature work. */
export async function readInstagramWebhookBody(request, maxBytes = INSTAGRAM_WEBHOOK_MAX_BYTES) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw instagramInboxError('body_too_large', 'Webhook body is too large.');
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw instagramInboxError('body_too_large', 'Webhook body is too large.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

function receivedTime(value, now) {
  const ms = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value) : Date.parse(value);
  // Epoch seconds are accepted from Graph's timestamp fields; webhooks normally send milliseconds.
  const time = ms < 100000000000 ? ms * 1000 : ms;
  return Number.isFinite(time) && time > 0 && time <= now + 5 * 60 * 1000 ? new Date(time).toISOString() : null;
}

/** No attachment URLs are fetched. The caller may show the saved unsupported-message note. */
function messageBody(text, deleted) {
  if (deleted) return '[This Instagram message was deleted by its sender.]';
  return clean(text, 6000) || '[Instagram attachment or unsupported message. Open Instagram to review its contents.]';
}

export function parseInstagramWebhook(payload, account, now = Date.now()) {
  if (!numericId(account?.igId) || !numericId(account?.pageId)) throw instagramInboxError('not_configured', 'Choose an Instagram account and its linked Facebook Page.');
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry) || payload.entry.length > 100) {
    throw instagramInboxError('invalid_payload', 'Unsupported Instagram webhook payload.');
  }
  const events = [], seen = new Set();
  let count = 0, ignored = 0;
  for (const entry of payload.entry) {
    if (![account.igId, account.pageId].includes(String(entry?.id || ''))) throw instagramInboxError('account_mismatch', 'This Instagram account is not selected.');
    if (entry.messaging !== undefined && !Array.isArray(entry.messaging)) throw instagramInboxError('invalid_payload', 'Unsupported Instagram webhook messages.');
    for (const item of entry.messaging || []) {
      if (++count > 200) throw instagramInboxError('invalid_payload', 'Too many Instagram messages in one delivery.');
      const message = item?.message;
      if (!message) { ignored++; continue; }
      const senderId = String(item.sender?.id || ''), recipientId = String(item.recipient?.id || '');
      if (message.is_echo || message.is_self || senderId === account.igId || senderId === account.pageId) { ignored++; continue; }
      if (recipientId !== account.igId) throw instagramInboxError('account_mismatch', 'The message recipient is not the selected Instagram account.');
      const messageId = message.mid, at = receivedTime(item.timestamp, now);
      if (!numericId(senderId) || !opaqueId(messageId) || !at) throw instagramInboxError('invalid_payload', 'The message is missing its provider ID, sender or timestamp.');
      const deleted = message.is_deleted === true, key = `${messageId}:${deleted}`;
      if (seen.has(key)) { ignored++; continue; }
      seen.add(key);
      events.push({ accountId: account.igId, messageId, senderId, receivedAt: at,
        body: messageBody(message.text, deleted), contactName: '', conversationRef: null, deleted });
    }
  }
  return { events, ignored };
}

export function normaliseInstagramMessage(message, account, conversationRef = null, now = Date.now()) {
  const senderId = String(message?.from?.id || ''), recipientIds = message?.to?.data?.map(item => String(item.id || '')) || [];
  if (!numericId(senderId) || [account.igId, account.pageId].includes(senderId) || !recipientIds.includes(account.igId)) return null;
  const receivedAt = receivedTime(message.created_time, now);
  if (!opaqueId(message.id) || !receivedAt) return null;
  return { accountId: account.igId, messageId: message.id, senderId, receivedAt,
    body: messageBody(message.message, false), contactName: clean(message.from?.username || message.from?.name, 200),
    conversationRef: opaqueId(conversationRef) ? conversationRef : null, deleted: false };
}

export function instagramReplyAllowed(receivedAt, now = Date.now()) {
  const at = Date.parse(receivedAt);
  return Number.isFinite(at) && at <= now && now - at < INSTAGRAM_REPLY_WINDOW_MS;
}

export function validateInstagramReply({ recipientId, text, inquiryReceivedAt, accountId, pageId }, now = Date.now()) {
  if (!numericId(recipientId) || recipientId === accountId || recipientId === pageId) throw instagramInboxError('invalid_recipient', 'The saved customer recipient is invalid.');
  if (typeof text !== 'string' || !text.trim() || text.includes('\0') || Buffer.byteLength(text, 'utf8') > 1000) {
    throw instagramInboxError('invalid_reply', 'Instagram replies must contain 1–1000 UTF-8 bytes. Shorten the reply before sending.');
  }
  if (!instagramReplyAllowed(inquiryReceivedAt, now)) throw instagramInboxError('reply_window_closed', 'This message is outside the 24-hour reply window. Continue with a human in Instagram.');
  return { recipient: { id: recipientId }, message: { text } };
}

/** Fixed Graph host and caller-owned path; never follow a provider-supplied paging URL. */
export async function instagramGraphRequest({ graphBase, path, token, params = {}, method = 'GET', body, signal, fetchImpl = fetch }) {
  const base = new URL(graphBase);
  if (base.origin !== 'https://graph.facebook.com' || !/^\/v\d+\.\d+\/?$/.test(base.pathname) || !token) throw instagramInboxError('invalid_configuration', 'Instagram API access is not configured.');
  if (typeof path !== 'string' || !/^(?:[A-Za-z0-9_\-=:./]|%[0-9a-fA-F]{2})+$/.test(path) || decodeURIComponent(path).includes('..') || path.startsWith('/') || path.includes('//')) {
    throw instagramInboxError('invalid_path', 'Invalid Instagram API resource.');
  }
  const url = new URL(`${base.href.replace(/\/$/, '')}/${path}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const timeout = AbortSignal.timeout(12000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(url, { method, redirect: 'error', cache: 'no-store', signal: combined,
      headers: { authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw instagramInboxError(method === 'POST' ? 'instagram_send_review' : 'instagram_unavailable', method === 'POST'
      ? 'Instagram did not confirm the reply. Check the Instagram inbox before taking further action.'
      : 'Instagram could not be reached. Retry the inbox check later.', method === 'POST');
  }
  let data;
  try { data = await response.json(); } catch {
    throw instagramInboxError(method === 'POST' ? 'instagram_send_review' : 'instagram_unavailable', method === 'POST'
      ? 'Instagram returned an unreadable reply result. Check the Instagram inbox before taking further action.'
      : 'Instagram returned an unreadable response.', method === 'POST');
  }
  if (!response.ok || data?.error) {
    const expired = data?.error?.code === 190, denied = [10, 200, 230].includes(data?.error?.code) || response.status === 403;
    throw instagramInboxError(method === 'POST' ? 'instagram_send_review' : expired ? 'instagram_auth' : denied ? 'instagram_permissions' : 'instagram_unavailable',
      method === 'POST' ? 'Instagram did not confirm the reply. Review the provider inbox and permissions; this attempt will not be repeated automatically.'
        : expired ? 'Reconnect Meta: Instagram access has expired.'
          : denied ? 'Instagram inbox access is missing. Reconnect Meta with messaging permissions and check app access approval.'
            : 'Instagram could not complete the inbox request.', method === 'POST');
  }
  return data;
}

export async function sendInstagramMessage({ graphBase, pageId, pageToken, recipientId, text, inquiryReceivedAt, accountId }, options = {}) {
  const body = validateInstagramReply({ recipientId, text, inquiryReceivedAt, accountId, pageId }, options.now ?? Date.now());
  if (!numericId(pageId)) throw instagramInboxError('invalid_configuration', 'A linked Facebook Page is required.');
  const result = await instagramGraphRequest({ graphBase, path: `${pageId}/messages`, token: pageToken, method: 'POST', body, ...options });
  if (!opaqueId(result?.message_id) || (result.recipient_id && result.recipient_id !== recipientId)) {
    throw instagramInboxError('instagram_send_review', 'Instagram did not return a matching message receipt. Check the inbox before taking further action.', true);
  }
  return { messageId: result.message_id };
}
