export type CreativeResearch = {
  observedAt: string;
  direction: {layout:string;palette:string;typography:string;imagery:string;customerHook:string};
  sources: {title:string;url:string}[];
};
export function creativeResearchResult(response:unknown, observedAt:string):CreativeResearch|null;
export function creativeResearchBrief(research:CreativeResearch|null):string;
export function searchResultLinks(html:string):{title:string;url:string;snippet:string}[];
