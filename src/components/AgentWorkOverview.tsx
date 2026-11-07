'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import styles from './AgentWorkOverview.module.css';

type WorkState = { state: string; label: string } | null;
type Task = { id: string; title: string; status: string; updatedAt: string; summary?: string | null; error?: string | null };
type Conversation = Task & { threadId: string };
type Report = { id: string; title: string; status: string; updatedAt: string; summary?: string | null };
type Event = { id: number; kind: string; text: string; at: string };
type Snapshot = { observedAt: string; workflows: Task[]; teamTasks: Task[]; conversations: Conversation[]; reports: Report[]; events: Event[] };
type WorkItem = { key: string; title: string; status: string; updatedAt: string; summary?: string | null; href: string; source: string };

const ACTIVE = new Set(['queued', 'running']);
const STATUS: Record<string, string> = {
  queued: 'Queued', running: 'In progress', blocked: 'Needs input', review: 'Ready for review',
  completed: 'Finished', failed: 'Needs attention', cancelled: 'Cancelled',
  with_head: 'With team head', accepted: 'Accepted', sent_back: 'Sent back', rejected: 'Rejected',
  lead_review: 'With AI lead', revise: 'Being revised', rejected_by_lead: 'Stopped',
};
const when = (value: string) => new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function workflowItem(row: Task, source = 'Workflow'): WorkItem {
  return { key: `workflow:${row.id}`, title: row.title, status: row.status, updatedAt: row.updatedAt,
    summary: row.summary || row.error, href: `/automations?task=${encodeURIComponent(row.id)}`, source };
}
function conversationItem(agentId: string, row: Conversation): WorkItem {
  return { key: `conversation:${row.id}`, title: row.title, status: row.status, updatedAt: row.updatedAt,
    summary: row.error, href: `/agents/${encodeURIComponent(agentId)}?thread=${encodeURIComponent(row.threadId)}#conversation`, source: 'Conversation' };
}
function reportItem(agentId: string, row: Report): WorkItem {
  return { key: `report:${row.id}`, title: row.title, status: row.status, updatedAt: row.updatedAt,
    summary: row.summary, href: `/agents/${encodeURIComponent(agentId)}#reports`, source: 'Report' };
}

function WorkList({ items, empty }: { items: WorkItem[]; empty: string }) {
  return items.length ? <ul className={styles.list}>{items.map(item => <li key={item.key}>
    <div className={styles.itemTop}><span>{item.source}</span><time dateTime={item.updatedAt}>{when(item.updatedAt)}</time></div>
    <Link href={item.href}>{item.title}<Icon name="arrow" size={14} /></Link>
    {item.summary && <p>{item.summary}</p>}
    <span className={`${styles.status} ${['blocked','failed','rejected','sent_back'].includes(item.status) ? styles.attention : ''}`}>{STATUS[item.status] || item.status.replaceAll('_', ' ')}</span>
  </li>)}</ul> : <p className={styles.empty}>{empty}</p>;
}

/** Work is read only when an agent is opened; this never starts an agent task. */
export default function AgentWorkOverview({ agentId, live, availability }: { agentId: string; live: WorkState; availability: 'loading' | 'ready' | 'unavailable' }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (document.visibilityState === 'hidden') { timer = setTimeout(read, 30000); return; }
      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/work`, { cache: 'no-store', signal: controller.signal });
        const value = await response.json().catch(() => null);
        if (!response.ok || !value || !Array.isArray(value.workflows) || !Array.isArray(value.teamTasks) || !Array.isArray(value.conversations) || !Array.isArray(value.reports)) throw new Error(value?.error || 'Could not load agent work.');
        if (!controller.signal.aborted) { setData(value); setError(''); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load agent work.');
      } finally { if (!controller.signal.aborted) timer = setTimeout(read, 30000); }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [agentId, refresh]);

  const current: WorkItem[] = data ? [
    ...data.workflows.filter(row => ACTIVE.has(row.status) || row.status === 'blocked').map(row => workflowItem(row)),
    ...data.teamTasks.filter(row => ACTIVE.has(row.status) || row.status === 'blocked').map(row => workflowItem(row, 'Team task')),
    ...data.conversations.filter(row => ACTIVE.has(row.status)).map(row => conversationItem(agentId, row)),
  ].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 5) : [];
  const recent: WorkItem[] = data ? [
    ...data.workflows.filter(row => ['review', 'completed', 'failed'].includes(row.status)).map(row => workflowItem(row)),
    ...data.teamTasks.filter(row => ['review', 'completed', 'failed'].includes(row.status)).map(row => workflowItem(row, 'Team task')),
    ...data.conversations.filter(row => ['completed', 'failed'].includes(row.status)).map(row => conversationItem(agentId, row)),
    ...data.reports.map(row => reportItem(agentId, row)),
  ].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 6) : [];
  const working = live && ['working', 'thinking'].includes(live.state);
  const statusTitle = working ? 'Working now' : live?.state === 'waiting' ? 'Waiting' : live?.state === 'blocked' ? 'Needs attention' : current.length ? 'Assignments in progress' : availability === 'unavailable' ? 'Live status unavailable' : 'No active work recorded';
  const statusDetail = live?.label || (current.length ? `${current.length} saved assignment${current.length === 1 ? '' : 's'} in progress or waiting for input.` : availability === 'unavailable' ? 'Saved work below is still available.' : 'New assignments will appear here when they start.');

  return <div className={styles.panel}>
    <div className={styles.top}>
      <div><span className={styles.eyebrow}>Agent work</span><h3>Work and results</h3></div>
      <button type="button" onClick={() => setRefresh(n => n + 1)} aria-label="Refresh agent work" title="Refresh agent work"><Icon name="sync" size={16} /></button>
    </div>
    <section className={`${styles.live} ${working ? styles.working : ''}`} aria-label="Current work status">
      <span className={styles.liveDot} aria-hidden="true" />
      <div><b>{statusTitle}</b><p>{statusDetail}</p></div>
    </section>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!data && !error ? <p className={styles.empty}>Loading saved work…</p> : <>
      <section className={styles.section}><h4>Current assignments <span>{current.length}</span></h4><WorkList items={current} empty="No queued or running assignments visible to you." /></section>
      <section className={styles.section}><h4>Recent results <span>{recent.length}</span></h4><WorkList items={recent} empty="No finished tasks or reports visible to you yet." /></section>
      {!!data?.events?.length && <section className={styles.section}><h4>Latest activity</h4><ul className={styles.events}>{data.events.slice(0, 4).map(event => <li key={event.id}><p>{event.text}</p><time dateTime={event.at}>{when(event.at)}</time></li>)}</ul></section>}
    </>}
    <Link className={styles.fullLink} href={`/agents/${encodeURIComponent(agentId)}`}>Open full agent record<Icon name="arrow" size={15} /></Link>
  </div>;
}
