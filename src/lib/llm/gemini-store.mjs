// Private VPS storage. This module must only be imported by server code.
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cleanGeminiKey, GeminiError, publicGeminiConfig, resolveGeminiConfig } from './gemini-core.mjs';

const signature = config => createHash('sha256').update(`${config.apiKey}\0${config.imageModel}\0${config.imageSize}`).digest('hex');
const safeError = error => error instanceof GeminiError ? error.message : 'Gemini image generation could not be verified. Try again.';

export function createGeminiStore({ directory, env = process.env } = {}) {
  const dir = () => resolve(directory || env.GEMINI_CONFIG_DIR || join(homedir(), '.config/parakkat-ai-office/provider-secrets'));
  const owner = process.getuid?.();
  const privateFile = stat => stat.isFile() && (owner == null || stat.uid === owner) && (stat.mode & 0o077) === 0;
  async function prepare() {
    const target = dir();
    const segments = []; let current = target;
    while (current !== parse(current).root) { segments.unshift(current); current = dirname(current); }
    for (const path of segments) {
      try { if ((await lstat(path)).isSymbolicLink()) throw new Error('symlink'); }
      catch (e) { if (e.code !== 'ENOENT') throw new GeminiError('The Gemini secret directory must not use symbolic links.', 'storage'); }
    }
    await mkdir(target, { recursive: true, mode: 0o700 });
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (owner != null && stat.uid !== owner) || (stat.mode & 0o077))
      throw new GeminiError('The Gemini secret directory needs private permissions and the app’s owner.', 'storage');
    return target;
  }
  async function read(target) {
    let file;
    try { file = await open(join(target, 'gemini.json'), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (e) { if (e.code === 'ENOENT') return {}; throw new GeminiError('The saved Gemini configuration could not be read safely.', 'storage'); }
    try {
      const stat = await file.stat();
      if (!privateFile(stat) || stat.size > 16_384) throw new Error('permissions');
      const data = JSON.parse(await file.readFile('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data) || (data.apiKey != null && typeof data.apiKey !== 'string')) throw new Error('format');
      return data;
    } catch { throw new GeminiError('The saved Gemini configuration is unreadable or has unsafe permissions.', 'storage'); }
    finally { await file.close(); }
  }
  const configFor = data => resolveGeminiConfig(data.apiKey ? { tokens: { access_token: data.apiKey } } : null, env);
  async function update(change) {
    const target = await prepare(), lockPath = join(target, '.gemini.lock');
    let lock;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw new GeminiError('The Gemini configuration could not be saved safely.', 'storage');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    if (!lock) throw new GeminiError('Another Gemini configuration update is in progress. Try again shortly.', 'storage_busy');
    let temporary;
    try {
      const next = change(await read(target));
      if (!next) return;
      temporary = join(target, `.gemini-${randomUUID()}.tmp`);
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(JSON.stringify(next)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(target, 'gemini.json')); temporary = undefined;
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      await lock.close(); await unlink(lockPath);
    }
  }
  return {
    async getConfig() { return configFor(await read(await prepare())); },
    async getStatus() {
      const data = await read(await prepare()), config = configFor(data);
      const health = data.imageCheck?.signature === signature(config) ? data.imageCheck : null;
      return { ...publicGeminiConfig(config), status: !config.apiKey ? 'not_connected' : health?.ok === true ? 'connected' : health?.ok === false ? 'error' : 'configured',
        error: health?.ok === false ? health.error : null, checkedAt: health?.at || null, updatedAt: data.updatedAt || null };
    },
    async saveKey(value) {
      const apiKey = cleanGeminiKey(value);
      await update(() => ({ apiKey, updatedAt: new Date().toISOString() }));
    },
    async useEnvironment() { await update(() => ({ apiKey: null, updatedAt: new Date().toISOString() })); },
    async recordImageResult(config, error) {
      await update(data => signature(configFor(data)) !== signature(config) ? null : {
        ...data, imageCheck: { signature: signature(config), ok: !error, at: new Date().toISOString(), error: error ? safeError(error) : null },
      });
    },
  };
}
