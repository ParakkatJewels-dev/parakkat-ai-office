const ROUTES={
 copy:{agentId:'copywriter',pattern:/\b(?:captions?|headlines?|ad copy|product descriptions?)\b/i,label:'A bounded copywriting draft only',criteria:['Deliver the exact requested copy format and language.','Use only supported product facts and approved claims.','Identify missing facts; do not invent discounts, prices, stock or a completed image.'],task:'Write the copy requested in the original human brief, following its language, format, product references and saved instructions.',deliverable:'The complete requested copy, with any missing product facts or unsupported claims identified.'},
 ads:{agentId:'adsAnalyst',pattern:/\b(?:ads?|advertising|campaign)\b[^\n]{0,100}\b(?:performance report|performance review|report)\b|\b(?:report|review)\b[^\n]{0,100}\b(?:ad performance|ads performance)\b/i,label:'A recorded advertising performance report only',criteria:['State the requested date range and available source coverage.','Use recorded spend, purchases and attributed revenue; distinguish attribution from profit.','Provide the requested analysis and identify missing measurements; propose no account changes as completed.'],task:'Prepare the advertising performance report requested in the human brief using the recorded metrics and their source dates.',deliverable:'The requested performance report with calculations, supported findings and data limits.'},
 sales:{agentId:'sales',pattern:/\b(?:sales|revenue)\s+(?:performance\s+)?report\b|\breport\s+(?:on\s+)?sales\b/i,label:'A recorded sales performance report only',criteria:['Use the requested period and identify each sales source.','Keep missing records distinct from zero and avoid adding overlapping Shopify/Odoo sales.','Deliver the requested report with evidence limits and no invented forecasts.'],task:'Prepare the sales report requested in the human brief using recorded quantities, revenue, source dates and coverage.',deliverable:'The requested sales report with supported comparisons and explicit data gaps.'}
};
export function eligibleHeadRoutes(request,candidates){
 const text=`${request.title||''}\n${request.brief||''}`;
 if(request.humanFeedback||request.previousDelivery||text.length>3000||/[^\x00-\x7f]/.test(text)||/\b(?:publish|launch|send|spend|forecast|meeting|image|video|translate|strategy|funnel|scale|assign|delegate)\b/i.test(text))return [];
 const allowed=new Set(candidates.map(item=>item.agentId));
 const matches=Object.entries(ROUTES).filter(([,route])=>route.pattern.test(text));
 // Count intent before availability: a missing specialist must not erase part
 // of a mixed request and make the remaining template appear sufficient.
 return matches.length===1&&allowed.has(matches[0][1].agentId)?matches.map(([id,route])=>({id,label:route.label,agentId:route.agentId})):[];
}
export function routedHeadPlan(answer,routes,request){
 const selected=routes.find(route=>route.id===answer?.choice),probabilities=answer?.probabilities||{};
 const probability=probabilities[answer?.choice];
 const alternative=Math.max(0,...Object.entries(probabilities).filter(([key])=>key!==answer?.choice).map(([,value])=>value));
 if(!selected||!Number.isFinite(answer.confidence)||answer.confidence<.92||!Number.isFinite(probability)||probability<.85||probability-alternative<.3)return null;
 const route=ROUTES[selected.id];
 return {understanding:`Prepare the requested ${route.label.toLowerCase()} according to the complete human brief.`,successCriteria:route.criteria,
  assignments:[{agentId:route.agentId,task:route.task,deliverable:route.deliverable}]};
}
