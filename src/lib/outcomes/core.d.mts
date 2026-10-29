import type { MetricConfig,OutcomeBaseline,OutcomeInitiative,CampaignRegistryRow,CampaignCoverageRow } from './types';
export const METRICS:string[];
export function text(value:unknown,max?:number):string;
export function fingerprint(value:unknown):string;
export function validateMetricConfig(value:unknown):MetricConfig|null;
export function validateBaseline(value:unknown):OutcomeBaseline|null;
export function measurementWindow(config:MetricConfig,timezone:string|null,now?:Date):{from:string;to:string;timezone:string}|null;
export function observeOutcome(initiative:OutcomeInitiative|any,input?:{campaign?:CampaignRegistryRow|any;coverage?:CampaignCoverageRow|any;metrics?:any;recentActivity?:any;now?:Date}):Record<string,any>;
export function sourceUrl(row:any):string|null;

export function campaignMonitoringScope(initiative:any,campaign:any,recentActivity?:any):{mode:string;reason:string;configuredActive:boolean;recentDeliveryAt:string|null;activityWindow:any;activityComplete:boolean};
