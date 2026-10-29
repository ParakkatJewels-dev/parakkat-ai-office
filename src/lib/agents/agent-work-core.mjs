import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// Fixed application labels only: prompts, replies, campaign names and credentials never enter this registry.
export const AGENT_WORK_LABELS = Object.freeze({
  text:'Preparing a response',conversation:'Working on a manager’s task',image:'Creating an image',review:'Reviewing a design',classification:'Checking evidence',
  library:'Studying a past design',library_scan:'Reading design folders',campaign:'Working on a campaign',opportunities:'Reviewing opportunities',
  sync:'Syncing connected data',sync_shopify:'Syncing products and orders',sync_odoo:'Syncing branch sales and stock',sync_meta:'Syncing advertising results',sync_instagram:'Syncing Instagram posts',sync_google:'Syncing Google Ads results',
  learning:'Updating team memory',seo:'Reviewing search performance',seo_trends:'Reading search trends',seo_keywords:'Checking search volumes',
  stock:'Checking recorded stock',sales:'Reviewing recorded sales',ads:'Reviewing ad results',rivals:'Reviewing competitor records',festivals:'Checking upcoming occasions',budget:'Checking usage costs',planner:'Planning next steps',
});

/** Live scopes in one Node process. A task token owns only itself, including when the same agent works concurrently. */
export function createAgentWorkRuntime({people,now=Date.now,makeId=randomUUID,setInterval:interval=setInterval,clearInterval:clear=clearInterval,setTimeout:timeout=setTimeout,clearTimeout:clearTimer=clearTimeout}={}) {
  const agents=new Set((people||[]).filter(p=>!p.human).map(p=>p.id)),active=new Map(),context=new AsyncLocalStorage();
  const heartbeatMs=20_000,leaseMs=70_000,clientMs=12_000;
  const removeExpired=()=>{for(const [id,entry] of active)if(now()>=entry.expiresAt||now()>=entry.deadline)active.delete(id);};
  return {
    async run(scope,fn) {
      const agentId=scope?.agentId;
      if(!agents.has(agentId)||scope.signal?.aborted)return fn();
      removeExpired();
      const parent=context.getStore(),inherited=parent?.get(agentId);
      if(inherited&&active.has(inherited))return fn();
      const start=now(),duration=Number.isFinite(scope.timeoutMs)?Math.max(1,Math.min(300_000,scope.timeoutMs)):240_000;
      const id=makeId(),deadline=start+duration,kind=Object.hasOwn(AGENT_WORK_LABELS,scope.kind)?scope.kind:'text';
      active.set(id,{agentId,label:AGENT_WORK_LABELS[kind],startedAt:start,expiresAt:Math.min(deadline,start+leaseMs),deadline});
      let heartbeat,hardStop,ended=false;
      const end=()=>{if(ended)return;ended=true;clear(heartbeat);clearTimer(hardStop);scope.signal?.removeEventListener('abort',end);active.delete(id);};
      heartbeat=interval(()=>{
        const entry=active.get(id);
        if(!entry||now()>=entry.expiresAt||now()>=entry.deadline){end();return;}
        entry.expiresAt=Math.min(entry.deadline,now()+leaseMs);
      },heartbeatMs);heartbeat?.unref?.();
      hardStop=timeout(end,duration);hardStop?.unref?.();
      scope.signal?.addEventListener('abort',end,{once:true});
      if(scope.signal?.aborted)end();
      const nested=new Map(parent||[]);nested.set(agentId,id);
      try{return await context.run(nested,fn);}finally{end();}
    },
    read(allowedAgentIds,at=now()) {
      removeExpired();const allowed=new Set(allowedAgentIds),snapshot={};
      for(const entry of active.values()) {
        if(!allowed.has(entry.agentId)||entry.expiresAt<=at||entry.deadline<=at)continue;
        const current=snapshot[entry.agentId];
        if(current&&Date.parse(current.startedAt)>entry.startedAt)continue;
        snapshot[entry.agentId]={state:'working',label:entry.label,startedAt:new Date(entry.startedAt).toISOString(),expiresAt:new Date(Math.min(entry.expiresAt,entry.deadline,at+clientMs)).toISOString()};
      }
      return snapshot;
    },
  };
}
