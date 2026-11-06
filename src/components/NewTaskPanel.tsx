'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from './Icon';

type Head = { id: string; name: string; department_id: string; role_desc?: string };
type Mode = 'auto' | 'chat' | 'work';
const MODES: [Mode, string][] = [['auto', 'Let the team decide'], ['chat', 'Ask a question'], ['work', 'Get work done']];
const STARTERS: [string, string][] = [
  ['Weekly sales report', 'Write this week’s sales report: what sold, what fell, and one thing to do next week.'],
  ['Instagram post', 'Make an Instagram post for our best-selling product this week, ready for my review.'],
  ['Campaign plan', 'Plan a short campaign for the next festival or occasion, with budget and the posts needed.'],
  ['Competitor check', 'Check what our competitors launched or discounted this week and what it means for us.'],
];

/** The one way to ask the team for work. Any page opens it with the `workspace:new-task` event. */
export function NewTaskPanel() {
  const router = useRouter(), dialog = useRef<HTMLDialogElement>(null), box = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState(''), [mode, setMode] = useState<Mode>('auto'), [agentId, setAgentId] = useState('');
  const [heads, setHeads] = useState<Head[] | null>(null), [canSend, setCanSend] = useState(true), [loadError, setLoadError] = useState('');
  const [sending, setSending] = useState(false), [error, setError] = useState(''), [done, setDone] = useState<{ text: string; href: string } | null>(null);
  const pending = useRef<{ clientId: string; message: string; mode: Mode; agentId: string } | null>(null), loaded = useRef(false);

  useEffect(() => {
    const open = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string; agentId?: string }>).detail || {};
      if (detail.message) { setMessage(detail.message.slice(0, 6000)); pending.current = null; }
      if (detail.agentId) setAgentId(detail.agentId);
      setError('');
      if (!loaded.current) { loaded.current = true; void loadHeads(); }
      if (!dialog.current?.open) dialog.current?.showModal();
      requestAnimationFrame(() => box.current?.focus());
    };
    window.addEventListener('workspace:new-task', open);
    return () => window.removeEventListener('workspace:new-task', open);
  }, []);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(null), 9000); return () => clearTimeout(t); }, [done]);

  // The team list is read when the panel first opens, and again after a failed read.
  async function loadHeads() {
    try {
      const response = await fetch('/api/tasks', { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.error || 'The team list could not be loaded.');
      setHeads(data.heads || []); setCanSend(!!data.canSend); setLoadError('');
    } catch (e) { loaded.current = false; setHeads([]); setLoadError(e instanceof Error ? `${e.message} You can still send: the best team head will pick it up.` : 'The team list could not be loaded.'); }
  }

  const change = (value: string) => { setMessage(value); pending.current = null; if (error) setError(''); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text) { setError('Write what you need first.'); box.current?.focus(); return; }
    if (sending || !canSend) return;
    // Retrying the same words reuses the same id, so a slow answer never creates the task twice.
    const same = pending.current && pending.current.message === text && pending.current.mode === mode && pending.current.agentId === agentId;
    const request = same ? pending.current! : { clientId: crypto.randomUUID(), message: text, mode, agentId };
    pending.current = request; setSending(true); setError('');
    try {
      const response = await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.id) throw new Error(data?.error || 'The task was not sent. Your words are kept; try again.');
      const who = heads?.find(h => h.id === data.agentId)?.name || 'the team';
      const href = `/tasks?open=${data.kind === 'task' ? 'task' : 'conversation'}:${encodeURIComponent(data.id)}`;
      pending.current = null; setMessage(''); setMode('auto'); setAgentId('');
      dialog.current?.close();
      setDone({ text: `Sent to ${who}. You’ll see progress in Tasks and anything to decide in your Inbox.`, href });
      window.dispatchEvent(new CustomEvent('workspace:task-created', { detail: { kind: data.kind, id: data.id, agentId: data.agentId } }));
      router.push(href);
    } catch (e) { setError(e instanceof Error ? e.message : 'The task was not sent. Your words are kept; try again.'); }
    finally { setSending(false); }
  }

  const choosing = heads === null;
  return <>
    <dialog ref={dialog} className="new-task" aria-labelledby="new-task-title" onClick={e => { if (e.target === e.currentTarget && !sending) dialog.current?.close(); }} onCancel={e => { if (sending) e.preventDefault(); }}>
      <form onSubmit={submit} noValidate>
        <header className="new-task-head">
          <div><small>One request, the right team picks it up</small><h2 id="new-task-title">New task</h2></div>
          <button type="button" className="nt-close" aria-label="Close" disabled={sending} onClick={() => dialog.current?.close()}><Icon name="x" /></button>
        </header>
        <div className="new-task-body">
          <div>
            <label htmlFor="nt-message">What do you need?</label>
            <textarea id="nt-message" ref={box} rows={6} maxLength={6000} value={message} onChange={e => change(e.target.value)} disabled={sending} aria-invalid={!!error && !message.trim()} aria-describedby="nt-message-hint"
              placeholder="For example: find our three best-selling chains and make a carousel post for my review." />
            <p className="hint" id="nt-message-hint">Write it the way you’d tell a person. Mention products, dates or budget if they matter.</p>
          </div>
          <div>
            <span className="lbl" id="nt-start">Or start from</span>
            <div className="nt-chips" role="group" aria-labelledby="nt-start">{STARTERS.map(([label, text]) => <button key={label} type="button" aria-pressed={message === text} disabled={sending} onClick={() => change(text)}>{label}</button>)}</div>
          </div>
          <div>
            <span className="lbl" id="nt-mode">What kind of request?</span>
            <div className="nt-seg" role="group" aria-labelledby="nt-mode">{MODES.map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} disabled={sending} onClick={() => { setMode(value); pending.current = null; }}>{label}</button>)}</div>
          </div>
          <div>
            <label htmlFor="nt-agent">Who should lead it?</label>
            <select id="nt-agent" value={agentId} disabled={sending || choosing} onChange={e => { setAgentId(e.target.value); pending.current = null; }}>
              <option value="">{choosing ? 'Loading the team…' : 'The best team head (recommended)'}</option>
              {(heads || []).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <p className="hint">The head plans it, a specialist does it, the head checks it, then it comes to you.</p>
          </div>
          {loadError && <p className="msg bad" role="alert">{loadError}</p>}
          {!choosing && !canSend && !loadError && <p className="msg bad" role="alert">No AI team head is available to your account yet. Ask the Super Admin to set up your team.</p>}
          {error && <p className="msg bad" role="alert">{error}</p>}
        </div>
        <footer className="new-task-foot">
          <p>Nothing is published or spent without your OK.</p>
          <button type="button" className="nt-btn quiet" disabled={sending} onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit" className="nt-btn pri" disabled={sending || !canSend}><Icon name="send" size={16} />{sending ? 'Sending…' : 'Send to the team'}</button>
        </footer>
      </form>
    </dialog>
    {done && <div className="toast" role="status"><Icon name="check" size={18} /><span>{done.text}</span><Link href={done.href} onClick={() => setDone(null)}>Open</Link></div>}
  </>;
}

/** A button anywhere on a page that opens the New task panel, optionally with words or a team head chosen. */
export function NewTaskButton({ children, message, agentId, className = 'btn' }: { children: React.ReactNode; message?: string; agentId?: string; className?: string }) {
  return <button type="button" className={className} aria-haspopup="dialog" onClick={() => window.dispatchEvent(new CustomEvent('workspace:new-task', { detail: { message, agentId } }))}>{children}</button>;
}
