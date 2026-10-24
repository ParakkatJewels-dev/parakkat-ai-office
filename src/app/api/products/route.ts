import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { PRODUCT_PAGE as PAGE } from '@/lib/limits';

/** Active Shopify products with a photo, a page at a time, for pickers that search as you type. */
export async function GET(req: Request) {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const u = new URL(req.url), q = (u.searchParams.get('q') || '').trim().slice(0, 80).replace(/[%_\\,()]/g, '');
  const page = Math.max(0, parseInt(u.searchParams.get('page') || '0', 10) || 0);
  let query = db.from('products').select('id, title, price, image_url').eq('status', 'ACTIVE').not('image_url', 'is', null);
  if (q) query = query.ilike('title', `%${q}%`);
  // one row past the page tells the picker whether to offer "Show more"
  const { data, error } = await query.order('updated_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: (data || []).slice(0, PAGE), more: (data || []).length > PAGE }, { headers: { 'cache-control': 'private, max-age=30' } });
}
