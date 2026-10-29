import { requireUser } from '@/lib/auth/session';
import { UUID, canManageDepartment } from '@/lib/automation/core.mjs';
import Automations from './Automations';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {role,db,user}=await requireUser(),params=await searchParams;
  let initialAgent='',initialBrief='';
  const requestedAgent=typeof params.agent==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(params.agent)?params.agent:'';
  const threadId=typeof params.thread==='string'&&UUID.test(params.thread)?params.thread:'';
  if(threadId) {
    // Both owner filtering and the signed-in client's current department RLS apply.
    // No conversation text is ever put in a URL or read with service credentials.
    const thread=await db.from('agent_threads').select('id,agent_id').eq('id',threadId).eq('owner_id',user.id).maybeSingle();
    if(!thread.error&&thread.data&&(!requestedAgent||thread.data.agent_id===requestedAgent)) {
      const latest=await db.from('agent_messages').select('content').eq('thread_id',thread.data.id).eq('role','user').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
      if(!latest.error){initialAgent=thread.data.agent_id;initialBrief=typeof latest.data?.content==='string'?[...latest.data.content].slice(0,6000).join(''):'';}
    }
  } else if(requestedAgent&&role!=='viewer') {
    const [agent,departments]=await Promise.all([
      db.from('agents').select('id,department_id,enabled').eq('id',requestedAgent).maybeSingle(),
      db.from('departments').select('id,human_head_role'),
    ]);
    if(!agent.error&&!departments.error&&agent.data?.enabled&&canManageDepartment(role,agent.data.department_id,departments.data||[]))initialAgent=agent.data.id;
  }
  return <Automations isAdmin={role==='super_admin'} initialTask={typeof params.task==='string'?params.task:undefined} initialAgent={initialAgent} initialBrief={initialBrief} initialKind={params.workflow==='head_task'?'head_task':''}/>;
}
