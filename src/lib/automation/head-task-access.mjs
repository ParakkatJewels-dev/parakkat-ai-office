import {canManageDepartment} from './core.mjs';
export function headTaskDepartments(role,head,task,departments) {
  if(!task.created_by||!head?.enabled||!head.is_lead||head.department_id!==task.department_id)return [];
  if(!departments.some(d=>d.id===task.department_id&&d.ai_lead_agent===head.id&&d.human_head_role!=='viewer'))return [];
  const original=new Set(Array.isArray(task.input?.allowedDepartments)?task.input.allowedDepartments.filter(id=>typeof id==='string'):[]);
  const allowed=departments.filter(d=>original.has(d.id)&&canManageDepartment(role,d.id,departments)).map(d=>d.id);
  return allowed.includes(task.department_id)?allowed:[];
}
