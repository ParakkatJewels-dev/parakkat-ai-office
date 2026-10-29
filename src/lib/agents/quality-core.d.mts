export function qualityBlocked(message:string):Error & {code:string};
export function campaignVerdict(compliance:any,head:any):{passed:boolean;flags:string[]};
export function campaignArtifact(plan:any,creatives:any[]):{plan:any;creatives:any[]};
export function campaignQualityCurrent(plan:any,creatives:any[]):boolean;
export function campaignApprovalCurrent(snapshot:any,plan:any,creatives:any[]):boolean;
export function campaignReviewRequester(run:any):{approvalId:string;requestedBy:string;requestedAt:string}|null;
export function manualCampaignReview(run:any,actorRole:unknown,approval:any,now?:number):boolean;
export function reportReviewDecision(verdict:any,revision:number):{decision:string;note:string};
