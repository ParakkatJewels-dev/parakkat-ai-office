export function permittedWorkAgents(role:string,departments:{id:string;human_head_role:string}[],agents:{id:string;department_id:string;enabled?:boolean}[]): string[];
