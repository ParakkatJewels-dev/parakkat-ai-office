'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { headsDept } from '@/lib/auth/depts';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runSeo } from '@/lib/agents/seo';

export async function runSeoNow() {
  const { db, role } = await requireUser();
  if (!(await headsDept(db, role, 'seo'))) redirect('/office');
  let note = '';
  try {
    const r = await runSeo(supabaseAdmin());
    note = `${r.keywords} search terms saved.${r.problems.length ? ` Not everything worked: ${r.problems.join(' · ')}` : ''}`;
  } catch (e) { redirect(`/seo?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`); }
  revalidatePath('/seo');
  redirect(`/seo?msg=${encodeURIComponent(note)}`);
}
