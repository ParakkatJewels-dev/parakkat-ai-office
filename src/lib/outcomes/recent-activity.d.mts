import type {SupabaseClient} from '@supabase/supabase-js';
export type RecentCampaignActivity={complete:boolean;window:{from:string;to:string;timezone:string}|null;lastDeliveryAt:string|null;days:Array<Record<string,any>>};
export function readRecentCampaignActivity(db:SupabaseClient,campaigns:Iterable<any>,options?:{now?:Date;signal?:AbortSignal;pageSize?:number;maxRows?:number}):Promise<{complete:boolean;rowsRead:number;forCampaign:(campaign:any)=>RecentCampaignActivity}>;
