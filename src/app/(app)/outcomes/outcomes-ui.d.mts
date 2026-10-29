export const METRICS:Array<{id:string;label:string;unit:string}>;
export function stateLabel(dimension:string,value:string):string;
export function stateTone(dimension:string,value:string):string;
export function metricValue(value:unknown,metric?:string,currency?:string):string;
export function validTime(value:unknown):number|null;
export function dateTimeIST(value:unknown):string;
export function optionalNumber(value:unknown,options?:{integer?:boolean;min?:number;max?:number;label?:string}):number|null;
export function initiativeDeadlines(row:{outcome_state:string;approval_state:string;execution_state:string;due_at?:string|null;next_review_at?:string|null},now?:number):{overdue:boolean;reviewDue:boolean};
export function outcomeHref(value:unknown,options?:{internal?:boolean}):string|null;
export function metricReadiness(config:any):{ready:boolean;missing:string[]};
export function coverageTone(value:string):string;
export function evaluationLabel(value:string):string;

export function qualityStatus(review:{current:boolean;decision:string}|null|undefined):{label:string;tone:string;passed:boolean};

export function initiativeState(row:{source_kind:string;approval_state:string;execution_state:string;outcome_state:string},dimension:string):{title:string;label:string;tone:string};
export function campaignMonitoring(observation:Record<string,unknown>):{mode:string;label:string;detail:string;recentDeliveryAt:string|null;windowLabel:string;complete:boolean|null};
export type CampaignDelivery={from:string;to:string;timezone:string;impressions:number|null;clicks:number|null;spend:number|null;recordedDays:number|null;lastDeliveryAt:string|null;currency:string|null;lastSyncedAt:string|null};
export function campaignDelivery(observation:Record<string,unknown>):CampaignDelivery|null;

export type BenchmarkSuggestion={available:boolean;kind:string;confidence:'descriptive_data_only';target:number|null;settings:import('@/lib/outcomes/types').MetricConfig|null;baseline:import('@/lib/outcomes/types').OutcomeBaseline|null;recent:Record<string,unknown>|null;previous:Record<string,unknown>|null;reasons:string[];warnings:string[]};
export function benchmarkSuggestion(observation:Record<string,unknown>):BenchmarkSuggestion|null;
