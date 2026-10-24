import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** Supabase as the signed-in person. Every query goes through row-level security. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: list => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* called from a server component; middleware refreshes the session */ } },
    },
  });
}
