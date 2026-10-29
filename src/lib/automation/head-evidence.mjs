import {conversationEvidenceKeys} from '../agents/conversation-context.mjs';
import {compactHeadEvidence} from './head-task-core.mjs';

const words=value=>new Set(String(value||'').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]);
/** Rank before any row cap; never change quantities, nulls or source coverage. */
export function rankHeadEvidence(sources, request) {
  const terms=words(request);
  return Object.fromEntries(Object.entries(sources||{}).map(([key,value])=>{
    if(!value||typeof value!=='object'||!Array.isArray(value.data))return [key,value];
    if(key==='categorySales30d')return [key,value]; // This source is already category-ranked before its row limit.
    const score=row=>[...words([row?.product_id,row?.id,row?.sku,row?.title,row?.product,row?.name,row?.keyword].filter(v=>v!=null).join(' '))].reduce((sum,term)=>sum+(terms.has(term)?1:0),0);
    const ranked=value.data.map((row,index)=>({row,index,score:score(row)})).sort((a,b)=>b.score-a.score||a.index-b.index);
    return [key,{...value,data:ranked.map(item=>item.row),sample:{...value.sample,sourceOrder:value.sample?.sourceOrder||value.sample?.order,order:'Task reference relevance, then original source order'},selection:'Rows ranked by task references, then original source order. Unmatched or omitted records are unknown.'}];
  }));
}
/** Planning needs source availability; specialists need their assignment's evidence.
 * Head and independent QC still receive all source categories for contradiction checks.
 */
export function headStageEvidence(sources,{stage,request='',assignment}={}) {
  if(stage==='review'||stage==='quality')return compactHeadEvidence(sources||{},4000);
  const entries=Object.entries(sources||{}).filter(([,value])=>value&&typeof value==='object'&&!Array.isArray(value));
  if(stage==='plan')return {
    sources:Object.fromEntries(entries.map(([key,value])=>[key,{available:value.available,observed_at:value.observed_at,state:value.state,
      coverage:value.coverage,summary:value.summary,sample:value.sample,contextLimit:value.contextLimit,selection:value.selection,
      snapshotRows:Array.isArray(value.data)?value.data.length:undefined}])),
    contextCoverage:'Planning source overview only. No detailed rows are supplied at this stage. Assign the right specialist; do not invent conclusions or quantities. The specialist receives selected recorded data.'
  };
  const text=assignment?`${assignment.task||''} ${assignment.deliverable||''}`:request;
  const requested=new Set(conversationEvidenceKeys(`${request} ${text}`));
  const selected={},omitted={};
  for(const [key,value] of entries){
    if(requested.has(key))selected[key]=value;
    else omitted[key]={available:value.available,observed_at:value.observed_at,note:'Recorded source not supplied for this assignment; its contents are not evidence of zero or no activity.'};
  }
  // A short/unrecognized assignment may be in another language. Keep the full
  // existing snapshot in that case rather than pretending evidence is absent.
  if(!Object.keys(selected).some(key=>key!=='sync'))return compactHeadEvidence(rankHeadEvidence(sources,request),7000);
  return {...compactHeadEvidence(rankHeadEvidence(selected,`${request} ${text}`),5000),otherRecordedSources:omitted};
}
