'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { prepareConversationRequest, type PendingConversationRequest } from '@/lib/agents/conversation-request.mjs';
import styles from './AgentConversation.module.css';
import { ChatGPTArtwork } from '@/app/(app)/studio/ChatGPTArtwork';
import type { ConversationArtwork } from '@/lib/agents/conversation-artwork.mjs';

type ThreadStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';
type Thread = { id: string; title: string; status: ThreadStatus; updated_at: string };
type Message = { id: string | number; role: 'user' | 'assistant' | 'handoff' | 'progress' | 'error' | 'meeting'; agent_id?: string | null; agent_name?: string | null; recipient_agent_name?: string | null; content: string; created_at: string; metadata?: Record<string, unknown> | null };
export type AgentMeeting = { id: string; status: 'planned' | 'running' | 'completed' | 'failed'; title: string; participants: { id: string; name: string }[]; summary?: string | null; started_at?: string | null; finished_at?: string | null; threadId?: string; thread_id?: string; agentId?: string; agent_id?: string };
type Snapshot = {
  agent?: { id: string; name: string; department?: string; role_desc?: string };
  threads: Thread[]; thread: Thread | null; messages: Message[]; meetings: AgentMeeting[]; artworks: ConversationArtwork[];
  activity?: { text: string; at: string } | null; canSend: boolean;
};
type Props = { agentId: string; agentName: string; initialActivity?: { text: string; at: string } | null; compact?: boolean; initialThreadId?: string; initialMeetingId?: string; requestMeeting?: boolean; onMeetings?: (meetings: AgentMeeting[], threadId: string | null) => void };
const STATUS: Record<ThreadStatus, string> = { idle: 'Ready', queued: 'Queued', running: 'Working', completed: 'Replied', failed: 'Needs attention' };
const empty: Snapshot = { threads: [], thread: null, messages: [], meetings: [], artworks: [], canSend: false };
const atTime = (value: string) => new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const isBusy = (thread: Thread | null) => thread?.status === 'queued' || thread?.status === 'running';

