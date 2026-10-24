'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';

export async function signIn(form: FormData) {
  const db = await supabaseServer();
  const email = String(form.get('email') || '').trim(), password = String(form.get('password') || '');
  if (!password) {
    const origin = (await headers()).get('origin') || '';
    const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: false } });
    redirect(error ? `/login?error=${encodeURIComponent(error.message)}` : '/login?sent=1');
  }
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect('/office');
}

export async function signOut() {
  await (await supabaseServer()).auth.signOut();
  redirect('/login');
}
