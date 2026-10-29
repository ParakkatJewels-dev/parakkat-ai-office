import { workflowSession, taskFor, WorkflowError } from '@/lib/automation/service';
export const dynamic='force-dynamic';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const s=await workflowSession(),{id}=await params,task=await taskFor(s,id);
    const r=task.result;
    const body=`# ${task.title}\n\nStatus: ${task.status}\nOwner: ${task.owner_agent}\nCreated: ${task.created_at}\n\n${r?.markdown||task.brief}\n\n${r?.warnings?.length?'## Coverage and limitations\n\n'+r.warnings.map(w=>`- ${w}`).join('\n'):''}\n\n${r?.evidence?.length?'## Recorded evidence\n\n'+r.evidence.map(e=>`- ${e.source}: ${e.detail}${e.at?` (${e.at})`:''}`).join('\n'):''}\n`;
    return new Response(body,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="ai-office-${task.id}.md"`,'Cache-Control':'private, no-store'}});
  }catch(e){return Response.json({error:e instanceof WorkflowError?e.message:'Could not export this task.'},{status:e instanceof WorkflowError?e.status:500});}
}
