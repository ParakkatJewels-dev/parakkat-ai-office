import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { defaultAgentGuidance } from '@/lib/agents/agent-instructions-core.mjs';
import AgentManager from './AgentManager';
import styles from './AgentManager.module.css';
import { mayEditInstructions } from './instruction-form.mjs';

export default async function AgentManagement({searchParams}:{searchParams:Promise<Record<string,string | undefined>>}) {
  const {db,role}=await requireUser(), params=await searchParams;
  const [roster,departments,brand]=await Promise.all([
    db.from('agents').select('id,name,role_desc,department_id,is_lead,enabled').order('name'),
    db.from('departments').select('id,name,human_head_role,ai_lead_agent').order('name'),
    db.from('brand_book').select('voice,always,never,notes').eq('id',1).maybeSingle(),
  ]);
  const agents=roster.data || [], depts=departments.data || [];
  const editable=(departmentId:string)=>mayEditInstructions(role,depts.find(department=>department.id===departmentId)?.human_head_role);
  const selected=agents.find(agent=>agent.id===params.agent) || agents.find(agent=>editable(agent.department_id)) || agents[0];
  const canEdit=!!selected && editable(selected.department_id);
  const [saved,history,lessons]=selected && canEdit?await Promise.all([
    db.from('agent_instructions').select('agent_id,instructions,revision,updated_at').eq('agent_id',selected.id).maybeSingle(),
    db.from('agent_instruction_history').select('revision,instructions,updated_at').eq('agent_id',selected.id).order('revision',{ascending:false}).limit(10),
    db.from('lessons').select('id,lesson,department_id,created_at').eq('active',true).in('department_id',selected.department_id==='board'?['board']:[selected.department_id,'board']).order('created_at',{ascending:false}).limit(12),
  ]):[{data:null,error:null},{data:[],error:null},{data:[],error:null}];
  const department=depts.find(row=>row.id===selected?.department_id);
  const base=selected?defaultAgentGuidance(selected):'';
  return <div className={`page ${styles.page}`}>
    <PageHead title="Agent management" sub="Review roles and set the instructions your agents use on their next step.">
      <Link href="/agents" className="btn ghost"><Icon name="users" size={17}/>Agent reports</Link>
    </PageHead>
    {roster.error || departments.error?<p className="flash" role="alert">The agent directory could not be loaded. Refresh to try again.</p>:selected?<AgentManager
      agents={agents.map(agent=>({...agent,canEdit:editable(agent.department_id)}))} departments={depts.map(row=>({id:row.id,name:row.name}))}
      selected={{...selected,departmentName:department?.name || selected.department_id,headRole:department?.human_head_role || 'super_admin',leadName:agents.find(agent=>agent.id===department?.ai_lead_agent)?.name || null,canEdit}}
      baseGuidance={base} current={saved.data} loadError={!!saved.error}
      history={history.data || []} historyError={!!history.error} brand={brand.data} brandError={!!brand.error}
      lessons={lessons.data || []} lessonsError={!!lessons.error}
    />:<p className="sub">No AI agents are available yet.</p>}
  </div>;
}