export default function AgentConversation({ agentId, agentName, initialActivity, compact = false, initialThreadId, initialMeetingId, requestMeeting = false, onMeetings }: Props) {
  const labelId = useId(), historyId = useId(), meetingId = useId();
  const [snapshot, setSnapshot] = useState<Snapshot>(empty), [threadId, setThreadId] = useState<string | null>(initialThreadId || null);
  const [loading, setLoading] = useState(true), [sending, setSending] = useState(false), [error, setError] = useState(''), [sendError, setSendError] = useState('');
  const [draft, setDraft] = useState(''), [meeting, setMeeting] = useState(requestMeeting), [tab, setTab] = useState<'conversation' | 'meetings'>(initialMeetingId || requestMeeting ? 'meetings' : 'conversation');
  const [refresh, setRefresh] = useState(0);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const scroll = useRef<HTMLDivElement>(null), textarea = useRef<HTMLTextAreaElement>(null), follow = useRef(true);
  const loaded = useRef(false), requestVersion = useRef(0), alive = useRef(true), sendingRef = useRef(false);
  const pending = useRef<PendingConversationRequest | null>(null);
  const meetingsCallback = useRef(onMeetings); meetingsCallback.current = onMeetings;
  const endpoint = `/api/agents/${encodeURIComponent(agentId)}/conversation`;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (selected: string | null, signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    const response = await fetch(`${endpoint}${selected ? `?thread=${encodeURIComponent(selected)}` : ''}`, { signal, cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || typeof data !== 'object') throw new Error(data?.error || 'The conversation could not be loaded. Try again.');
    if (version !== requestVersion.current || signal?.aborted || !alive.current) return;
    const next: Snapshot = { ...empty, ...data, threads: data.threads || [], messages: data.messages || [], meetings: data.meetings || [], artworks: data.artworks || [] };
    if (next.thread && !next.threads.some(t => t.id === next.thread!.id)) next.threads = [next.thread, ...next.threads];
    setSnapshot(next); setError(''); loaded.current = true;
    if (next.thread?.id && !selected) setThreadId(next.thread.id);
    meetingsCallback.current?.(next.meetings, next.thread?.id || null);
  }, [endpoint]);

  useEffect(() => {
    // An empty new conversation is local until its first message is accepted.
    if (loaded.current && !threadId && !refresh) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setLoading(!loaded.current);
    const update = async () => {
      if (document.visibilityState === 'hidden' || sendingRef.current) { timer = setTimeout(update, 5000); return; }
      try { await load(threadId, controller.signal); }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'The conversation could not be loaded.'); }
      finally { if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(update, 5000); } }
    };
    void update();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load, threadId, refresh, selectionVersion]);

  const latestMessage = snapshot.messages.at(-1)?.id;
  useEffect(() => { if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [latestMessage, tab]);

  const chooseThread = (id: string) => {
    if (sending || loading) return;
    ++requestVersion.current; setThreadId(id || null); setError(''); setSendError(''); setDraft(''); pending.current = null; follow.current = true;
    // Explicit New must stop default-latest polling even when the id is already null.
    setSelectionVersion(n => n + 1);
    setSnapshot(s => ({ ...s, thread: id ? s.threads.find(t => t.id === id) || null : null, messages: [], meetings: [], artworks: [] }));
    meetingsCallback.current?.([], id || null);
    if (!id) { loaded.current = true; setRefresh(0); setLoading(false); setTab('conversation'); textarea.current?.focus(); }
    else setLoading(true);
  };

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sendingRef.current || !snapshot.canSend || isBusy(snapshot.thread)) return;
    const request = prepareConversationRequest(pending.current, { message: text, threadId, meeting }, () => crypto.randomUUID());
    pending.current = request.pending;
    sendingRef.current = true; setSending(true); setError(''); setSendError(''); ++requestVersion.current;
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Your message could not be sent. Your draft is still here.');
      if (!alive.current) return;
      const nextId = data?.threadId;
      if (!nextId) throw new Error('The server did not return the conversation. Refresh before sending again.');
      setDraft(''); pending.current = null; follow.current = true; setThreadId(nextId); setTab('conversation');
      await load(nextId);
    } catch (e) { if (alive.current) setSendError(e instanceof Error ? e.message : 'Your message could not be sent.'); }
    finally { sendingRef.current = false; if (alive.current) setSending(false); }
  }

  const activity = snapshot.activity || initialActivity, busy = isBusy(snapshot.thread), name = snapshot.agent?.name || agentName;
  const selectedMeeting = initialMeetingId && snapshot.meetings.find(m => m.id === initialMeetingId);
  const meetings = selectedMeeting ? [selectedMeeting, ...snapshot.meetings.filter(m => m.id !== selectedMeeting.id)] : snapshot.meetings;
  const author = (message: Message) => message.role === 'user' ? 'You' : message.agent_name || (message.agent_id ? message.agent_id : name);
  // Show one current preview per artwork at its latest linked assistant message.
  // Contribution and final-answer messages often point to the same saved poster.
  const artworkMessages = new Map<string, {id: string | number; index:number}>();
  snapshot.messages.forEach((message,index) => {
    if (message.role !== 'assistant') return;
    if (typeof message.metadata?.design_id === 'string') artworkMessages.set(`design:${message.metadata.design_id}`,{id:message.id,index});
    if (typeof message.metadata?.carousel_id === 'string') artworkMessages.set(`carousel:${message.metadata.carousel_id}`,{id:message.id,index});
  });
  const artworksByMessage = new Map<string | number, ConversationArtwork[]>();
  snapshot.artworks.forEach(artwork => {
    const direct=artworkMessages.get(`design:${artwork.id}`), carousel=artwork.carouselId ? artworkMessages.get(`carousel:${artwork.carouselId}`) : undefined;
    const owner=direct && (!carousel || direct.index > carousel.index) ? direct : carousel;
    if (owner) artworksByMessage.set(owner.id,[...(artworksByMessage.get(owner.id)||[]),artwork]);
  });

  return <section className={`${styles.conversation} ${compact ? styles.compact : ''}`} aria-label={`Conversation with ${name}`}>
    {activity && <div className={styles.activity}><Icon name="spark" size={17} /><div><span className={styles.eyebrow}>Latest activity</span><p>{activity.text}</p><time dateTime={activity.at}>{atTime(activity.at)}</time></div></div>}
    <div className={styles.controls}>
      <div className={styles.history}><label htmlFor={historyId}>Your conversations</label><select id={historyId} value={threadId || ''} disabled={sending || loading} onChange={e => chooseThread(e.target.value)}><option value="">New conversation</option>{snapshot.threads.map(t => <option value={t.id} key={t.id}>{t.title || 'Untitled task'}</option>)}</select></div>
      <button type="button" className="btn ghost sm-btn" onClick={() => chooseThread('')} disabled={sending || loading} title="Start a new conversation"><Icon name="plus" size={16} />New</button>
    </div>
    <div className={styles.tabs} role="group" aria-label="Conversation view"><button type="button" aria-pressed={tab === 'conversation'} onClick={() => setTab('conversation')}>Conversation</button><button type="button" aria-pressed={tab === 'meetings'} onClick={() => setTab('meetings')}><Icon name="users" size={15} />Meetings{snapshot.meetings.length > 0 && <span>{snapshot.meetings.length}</span>}</button>{snapshot.thread && <span className={`${styles.status} ${busy ? styles.working : ''}`} role="status">{busy && <span className="spin"><Icon name="sync" size={12} /></span>}{STATUS[snapshot.thread.status] || snapshot.thread.status}</span>}</div>
    <div className={styles.timeline} ref={scroll} onScroll={() => { const el = scroll.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72; }}>
      {loading ? <div className={styles.empty}><span className="spin"><Icon name="sync" size={22} /></span><p>Loading your conversation…</p></div> : tab === 'meetings' ? (
        meetings.length ? <div className={styles.meetings}>{meetings.map(m => <article key={m.id} className={styles.meetingCard}><div className={styles.meetingHead}><Icon name="users" size={18} /><h3>{m.title || 'Team meeting'}</h3><span className="pill">{m.status === 'running' ? 'In progress' : m.status === 'planned' ? 'Gathering' : m.status === 'completed' ? 'Finished' : 'Needs attention'}</span></div><ul className={styles.participants} aria-label="Meeting participants">{m.participants.map(p => <li key={p.id}>{p.name}</li>)}</ul>{snapshot.messages.filter(msg => msg.metadata?.meeting_id === m.id && msg.role === 'meeting').map(msg => <div key={msg.id} className={styles.meetingTurn}><b>{author(msg)}</b><p>{msg.content}</p></div>)}{m.summary ? <div className={styles.summary}><b>Meeting summary</b><p>{m.summary}</p></div> : <p className={styles.note}>{m.status === 'failed' ? 'The meeting could not finish. See the conversation for details.' : 'The discussion and final summary will appear here as the agents work.'}</p>}</article>)}</div> : <div className={styles.empty}><Icon name="users" size={28} /><h3>Bring the team together</h3><p>Choose “Hold a meeting” with your task. The agent will gather the relevant specialists, discuss the plan and return a summary.</p></div>
      ) : snapshot.messages.length ? <ol className={styles.messages} role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions">{snapshot.messages.map(msg => <li key={msg.id} className={`${styles.message} ${msg.role === 'user' ? styles.userMessage : msg.role === 'assistant' ? styles.agentMessage : styles.eventMessage} ${msg.role === 'error' ? styles.errorMessage : ''}`}><div className={styles.messageMeta}><b>{author(msg)}</b>{msg.metadata?.interaction_mode === 'direct' && msg.recipient_agent_name ? <span><Icon name="arrow" size={12} />To {msg.recipient_agent_name}</span> : msg.role === 'handoff' && <span><Icon name="arrow" size={12} />Coordinating</span>}{msg.role === 'meeting' && <span><Icon name="users" size={12} />Meeting</span>}<time dateTime={msg.created_at}>{atTime(msg.created_at)}</time></div><p>{msg.content}</p>{(artworksByMessage.get(msg.id)||[]).map(artwork => <div className={styles.artwork} key={artwork.id}>
        <div className={styles.artworkHeading}><b>{artwork.carouselIndex ? `Card ${artwork.carouselIndex}: ` : ''}{artwork.title}</b>{artwork.version && <span>v{artwork.version}</span>}</div>
        {artwork.imageUrl && <a href={`/studio?made=${artwork.id}#d-${artwork.id}`} aria-label={`Review ${artwork.title} in Design Studio`}><img src={artwork.imageUrl} alt={artwork.title} loading="lazy" decoding="async" /></a>}
        {['awaiting_import','generating'].includes(artwork.status) ? <ChatGPTArtwork key={`${artwork.id}:${artwork.requestId}`} source="design" id={artwork.id} requestId={artwork.requestId} status={artwork.status} initialProvider={artwork.automaticChatGPT || artwork.importProvider === 'ChatGPT' ? 'chatgpt' : 'higgsfield'} {...(artwork.automaticChatGPT ? {automaticChatGPT:true} : {})} title={artwork.title} compact />
          : <p className={styles.note}>{artwork.generatedProvider ? 'Generated with Higgsfield. Human visual review is required in Design Studio.' : artwork.imported ? `Imported${artwork.importProvider ? ` from ${artwork.importProvider}` : ''}. Human visual review is still required in Design Studio.` : artwork.needsAttention ? 'This artwork needs attention in Design Studio.' : artwork.imageUrl ? 'Saved artwork. Open Design Studio to review it.' : 'Artwork is being prepared. Check Design Studio for its current status.'}</p>}
      </div>)}{typeof msg.metadata?.design_id === 'string' && /^[0-9a-f-]{36}$/i.test(msg.metadata.design_id) && <a className="btn sm-btn" href={`/studio?made=${msg.metadata.design_id}#d-${msg.metadata.design_id}`}>View poster in Design Studio</a>}{typeof msg.metadata?.carousel_id === 'string' && /^[0-9a-f-]{36}$/i.test(msg.metadata.carousel_id) && <a className="btn sm-btn" href={`/studio?carousel=${msg.metadata.carousel_id}`}>Open five-card carousel</a>}</li>)}</ol> : <div className={styles.empty}><Icon name="doc" size={28} /><h3>Work with {name}</h3><p>Ask what they are doing, give them a task, or discuss a plan. They can visit colleagues for one-to-one help and bring their findings back here. Choose Hold a meeting when you want the team around the table.</p><button type="button" className={styles.suggestion} onClick={() => { setDraft('What are you working on, and what needs my attention?'); textarea.current?.focus(); }}>What are you working on?<Icon name="arrow" size={14} /></button></div>}
    </div>
    {(sendError || error) && <div className={styles.error} role="alert"><span>{sendError || error}</span><button type="button" onClick={() => { setSendError(''); setRefresh(n => n + 1); }}>Refresh</button></div>}
    <form className={styles.composer} onSubmit={send}>
      <label htmlFor={labelId}>{snapshot.thread ? 'Reply or give the next task' : `Message ${name}`}</label>
      <textarea id={labelId} ref={textarea} rows={compact ? 3 : 4} maxLength={6000} value={draft} onChange={e => setDraft(e.target.value)} disabled={!snapshot.canSend || loading || sending} placeholder={snapshot.canSend ? 'What would you like them to work on?' : loading ? 'Loading…' : 'You do not have permission to assign tasks to this agent.'} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      <div className={styles.composerBottom}><label className={styles.meetingToggle} htmlFor={meetingId}><input id={meetingId} type="checkbox" checked={meeting} onChange={e => setMeeting(e.target.checked)} disabled={!snapshot.canSend || sending || busy} /><Icon name="users" size={16} />Hold a meeting</label><button className="btn" type="submit" disabled={!draft.trim() || !snapshot.canSend || loading || sending || busy}>{sending ? <><span className="spin"><Icon name="sync" size={16} /></span>Sending…</> : busy ? <><Icon name="clock" size={16} />Working…</> : <><Icon name="arrow" size={16} />Send task</>}</button></div>
      {busy && <p className={styles.note}>The team is working on your last message. You can prepare a follow-up while they finish.</p>}
      {snapshot.canSend && <div className={styles.note}><p><Link href={`/automations?workflow=head_task&agent=${encodeURIComponent(agentId)}${threadId?`&thread=${encodeURIComponent(threadId)}`:''}`} className="btn ghost sm-btn"><Icon name="users" size={14}/>Assign through an AI head</Link> Delegate work, track the team’s progress and receive the AI head’s reviewed output.</p><p><Link href={`/automations?agent=${encodeURIComponent(agentId)}${threadId?`&thread=${encodeURIComponent(threadId)}`:''}`} className="btn ghost sm-btn"><Icon name="rocket" size={14}/>Other workflows</Link>{threadId?' Use your latest saved request.':' Choose a workflow and give the team a deliverable.'}</p></div>}
    </form>
  </section>;
}
