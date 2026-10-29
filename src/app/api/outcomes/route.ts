import { after } from 'next/server';
import { workflowOriginAllowed } from '@/lib/automation/core.mjs';
import { OutcomeError,getOutcomes,mutateOutcome,outcomeSession,refreshOutcomeMonitoring } from '@/lib/outcomes/service';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=180;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const failure=(e:unknown)=>e instanceof OutcomeError?json({error:e.message},e.status):json({error:'The outcome request could not be completed. Refresh and check the saved state.'},503);
export async function GET(){try{return json(await getOutcomes(await outcomeSession()));}catch(e){return failure(e);}}
export async function POST(req:Request){try{
 if(!workflowOriginAllowed(req.headers.get('origin'),req.url,process.env.APP_URL))throw new OutcomeError('The request must come from AI Office.',403);
 if(!req.headers.get('content-type')?.includes('application/json'))throw new OutcomeError('Send a JSON request.');
 const raw=await req.text();if(raw.length>40000)throw new OutcomeError('This request is too large.',413);
 let body;try{body=JSON.parse(raw);}catch{throw new OutcomeError('Send a valid JSON request.');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new OutcomeError('Invalid request.');
 const id=await mutateOutcome(await outcomeSession(),body);
 after(()=>refreshOutcomeMonitoring(undefined,{force:true}).catch(()=>null));
 return json({ok:true,id});
 }catch(e){return failure(e);}}
