export const INSTRUCTION_LIMIT: number;
export function instructionLength(value:string):number;
export function mayEditInstructions(role:string,departmentRole:string | null | undefined):boolean;
export type InstructionSnapshot = {agent_id:string;instructions:string;revision:number;updated_at:string | null};
export type InstructionFormState = {status:'idle'|'saved'|'error'|'conflict';message:string;draft:string;agentId:string;current?:InstructionSnapshot | null};
export function submitInstructionForm(form:FormData,dependencies:{
  role:string;
  readAccess:(id:string)=>Promise<{departmentRole:string | null} | null>;
  save:(params:{p_agent_id:string;p_instructions:string;p_expected_revision:number})=>Promise<{data:unknown;error:{code?:string} | null}>;
  readCurrent:(id:string)=>Promise<unknown>;
}):Promise<InstructionFormState>;
