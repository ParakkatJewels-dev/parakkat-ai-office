'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errText } from '@/lib/errors';

async function admin() { const u = await requireUser(); if (u.role !== 'super_admin') redirect('/office'); return u; }
const num = (v: FormDataEntryValue | null, what: string, { min = 0, max = 1e9 } = {}) => {
  const s = String(v ?? '').trim(); if (!s) return null;
  const n = Number(s.replace(/[,₹$\s]/g, '')); if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${what} should be a number from ${min} to ${max}.`); return n;
};
const done = (msg: string) => { revalidatePath('/usage'); redirect(`/usage?msg=${encodeURIComponent(msg)}`); };
const fail = (e: unknown) => redirect(`/usage?error=${encodeURIComponent(errText(e))}`);

/** Exchange rate, monthly budget and when to warn. */
export async function saveBilling(form: FormData) {
  await admin();
  try {
    const { error } = await supabaseAdmin().from('billing_settings').upsert({ id: 1, usd_inr: num(form.get('usd_inr'), 'The dollar rate', { min: 1, max: 1000 }) ?? 88,
      monthly_budget_inr: num(form.get('budget'), 'The monthly budget'), alert_pct: num(form.get('alert'), 'The alert level', { min: 10, max: 100 }) ?? 80, alerted_month: null });
    if (error) throw error;
  } catch (e) { fail(e); }
  done('Billing settings saved.');
}

/** A monthly plan (Vercel, Supabase, a domain...). An empty name with an id removes it. */
export async function saveFixedCost(form: FormData) {
  await admin();
  try {
    const id = String(form.get('id') || ''), name = String(form.get('name') || '').trim().slice(0, 80), db = supabaseAdmin();
    if (id && form.get('remove')) { const { error } = await db.from('fixed_costs').update({ active: false }).eq('id', id); if (error) throw error; }
    else {
      if (!name) throw new Error('Name the plan.');
      const row = { name, monthly_usd: num(form.get('usd'), 'The monthly cost') ?? 0, note: String(form.get('note') || '').trim().slice(0, 200) || null, active: true };
      const { error } = id ? await db.from('fixed_costs').update(row).eq('id', id) : await db.from('fixed_costs').insert(row);
      if (error) throw error;
    }
  } catch (e) { fail(e); }
  done('Monthly plans saved.');
}

/** A model's price, so the estimates match your invoices. */
export async function savePrice(form: FormData) {
  await admin();
  try {
    const key = String(form.get('key') || '').trim().toLowerCase();
    if (!/^[a-z]+:[\w.*-]{1,60}$/.test(key)) throw new Error('The price key looks like openai:gpt-4.1 or gemini:*.');
    const { error } = await supabaseAdmin().from('usage_prices').upsert({ key, in_per_m: num(form.get('in'), 'Input price') ?? 0, out_per_m: num(form.get('out'), 'Output price') ?? 0,
      per_unit: num(form.get('unit'), 'Price per call') ?? 0, note: String(form.get('note') || '').trim().slice(0, 200) || null, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (e) { fail(e); }
  done('Price saved. New calls use it; past calls keep the cost they were logged with.');
}
