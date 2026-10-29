import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!endpoint || !key) throw new Error('AI Office database configuration is unavailable.');
const db = createClient(endpoint, key, { auth: { persistSession: false, autoRefreshToken: false } });
let cleared = 0;
for (;;) {
  const { data, error } = await db.from('design_refs').select('id,image_path,status,fingerprint')
    .eq('status','ready').not('fingerprint','is',null).not('image_path','is',null).order('id').limit(100);
  if (error) throw error;
  if (!data?.length) break;
  if (!apply) { console.log(JSON.stringify({readyPreviews:data.length,firstBatchOnly:true,apply:false})); break; }
  for (const ref of data) {
    if (!ref.image_path?.startsWith('library/')) throw new Error('Unexpected storage path for reference '+ref.id);
    const removed = await db.storage.from('creatives').remove([ref.image_path]);
    if (removed.error) throw removed.error;
    const saved = await db.from('design_refs').update({image_path:null}).eq('id',ref.id)
      .eq('image_path',ref.image_path).eq('status','ready').select('id').maybeSingle();
    if (saved.error || !saved.data) throw saved.error || new Error('The deleted preview path could not be cleared for '+ref.id);
    cleared++;
    if (cleared % 25 === 0) console.log(JSON.stringify({cleared}));
  }
}
console.log(JSON.stringify({cleared,apply}));
