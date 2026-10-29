'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { activityState, isWorkingStatus } from '@/lib/agents/activity-core.mjs';
import { useAgentWorkStatus } from './useAgentWorkStatus';
import { Icon } from './Icon';

type History = Record<string,string|null>;
type Activity = ReturnType<typeof useAgentWorkStatus> & {history:History;seen:Record<string,number>};
const Context = createContext<Activity|null>(null);

export function AgentActivityProvider({history,observedAt,children}:{history:History;observedAt:string;children:ReactNode}) {
  const feed = useAgentWorkStatus(observedAt);
  const [seen,setSeen] = useState<Record<string,number>>({});
  useEffect(() => {
    if (feed.availability !== 'ready') return;
    const at = Date.now(), working = Object.keys(feed.statuses).filter(id => id in history && isWorkingStatus(feed.statuses[id],at));
    if (working.length) setSeen(previous => ({...previous,...Object.fromEntries(working.map(id => [id,at]))}));
  }, [feed.statuses,feed.availability,history]);
  return <Context.Provider value={{...feed,history,seen}}>{children}</Context.Provider>;
}

function useActivity() {
  const activity = useContext(Context);
  if (!activity) throw new Error('Agent activity requires its page provider.');
  return activity;
}
function stateOf(activity:Activity,id:string) {
  const recorded = Date.parse(activity.history[id] || '');
  const lastAt = Math.max(Number.isFinite(recorded)&&recorded<=activity.now?recorded:0,activity.seen[id]||0);
  return activityState(lastAt || null,activity.availability==='ready'?activity.statuses[id]:null,activity.now);
}

export function AgentActivitySummary() {
  const activity = useActivity(), ids = Object.keys(activity.history);
  const states = ids.map(id => stateOf(activity,id));
  const active = states.filter(state => state !== 'quiet').length;
  const sub = activity.availability==='ready' ? `${states.filter(state => state==='now').length} working right now` : activity.availability==='loading' ? 'Checking current work…' : 'Current work status unavailable';
  return <div className="tile tone-teal"><span className="tile-ic"><Icon name="users" size={20}/></span><div className="tile-body"><span className="tile-label" title="Activity since midnight in India Standard Time">Active today · IST</span><b className="tile-value">{active}/{ids.length}</b><span className="tile-sub" role="status">{sub}</span></div></div>;
}

export function AgentActivityBadge({id}:{id:string}) {
  const activity = useActivity(), state = stateOf(activity,id);
  const current = activity.availability==='ready';
  const label = current ? state==='now'?'Working now':state==='today'?'Active today':'Quiet today' : activity.availability==='loading'?'Checking live status…':'Live status unavailable';
  return <span className={`pill ${current?(state==='now'?'good':state==='today'?'acc':''):''}`} title={current&&state==='now'?activity.statuses[id]?.label:undefined}><i className={`live-dot ${current?state:'quiet'}`}/>{label}</span>;
}
