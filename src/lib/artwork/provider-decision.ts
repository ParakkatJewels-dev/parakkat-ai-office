import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function selectedProviderForRequest(source:string,id:string,requestId:string):Promise<'chatgpt'|'higgsfield'|null> {
  const {data,error}=await supabaseAdmin().from('artwork_provider_decisions').select('provider')
    .eq('source',source).eq('item_id',id).eq('request_id',requestId).maybeSingle();
  if(error)throw new Error('Artwork provider decisions are unavailable. Apply the latest database migration.');
  return data?.provider==='chatgpt'||data?.provider==='higgsfield'?data.provider:null;
}
