export function adReportingWindow(timezone:string,now?:Date):{from:string;to:string};
export function finiteMetric(value:unknown):number|null;
export function metaBudget(value:unknown,currency:string):number|null;
export function metaPurchase(list:unknown):number|null;
export function googlePurchaseMap(actions:any[],conversionRows:any[]):{valid:boolean;totals:Map<string,{purchases:number;revenue:number}>};
export function googleAdMetrics(base:any[],actions:any[],conversions:any[],account:{id:string;currency:string;timezone:string},window:{from:string;to:string},at:string):any[];
export function googlePerformanceMaxMetrics(rows:any[],account:{id:string;currency:string;timezone:string},window:{from:string;to:string},at:string):any[];
