// Server-side settings. Read lazily so a missing key only breaks the feature that needs it.
export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Add it in Vercel > Project Settings > Environment Variables (see .env.example).`);
  return v;
}
export const has = (...names: string[]) => names.every(n => !!process.env[n]);
export const opt = (name: string, fallback: string) => process.env[name] || fallback;
