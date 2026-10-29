export function localWorkSnapshot(data:unknown,roundTripMs:number,now?:number): Record<string,{state:'working'|'thinking'|'waiting'|'blocked';label:string;expiresAt:number}>;
