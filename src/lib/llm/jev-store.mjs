// Private VPS storage. This module must only be imported by server code.
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cleanJevKey, JevError, publicJevConfig, resolveJevConfig } from './jev-core.mjs';

const signature = config => createHash('sha256').update(`${config.apiKey}\0${config.model}`).digest('hex');
const safeError = error => error instanceof JevError ? error.message : 'Jev classification could not be verified. Try again.';
// The VPS runs one Next.js Node process and stops it before starting its replacement.
// Share the mutex across module bundles/store instances. A process crash releases it
// without leaving a lock file. Multiple app processes would require a shared lock.
const mutexKey = Symbol.for('parakkat.jev-config-mutexes.v1');
const mutexes = globalThis[mutexKey] ||= new Map();

export function createJevStore({ directory, env = process.env } = {}) {
  const dir = () => resolve(directory || env.JEV_CONFIG_DIR || env.GEMINI_CONFIG_DIR || join(homedir(), '.config/parakkat-ai-office/provider-secrets'));
  const owner = process.getuid?.();
  const privateFile = stat => stat.isFile() && (owner == null || stat.uid === owner) && (stat.mode & 0o077) === 0;
  async function prepare() {
    const target = dir();
    const segments = []; let current = target;
    while (current !== parse(current).root) { segments.unshift(current); current = dirname(current); }
    for (const path of segments) {
      try { if ((await lstat(path)).isSymbolicLink()) throw new Error('symlink'); }
      catch (e) { if (e.code !== 'ENOENT') throw new JevError('The Jev secret directory must not use symbolic links.', 'storage'); }
    }
    await mkdir(target, { recursive: true, mode: 0o700 });
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (owner != null && stat.uid !== owner) || (stat.mode & 0o077))
      throw new JevError('The Jev secret directory needs private permissions and the app’s owner.', 'storage');
    return target;
  }
  async function read(target) {
    let file;
    try { file = await open(join(target, 'jev.json'), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (e) { if (e.code === 'ENOENT') return {}; throw new JevError('The saved Jev configuration could not be read safely.', 'storage'); }
    try {
      const stat = await file.stat();
      if (!privateFile(stat) || stat.size > 16_384) throw new Error('permissions');
      const data = JSON.parse(await file.readFile('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data) || (data.apiKey != null && typeof data.apiKey !== 'string')) throw new Error('format');
      return data;
    } catch { throw new JevError('The saved Jev configuration is unreadable or has unsafe permissions.', 'storage'); }
    finally { await file.close(); }
  }
  const configFor = data => resolveJevConfig(data, env);
  async function update(change) {
    const target = await prepare(), previous = mutexes.get(target) || Promise.resolve();
    const work = previous.then(async () => {
      let temporary;
      try {
        // Reading inside the mutex prevents a late health write restoring an old key.
        const next = change(await read(target));
        if (!next) return;
        temporary = join(target, `.jev-${randomUUID()}.tmp`);
        const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await file.writeFile(JSON.stringify(next)); await file.sync(); } finally { await file.close(); }
        await rename(temporary, join(target, 'jev.json')); temporary = undefined;
      } finally {
        if (temporary) await unlink(temporary).catch(() => {});
      }
    });
    const released = work.then(() => {}, () => {});
    mutexes.set(target, released);
    try { await work; }
    finally { if (mutexes.get(target) === released) mutexes.delete(target); }
  }
  return {
    async getConfig() { return configFor(await read(await prepare())); },
    async getStatus() {
      const data = await read(await prepare()), config = configFor(data);
      const health = data.check?.signature === signature(config) ? data.check : null;
      return { ...publicJevConfig(config), status: !config.apiKey ? 'not_connected' : health?.ok === true ? 'connected' : health?.ok === false ? 'error' : 'configured',
        error: health?.ok === false ? health.error : null, checkedAt: health?.at || null, updatedAt: data.updatedAt || null };
    },
    async saveKey(value) {
      const apiKey = cleanJevKey(value);
      await update(() => ({ apiKey, updatedAt: new Date().toISOString() }));
    },
    async useEnvironment() { await update(() => ({ apiKey: null, updatedAt: new Date().toISOString() })); },
    async recordResult(config, error) {
      await update(data => signature(configFor(data)) !== signature(config) ? null : {
        ...data, check: { signature: signature(config), ok: !error, at: new Date().toISOString(), error: error ? safeError(error) : null },
      });
    },
  };
}
