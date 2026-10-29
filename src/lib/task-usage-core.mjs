const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS=new Set(['campaign','conversation','head_task']);
const EVENTS=new Set(['provider_attempt','cache_reuse','inflight_reuse','deterministic_reuse','checkpoint_reuse']);
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const label=value=>typeof value==='string'&&/^[a-zA-Z0-9_:.\/-]{1,100}$/.test(value)?value:null;

/** Identifiers only. User-authored task text is deliberately not accepted. */
export function taskUsageIdentity(value) {
  return value&&KINDS.has(value.kind)&&typeof value.id==='string'&&UUID.test(value.id)?{kind:value.kind,id:value.id.toLowerCase()}:null;
}
export function mergeUsageScope(parent={},scope={}) {
  const merged={...parent,...scope};
  if(scope.task===undefined&&scope.feature==='campaign'&&typeof scope.run_id==='string')merged.task={kind:'campaign',id:scope.run_id};
  merged.task=taskUsageIdentity(merged.task);
  return merged;
}
export function taskUsageEventRow(scope,input) {
  const task=taskUsageIdentity(scope?.task);
  if(!task||!EVENTS.has(input?.event))return null;
  const attempt=input.event==='provider_attempt';
  const inputTokens=count(input.inputTokens),outputTokens=count(input.outputTokens);
  const known=attempt&&input.usageKnown===true&&inputTokens!==null&&outputTokens!==null;
  return {task_kind:task.kind,task_id:task.id,event_kind:input.event,
    provider:attempt?label(input.provider):null,model:attempt?label(input.model):null,
    agent_id:label(input.agent||scope.agent),feature:label(input.feature||(scope.stage&&scope.feature?`${scope.feature}:${scope.stage}`:scope.feature)),
    reservation_id:attempt&&typeof input.reservationId==='string'&&UUID.test(input.reservationId)?input.reservationId:null,
    status:['pending','complete','failed'].includes(input.status)?input.status:attempt?'pending':'complete',
    input_tokens:known?inputTokens:null,output_tokens:known?outputTokens:null,
    estimated_tokens:attempt?(count(input.estimatedTokens)??0):0};
}
export function taskUsageSettlement(value) {
  const input=count(value?.inputTokens),output=count(value?.outputTokens),known=value?.usageKnown===true&&input!==null&&output!==null;
  return {status:value?.status==='complete'?'complete':'failed',input_tokens:known?input:null,output_tokens:known?output:null};
}
