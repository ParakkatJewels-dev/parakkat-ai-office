export const INSTRUCTION_LIMIT = 6000;
export const instructionLength = value => Array.from(value).length;
export const mayEditInstructions = (role, departmentRole) => role === 'super_admin'
  || (['creative_head','ecom_manager','perf_marketer'].includes(role) && role === departmentRole);

const snapshot = (value, agentId) => {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || row.agent_id !== agentId || typeof row.instructions !== 'string' || !Number.isInteger(row.revision) || row.revision < 1) return null;
  return {agent_id:row.agent_id,instructions:row.instructions,revision:row.revision,updated_at:row.updated_at || null};
};

/** Every dependency uses the signed-in client; the RPC repeats authorization inside the transaction. */
export async function submitInstructionForm(form, {role, readAccess, save, readCurrent}) {
  const agentId = form.get('agent_id'), raw = form.get('instructions'), revisionText = form.get('revision');
  const draft = typeof raw === 'string' ? raw : '';
  const result = (status,message,extra={}) => ({status,message,draft,agentId:typeof agentId==='string'?agentId:'',...extra});
  if (typeof agentId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(agentId) || typeof raw !== 'string'
    || typeof revisionText !== 'string' || !/^\d+$/.test(revisionText) || !Number.isSafeInteger(Number(revisionText)) || Number(revisionText)>2147483646) {
    return result('error','The form is incomplete. Reload the agent and try again.');
  }
  if (raw.includes('\u0000') || instructionLength(raw)>INSTRUCTION_LIMIT) return result('error','Use up to 6,000 characters without null characters. Your draft has been kept.');
  if (!['super_admin','creative_head','ecom_manager','perf_marketer'].includes(role)) return result('error','Only the Super Admin or this department’s head can edit these instructions.');
  try {
    const access = await readAccess(agentId);
    if (!access || !mayEditInstructions(role,access.departmentRole)) return result('error','You do not have permission to edit this agent. Your draft has been kept.');
    const {data,error} = await save({p_agent_id:agentId,p_instructions:raw.trim(),p_expected_revision:Number(revisionText)});
    if (error?.code === '40001') {
      const current = snapshot(await readCurrent(agentId),agentId);
      return result('conflict',current?'Someone saved a newer revision. Your draft is still here. Compare it with the latest saved text before retrying.':'Someone saved a newer revision. Your draft is still here. Reload the latest revision before retrying.',{current});
    }
    if (error?.code === '42501') return result('error','Your permission to edit this agent has changed. Your draft has been kept.');
    if (error?.code === 'P0002') return result('error','This agent is no longer available. Your draft has been kept.');
    if (error?.code === '22023') return result('error','The instructions or revision were not accepted. Your draft has been kept.');
    const current = !error ? snapshot(data,agentId) : null;
    if (!current) return result('error','The save could not be confirmed. Your draft has been kept. Retry to check the latest revision.');
    return result('saved',current.instructions?'Saved. These instructions apply at the agent’s next step.':'Additional instructions cleared. Base guidance still applies at the agent’s next step.',{current,draft:current.instructions});
  } catch {
    return result('error','The save could not be confirmed. Your draft has been kept. Try again.');
  }
}
