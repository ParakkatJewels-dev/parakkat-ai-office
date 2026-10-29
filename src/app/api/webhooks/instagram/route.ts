import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { metaConfig } from '@/lib/connectors/meta';
import { ingestInstagramMessages } from '@/lib/connectors/instagram-inbox';
import { instagramWebhookToken, instagramVerificationChallenge, instagramSignatureValid, readInstagramWebhookBody, parseInstagramWebhook } from '@/lib/connectors/instagram-inbox-core.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'no-store'};

export async function GET(request:Request) {
  const token=instagramWebhookToken(process.env.META_APP_SECRET,process.env.META_WEBHOOK_VERIFY_TOKEN);
  const challenge=instagramVerificationChallenge(new URL(request.url).searchParams,token);
  return challenge===null?NextResponse.json({error:'Invalid webhook verification.'},{status:403,headers})
    :new Response(challenge,{status:200,headers:{...headers,'Content-Type':'text/plain'}});
}

export async function POST(request:Request) {
  if(!process.env.META_APP_SECRET)return NextResponse.json({error:'Instagram webhook is not configured.'},{status:503,headers});
  try {
    const raw=await readInstagramWebhookBody(request);
    if(!instagramSignatureValid(raw,request.headers.get('x-hub-signature-256'),process.env.META_APP_SECRET))return NextResponse.json({error:'Invalid webhook signature.'},{status:401,headers});
    let payload:unknown;
    try{payload=JSON.parse(raw.toString('utf8'));}catch{return NextResponse.json({error:'Invalid webhook JSON.'},{status:400,headers});}
    const config=await metaConfig();
    if(!config?.ig || !config.page)return NextResponse.json({error:'Choose the connected Instagram account and Facebook Page first.'},{status:503,headers});
    const {events,ignored}=parseInstagramWebhook(payload,{igId:config.ig,pageId:config.page});
    // Commit message + task before acknowledging. Slow AI work happens on the scheduler.
    const saved=await ingestInstagramMessages(supabaseAdmin(),events);
    return NextResponse.json({received:true,...saved,ignored},{headers});
  } catch(error) {
    const code=error && typeof error==='object' && 'code' in error?String(error.code):'';
    const status=code==='body_too_large'?413:code==='account_mismatch'?403:code==='invalid_payload'?400:503;
    return NextResponse.json({error:status===503?'The Instagram delivery could not be saved. Retry later.':status===413?'Webhook body is too large.':'Unsupported Instagram delivery.'},{status,headers});
  }
}
