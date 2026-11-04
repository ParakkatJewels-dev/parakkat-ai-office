export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A relative folder under the editing computer's configured media root.
export function sourceFolder(value) {
  if (typeof value !== 'string' || value.length > 240) return null;
  const parts = value.trim().replaceAll('\\', '/').split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || !/^[\p{L}\p{N}_][\p{L}\p{N} ._-]*$/u.test(part))) return null;
  return parts.join('/');
}

export function outputName(value) {
  if (typeof value !== 'string' || value.length > 120) return null;
  const name = value.trim().replace(/\.mp4$/i, '');
  return name && Buffer.byteLength(name, 'utf8') <= 180 && /^[\p{L}\p{N}_][\p{L}\p{N} ._-]*$/u.test(name) ? name : null;
}

export function safeWorkerText(value, max = 300) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max && !/[\u0000-\u001f\u007f]/u.test(text) ? text : null;
}
