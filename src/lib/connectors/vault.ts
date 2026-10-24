import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { keyFrom, seal, open } from './oauth-core.mjs';

export type Platform = 'shopify' | 'meta' | 'google';
export type Tokens = { access_token: string; refresh_token?: string };
export type Saved = { tokens: Tokens; settings: Record<string, any>; expires_at: string | null };

const key = () => keyFrom(process.env.CREDENTIALS_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
// a sync reads the same row many times in a few seconds; keep it briefly instead of asking the database each call
const cache = new Map<Platform, { at: number; v: Saved | null }>();

/** What the Super Admin connected from the Admin page, or null when they have not. Takes precedence over Vercel keys. */
export async function loadAccess(p: Platform): Promise<Saved | null> {
  const hit = cache.get(p); if (hit && Date.now() - hit.at < 30_000) return hit.v;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data, error } = await supabaseAdmin().from('platform_credentials').select('secret, settings, expires_at').eq('provider', p).maybeSingle();
  if (error) throw new Error(`Could not read saved ${p} access: ${error.message}`);
  let v: Saved | null = null;
  if (data) { try { v = { tokens: open<Tokens>(data.secret, key()), settings: data.settings || {}, expires_at: data.expires_at }; } catch { v = null; /* the key changed: reconnect */ } }
  cache.set(p, { at: Date.now(), v });
  return v;
}

export async function saveAccess(p: Platform, tokens: Tokens, settings: Record<string, any>, expiresAt: Date | null, by?: string) {
  const { error } = await supabaseAdmin().from('platform_credentials').upsert({
    provider: p, secret: seal(tokens, key()), settings, expires_at: expiresAt?.toISOString() ?? null, ...(by ? { connected_by: by } : {}), updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save ${p} access: ${error.message}`);
  cache.delete(p);
}

/** Change the chosen accounts without touching the tokens. */
export async function saveSettings(p: Platform, patch: Record<string, any>) {
  const db = supabaseAdmin();
  const { data } = await db.from('platform_credentials').select('settings').eq('provider', p).maybeSingle();
  if (!data) throw new Error(`Connect ${p} first.`);
  const { error } = await db.from('platform_credentials').update({ settings: { ...data.settings, ...patch }, updated_at: new Date().toISOString() }).eq('provider', p);
  if (error) throw new Error(error.message);
  cache.delete(p);
}

export async function dropAccess(p: Platform) {
  const { error } = await supabaseAdmin().from('platform_credentials').delete().eq('provider', p);
  if (error) throw new Error(error.message);
  cache.delete(p);
}
