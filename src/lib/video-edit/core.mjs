export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Return a folder relative to the editing computer's configured media root.
// A pasted absolute path is accepted only when it is inside that known root.
export function sourceFolder(value, mediaRoot) {
  if (typeof value !== 'string' || value.length > 240) return null;
  let folder = value.trim();
  if (folder.startsWith('"') && folder.endsWith('"')) folder = folder.slice(1, -1);
  folder = folder.replaceAll('\\', '/').replace(/\/+$/, '');
  const absolute = /^[A-Za-z]:\//u.test(folder) || folder.startsWith('/');
  if (absolute) {
    if (typeof mediaRoot !== 'string' || !mediaRoot.trim()) return null;
    const root = mediaRoot.trim().replaceAll('\\', '/').replace(/\/+$/, '');
    const windowsRoot = /^[A-Za-z]:\//u.test(root);
    const normalizedFolder = windowsRoot ? folder.toLowerCase() : folder;
    const normalizedRoot = windowsRoot ? root.toLowerCase() : root;
    if (!normalizedFolder.startsWith(normalizedRoot + '/')) return null;
    folder = folder.slice(root.length + 1);
  }
  const parts = folder.split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || part.trim() !== part || part.endsWith('.') || /[<>:"|?*\u0000-\u001f\u007f]/u.test(part))) return null;
  return parts.join('/');
}

export function outputName(value) {
  if (typeof value !== 'string' || value.length > 120) return null;
  const name = value.trim().replace(/\.mp4$/i, '').trim().replace(/\s+/gu, '-');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(name) ? name : null;
}

export function safeWorkerText(value, max = 300) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max && !/[\u0000-\u001f\u007f]/u.test(text) ? text : null;
}
