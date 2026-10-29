// Agent roster rows are readable by every signed-in user; department permissions
// must be checked separately before exposing process-local working status.
export function permittedWorkAgents(role, departments, agents) {
  const allowed = new Set(departments.filter(d => role === 'super_admin' || d.human_head_role === role).map(d => d.id));
  return agents.filter(a => a.enabled !== false && allowed.has(a.department_id)).map(a => a.id);
}
