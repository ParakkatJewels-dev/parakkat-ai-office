'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { submitInstructionForm, type InstructionFormState } from './instruction-form.mjs';

export async function saveAgentInstructions(_previous:InstructionFormState,form:FormData):Promise<InstructionFormState> {
  const {db,role}=await requireUser();
  const state=await submitInstructionForm(form,{
    role,
    readAccess:async id=>{
      const {data:agent,error}=await db.from('agents').select('department_id').eq('id',id).maybeSingle();
      if(error)throw error;
      if(!agent)return null;
      const {data:department,error:departmentError}=await db.from('departments').select('human_head_role').eq('id',agent.department_id).maybeSingle();
      if(departmentError)throw departmentError;
      return department?{departmentRole:department.human_head_role}:null;
    },
    save:async params=>await db.rpc('save_agent_instructions',params),
    readCurrent:async id=>{
      const {data,error}=await db.from('agent_instructions').select('agent_id,instructions,revision,updated_at').eq('agent_id',id).maybeSingle();
      return error?null:data;
    },
  });
  if(state.status==='saved') {
    revalidatePath('/agents/manage');
    revalidatePath(`/agents/${state.agentId}`);
  }
  return state;
}
