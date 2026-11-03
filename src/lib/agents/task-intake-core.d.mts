export type IntakeHead={id:string;name:string;department_id:string;role_desc?:string};
export function taskIntakeKind(message:string,requested?:'auto'|'chat'|'work'):'conversation'|'image'|'head_task';
export function taskIntakeHead(message:string,heads:IntakeHead[],preferredId?:string|null):string|null;
export function taskIntakeFallback(heads:IntakeHead[],role:string):string|null;
