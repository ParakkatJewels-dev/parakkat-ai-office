'use client';

import { useEffect, useRef } from 'react';
import { Icon } from './Icon';
import styles from './OfficeDialogue.module.css';

export type OfficeDialogueRecord = {
  id: string; visitor: string; recipient: string;
  state: 'queued' | 'walking' | 'talking' | 'waiting' | 'returning' | 'complete' | 'interrupted' | 'saved';
  turns: { id: string; from: string; to: string; text: string; at: string; privateUnavailable?: boolean }[];
  hostId?: string | null; threadId?: string | null;
};
type Props = { records: OfficeDialogueRecord[]; activeId: string | null; name: (id: string | null) => string; onSelect: (id: string) => void; onClose: () => void; onLocate: (id: string) => void; onOpenThread: (record: OfficeDialogueRecord) => void };
const STATUS = { queued: 'Waiting for the agents', walking: 'Walking over', talking: 'Talking', waiting: 'Waiting for a reply', returning: 'Returning to their desk', complete: 'Conversation finished', interrupted: 'Visit interrupted', saved: 'Saved conversation' };

export default function OfficeDialogue({ records, activeId, name, onSelect, onClose, onLocate, onOpenThread }: Props) {
  const record = records.find(r => r.id === activeId), log = useRef<HTMLOListElement>(null), follow = useRef(true);
  const lastTurn = record?.turns.at(-1)?.id;
  useEffect(() => { follow.current = true; }, [activeId]);
  useEffect(() => { if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight; }, [lastTurn, activeId]);
  if (!records.length) return null;
  if (!record) return <button type="button" className={`${styles.reopen} float`} onClick={() => onSelect(records[0].id)}><Icon name="users" size={17} />Agent dialogues<span>{records.length}</span></button>;
  return <aside className={`${styles.dialogue} float`} aria-label="Agent dialogue">
    <header><div><span className={styles.eyebrow}>One-to-one dialogue</span><h2>{name(record.visitor)} <span>↔</span> {name(record.recipient)}</h2></div><button type="button" className={styles.close} aria-label="Close dialogue box" onClick={onClose}><Icon name="x" size={16} /></button></header>
    <div className={styles.tools}><span role="status" className={styles.status}><i data-active={['walking', 'talking', 'waiting'].includes(record.state)} />{STATUS[record.state]}</span><button type="button" onClick={() => onLocate(record.recipient)}>Show agents<Icon name="arrow" size={13} /></button></div>
    {records.length > 1 && <label className={styles.history}>Recent dialogues<select value={record.id} onChange={e => onSelect(e.target.value)}>{records.map(r => <option key={r.id} value={r.id}>{name(r.visitor)} ↔ {name(r.recipient)}</option>)}</select></label>}
    <ol ref={log} className={styles.turns} role="log" aria-label="Agent dialogue messages" aria-live="polite" aria-relevant="additions" onScroll={() => { const el = log.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50; }}>
      {record.turns.map(turn => <li key={turn.id} className={turn.from === record.visitor ? styles.visitor : styles.recipient}><div><b>{name(turn.from)}</b><span>to {name(turn.to)}</span></div><p>{turn.text}</p>{turn.privateUnavailable && <small>The task details are private to its requester.</small>}</li>)}
    </ol>
    {record.hostId && record.threadId && record.turns.some(t => !t.privateUnavailable) && <button className={styles.open} type="button" onClick={() => onOpenThread(record)}>Open full conversation<Icon name="arrow" size={14} /></button>}
  </aside>;
}
