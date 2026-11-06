'use client';
import Link from 'next/link';
import { PEOPLE } from '@/office/roster.mjs';
import { useAgentWorkStatus } from './useAgentWorkStatus';

// Initials only: the office's colour table lives in the 3D engine, which a page like Home should not load.
const initials = (name: string) => name.replace(/\bAI\b/g, '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const STATE: Record<string, [string, string]> = { working: ['Working', 'acc'], thinking: ['Working', 'acc'], waiting: ['Waiting', 'warn'], blocked: ['Stuck', 'bad'] };

/** Who on the AI team is busy right now, from the same live feed the office uses. */
export function WorkingNow({ observedAt, limit = 6 }: { observedAt: string; limit?: number }) {
  const { statuses, availability } = useAgentWorkStatus(observedAt);
  const busy = Object.entries(statuses).map(([id, s]) => ({ id, ...s, person: PEOPLE.find(p => p.id === id) })).filter(a => a.person).slice(0, limit);
  if (availability === 'loading') return <p className="sub" role="status">Checking who is working…</p>;
  if (availability === 'unavailable') return <p className="sub" role="status">Live status couldn’t load. It retries on its own.</p>;
  if (!busy.length) return <p className="sub" role="status">Nobody is working right now. Give the team a task and you’ll see it here.</p>;
  return <ul className="rows working-now">{busy.map(a => {
    const [word, tone] = STATE[a.state] || ['Working', 'acc'];
    return <li key={a.id}><span className="wn-face" aria-hidden="true">{initials(a.person!.name)}</span><div className="grow"><Link href={`/agents/${encodeURIComponent(a.id)}`} className="clip"><b>{a.person!.name}</b></Link><span className="sm clip">{a.label}</span></div><span className={`pill ${tone}`}>{word}</span></li>;
  })}</ul>;
}
