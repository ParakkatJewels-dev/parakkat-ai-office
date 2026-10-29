'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { AppRole } from '@/lib/roles';
import { Icon } from '@/components/Icon';
import type { AgentMeeting } from '@/components/AgentConversation';
import conversationStyles from '@/components/AgentConversation.module.css';
import OfficeDialogue, { type OfficeDialogueRecord } from '@/components/OfficeDialogue';
import { directDialogueEvent, authorizedDialogueText, type DirectDialogueEvent } from '@/office/dialogue-events.mjs';
import { useAgentWorkStatus } from '@/components/useAgentWorkStatus';

const AgentConversation = dynamic(() => import('@/components/AgentConversation'), { loading: () => <p className="note">Opening conversation…</p> });

export type AgentEvent = { id: number; at: string; kind: string; from_agent: string | null; to_agent: string | null; from_dept: string | null; to_dept: string | null; text: string; payload: Record<string, unknown> | null };
type Office = any; // the engine is plain JS; see src/office/engine.mjs for its API
type Stats = { total: number; active: number; buildings: { id: string; name: string; total: number; active: number }[] };
type Item = { key: string; at: number; from: string | null; to: string | null; text: string; event: AgentEvent };
type Person = { id: string; name: string; dept: string; room: string; human?: boolean; role?: string };
type Selection = { person: Person; threadId?: string; meetingId?: string; meeting?: boolean };
type Sky = { hour: number; live: boolean; lapse: boolean; moon: { name: string; lit: number } };
// the sky button steps through: live Kerala time, a day in 90 seconds, then sunrise, midday, sunset and night
const SKY_STEPS: { id: string; label: string; set: number | 'lapse' | null }[] = [
  { id: 'live', label: 'Live time', set: null }, { id: 'lapse', label: 'Day in 90 s', set: 'lapse' }, { id: 'rise', label: 'Sunrise', set: 6.3 },
  { id: 'noon', label: 'Midday', set: 12.5 }, { id: 'set', label: 'Sunset', set: 18.25 }, { id: 'night', label: 'Night', set: 21.5 },
];
const clock = (h: number) => { const m = Math.floor((h % 1) * 60), hh = Math.floor(h) % 24; return `${hh % 12 || 12}:${String(m).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };

const who = (e: AgentEvent) => e.from_agent || (typeof e.payload?.from_person === 'string' ? e.payload.from_person : null);
const whom = (e: AgentEvent) => e.to_agent || (typeof e.payload?.to_person === 'string' ? e.payload.to_person : null);
const fromEvent = (e: AgentEvent): Item => ({ key: 'e' + e.id, at: Date.parse(e.at), from: who(e), to: whom(e), text: e.text, event: e });
const BUILDING_COL: Record<string, string> = { hq: '#22c79f', ic: '#3b82f6', ch: '#f59e0b' };
const ago = (t: number, now: number) => { const m = Math.round((now - t) / 6e4); return m < 1 ? 'now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const initials = (n: string) => n.replace(' AI', '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

async function dialogueText(event: DirectDialogueEvent, signal?: AbortSignal, onAccessLost?: () => void) {
  if (!event.privateTask) return event.text;
  if (!event.hostId || !event.threadId || !event.messageId) return null;
  try {
    const response = await fetch(`/api/agents/${encodeURIComponent(event.hostId)}/conversation?thread=${encodeURIComponent(event.threadId)}`, { cache: 'no-store', signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]) });
    if (!response.ok) { if ([401, 403, 404].includes(response.status)) onAccessLost?.(); return null; }
    return authorizedDialogueText(event, await response.json());
  } catch { return null; }
}

export default function OfficeClient({ me, role, initial, seen: seen0, observedAt }: { me: string; role: AppRole; initial: AgentEvent[]; seen: Record<string, number>; observedAt: string }) {
  const seen = useRef<Record<string, number>>({ ...seen0 });
  const world = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), labels = useRef<HTMLDivElement>(null);
  const [office, setOffice] = useState<Office>(null);
  const [items, setItems] = useState<Item[]>(() => initial.map(fromEvent));
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState(true);
  const [all, setAll] = useState(false);
  const [view, setView] = useState<'2d' | '3d'>('3d');
  const [stats, setStats] = useState<Stats | null>(null);
  const [sky, setSky] = useState<Sky | null>(null), [skyStep, setSkyStep] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const workFeed = useAgentWorkStatus(observedAt);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [dialogues, setDialogues] = useState<OfficeDialogueRecord[]>([]), [activeDialogue, setActiveDialogue] = useState<string | null>(null);
  const dialogueVersion = useRef(0);
  const authEpoch = useRef(0);
  const deniedThreads = useRef(new Set<string>()), privateVisits = useRef(new Map<string, Set<string>>());
  const closeConversation = useRef<HTMLButtonElement>(null);
  const preferredMeeting = useRef<AgentMeeting | null>(null), currentMeetings = useRef<AgentMeeting[]>([]);
  const admin = role === 'super_admin';

  // build the campus once
  useEffect(() => {
    let o: Office, stop = false;
    try { const saved = localStorage.getItem('pk-chat'); if (saved ? saved === '0' : innerWidth < 860) setPanel(false); } catch {}
    (async () => {
      try {
        const [THREE, { OrbitControls }, { createOffice, DEPT_COLOR }, roster] = await Promise.all([
          import('three'), import('three/examples/jsm/controls/OrbitControls.js'), import('@/office/engine.mjs'), import('@/office/roster.mjs')]);
        if (stop) return;
        o = createOffice({ THREE, OrbitControls, canvas: canvas.current!, labels: labels.current!, host: world.current!, roster, fill: true,
          night: document.documentElement.dataset.theme !== 'light', avoid: () => [...(world.current?.querySelectorAll('.float') || [])] as HTMLElement[],
          onSelect: (p: Person) => setSelected({ person: { id: p.id, name: p.name, dept: p.dept, room: typeof p.room === 'string' ? p.room : p.dept, human: p.human, role: p.role } }),
          onMeetingClick: (meeting: AgentMeeting | null) => {
            const id = meeting?.agentId || meeting?.agent_id || 'cmo', person = roster.PEOPLE.find((p: Person) => p.id === id);
            if (person) setSelected({ person, threadId: meeting?.threadId || meeting?.thread_id, meetingId: meeting?.id, meeting: !meeting });
          },
        });
        setPeople(Object.fromEntries(roster.PEOPLE.map((p: Person) => [p.id, p])));
        setColors(DEPT_COLOR);
        setOffice(o);
        const focus = new URLSearchParams(location.search).get('focus'); if (focus) o.flyTo(focus);
      } catch (e) { setError('This browser cannot show the 3D office. The dashboard and approvals still work.'); console.error(e); }
    })();
    const onResize = () => o?.resize();
    const onFocus = (e: Event) => o?.flyTo((e as CustomEvent<string>).detail);
    const onTheme = (e: Event) => o?.setNight((e as CustomEvent<boolean>).detail);
    addEventListener('resize', onResize); addEventListener('office:focus', onFocus); addEventListener('office:theme', onTheme);
    return () => { stop = true; removeEventListener('resize', onResize); removeEventListener('office:focus', onFocus); removeEventListener('office:theme', onTheme); o?.dispose(); };
  }, []);

  // live numbers for the occupancy card
  useEffect(() => {
    if (!office) return;
    const tick = () => { setStats(office.stats()); setNow(Date.now()); setSky(office.sky()); };
    tick(); const t = setInterval(tick, 1500); return () => clearInterval(t);
  }, [office]);

  // Actual server work is independent of short speech animations and historical events.
  useEffect(() => {
    if (!office) return;
    office.setWorkStatuses?.(workFeed.availability==='ready'?workFeed.statuses:{});
    setStats(office.stats());
  }, [office,workFeed.statuses,workFeed.availability]);

  const showDialogue = (event: DirectDialogueEvent, text: string | null, state: OfficeDialogueRecord['state'], open = true) => {
    if (event.threadId && deniedThreads.current.has(event.threadId)) return;
    if (event.threadId) {
      const ids = privateVisits.current.get(event.threadId) || new Set<string>(); ids.add(event.id); privateVisits.current.set(event.threadId, ids);
    }
    setDialogues(records => {
      const previous = records.find(r => r.id === event.id);
      const turn = { id: event.eventId, from: event.from, to: event.to, at: event.at, text: text || event.text, privateUnavailable: event.privateTask && !text };
      const next: OfficeDialogueRecord = { id: event.id, visitor: event.visitor, recipient: event.recipient, state, hostId: event.hostId, threadId: event.threadId,
        turns: previous?.turns.some(t => t.id === turn.id) ? previous.turns.map(t => t.id === turn.id ? turn : t) : [...(previous?.turns || []), turn].slice(-12) };
      return [next, ...records.filter(r => r.id !== event.id)].slice(0, 12);
    });
    if (open) setActiveDialogue(event.id);
  };
  const clearPrivateDialogue = (threadId: string | null) => {
    if (!threadId) return;
    deniedThreads.current.add(threadId);
    for (const id of privateVisits.current.get(threadId) || []) office?.cancelDialogue?.(id);
    privateVisits.current.delete(threadId);
    setDialogues(records => records.filter(record => record.threadId !== threadId));
  };

  // Fresh shared events drive the animation. Private text is read separately under the signed-in owner's RLS.
  useEffect(() => {
    if (!office) return;
    const controller = new AbortController(), received = new Set(initial.map(e => String(e.id)));
    const started = Date.parse(observedAt), queues = new Map<string, Promise<void>>();
    let cursor = Math.max(0, ...initial.map(e => e.id)), timer: ReturnType<typeof setTimeout>, pollRunning = false, pollAgain = false;
    const play = (e: AgentEvent) => {
      const a = who(e); if (!a || !office.byId[a]) return;
      const epoch = authEpoch.current;
      const dialogue = directDialogueEvent(e);
      const kind = e.kind === 'feedback' ? 'feedback' : 'talking';
      const job = async () => {
        if (controller.signal.aborted || epoch !== authEpoch.current) return;
        if (dialogue && office.byId[dialogue.recipient]) {
          const text = await dialogueText(dialogue, controller.signal, () => { if (!controller.signal.aborted) clearPrivateDialogue(dialogue.threadId); });
          if (controller.signal.aborted || epoch !== authEpoch.current || dialogue.threadId && deniedThreads.current.has(dialogue.threadId)) return;
          showDialogue(dialogue, text, 'queued');
          const played = await office.directDialogue({ id: dialogue.id, visitorId: dialogue.visitor, recipientId: dialogue.recipient, speakerId: dialogue.from,
            text: text || e.text, createdAt: dialogue.at, phase: e.payload?.interaction_mode === 'direct' ? dialogue.phase : 'single',
            onState: (state: OfficeDialogueRecord['state']) => { if (!controller.signal.aborted && epoch === authEpoch.current) showDialogue(dialogue, text, state, false); } });
          if (!played && !controller.signal.aborted && epoch === authEpoch.current) showDialogue(dialogue, text, 'interrupted', false);
          return;
        }
        // Table turns are already positioned by setMeeting; they never start desk visits.
        if (e.kind === 'think') return office.think(a, e.text);
        await office.say(a, e.text, kind);
      };
      const queue = dialogue?.id || a;
      const pending = (queues.get(queue) || Promise.resolve()).then(job, job).catch(() => {});
      queues.set(queue, pending);
      void pending.finally(() => { if (queues.get(queue) === pending) queues.delete(queue); });
    };
    const receive = (ev: AgentEvent) => {
      if (controller.signal.aborted || received.has(String(ev.id))) return;
      received.add(String(ev.id)); if (received.size > 1000) received.delete(received.values().next().value!);
      if (ev.from_agent) seen.current[ev.from_agent] = Date.parse(ev.at) || Date.now();
      setItems(list => [fromEvent(ev), ...list].sort((a, b) => b.at - a.at).slice(0, 120));
      if (Date.parse(ev.at) >= started) play(ev);
    };
    const db = supabaseBrowser();
    // Recover missed realtime inserts without replaying old activity as live movement.
    const catchUp = async () => {
      clearTimeout(timer);
      if (pollRunning) { pollAgain = true; return; }
      pollRunning = true;
      try {
        if (document.visibilityState !== 'hidden') {
          const { data } = await db.from('agent_events').select('id,at,kind,from_agent,to_agent,from_dept,to_dept,text,payload').gt('id', cursor).gte('at', observedAt).order('id').limit(100).abortSignal(controller.signal);
          if (!controller.signal.aborted && data) { for (const event of data) receive(event as AgentEvent); cursor = Math.max(cursor, ...data.map((e: { id: number }) => e.id)); }
        }
      } finally {
        pollRunning = false;
        if (!controller.signal.aborted) timer = setTimeout(() => { void catchUp().catch(() => {}); }, pollAgain ? 0 : 6000);
        pollAgain = false;
      }
    };
    // Realtime wakes the ordered database reader; it cannot deliver a reply ahead of its request.
    const ch = db.channel('agent_events').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_events' }, () => { void catchUp().catch(() => {}); }).subscribe();
    let accountId: string | null | undefined;
    const { data: authListener } = db.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      const nextId = session?.user.id || null;
      if (event === 'SIGNED_OUT' || accountId !== undefined && accountId !== nextId) {
        ++authEpoch.current;
        office.setWorkStatuses?.({});
        ++dialogueVersion.current;
        for (const threadId of privateVisits.current.keys()) clearPrivateDialogue(threadId);
        setDialogues([]); setActiveDialogue(null); setSelected(null);
      }
      accountId = nextId;
    });
    void catchUp().catch(() => {});
    return () => { controller.abort(); clearTimeout(timer); authListener.subscription.unsubscribe(); db.removeChannel(ch); };
  }, [office]);

  useEffect(() => { office?.setQuest(me, false); }, [office, me]);
  useEffect(() => { office?.setInset(selected ? 488 : panel ? 336 : 0); try { localStorage.setItem('pk-chat', panel ? '1' : '0'); } catch {} }, [panel, selected, office]);
  useEffect(() => {
    preferredMeeting.current = null;
    office?.setMeeting?.(currentMeetings.current.find(m => m.status === 'running' || m.status === 'planned') || currentMeetings.current[0] || null);
  }, [selected?.person.id, selected?.threadId, office]);
  useEffect(() => {
    if (!selected) return;
    closeConversation.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSelected(null); office?.select(null); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selected?.person.id, office]);

  // Restore the team's latest meeting on page load and keep the physical table in sync.
  useEffect(() => {
    if (!office) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      if (document.visibilityState !== 'hidden') {
        try {
          const response = await fetch('/api/agents/meetings', { cache: 'no-store', signal: controller.signal });
          if (response.ok) {
            const data = await response.json(), meetings = (data.meetings || []) as AgentMeeting[];
            if (!controller.signal.aborted) {
              currentMeetings.current = meetings;
              office.setMeeting?.(preferredMeeting.current || meetings.find(m => m.status === 'running' || m.status === 'planned') || meetings[0] || null);
            }
          }
        } catch { /* the next poll recovers without interrupting the campus */ }
      }
      if (!controller.signal.aborted) timer = setTimeout(update, 10000);
    };
    void update();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [office]);

  const cam = (fn: (o: Office) => void) => () => office && fn(office);
  const liveReady = !!stats && workFeed.availability==='ready';
  const pct = liveReady && stats.total ? Math.round(stats.active / stats.total * 100) : 0, R = 42, C = 2 * Math.PI * R;
  const name = (id: string | null) => (id && people[id]?.name.replace(' AI', '')) || id || 'System';
  const shown = items.slice(0, all ? 40 : 6);

  return (
    <section className="om">
      <div className="world" ref={world}>
        {error ? <div className="empty" style={{ margin: '110px 20px' }}>{error}</div> : <canvas ref={canvas} aria-label="3D Parakkat campus with AI staff at work" />}
        <div id="labels" ref={labels} />

        {panel && !selected && (
          <aside className="rail float" aria-label="Office status">
            <div className="pane">
              <h3>Live Occupancy</h3>
              <div className="occ">
                <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
                  <defs><linearGradient id="occ" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#5eead4" /><stop offset="1" stopColor="#0ea5a0" /></linearGradient></defs>
                  <circle cx="52" cy="52" r={R} fill="none" stroke="var(--track)" strokeWidth="9" />
                  <circle cx="52" cy="52" r={R} fill="none" stroke="url(#occ)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${C * pct / 100} ${C}`} transform="rotate(-90 52 52)" style={{ transition: 'stroke-dasharray .6s' }} />
                </svg>
                <div><div className="occ-num">{liveReady ? `${stats.active}/${stats.total}` : '–'}</div><div className="occ-sub">{workFeed.availability==='ready'?'AI staff working now':workFeed.availability==='loading'?'Checking live work…':'Live status unavailable'}</div></div>
                <div className="occ-pct">{liveReady?`${pct}%`:'–'}</div>
              </div>
              <ul className="bars">
                {(stats?.buildings || []).map(b => (
                  <li key={b.id}>
                    <button type="button" onClick={cam(o => o.flyTo(b.id))}>
                      <span className="bdot" style={{ background: BUILDING_COL[b.id] }} /><span className="bname">{b.name}</span><span className="num">{liveReady?b.active:'–'} / {b.total}</span>
                      <span className="track"><i style={{ width: `${liveReady&&b.total ? b.active / b.total * 100 : 0}%`, background: BUILDING_COL[b.id] }} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="pane grow">
              <div className="pane-head"><h3>Recent Activity</h3>{items.length > 6 && <button type="button" className="link" onClick={() => setAll(a => !a)}>{all ? 'Show less' : 'View all'} <Icon name="arrow" size={14} /></button>}</div>
              <p className="note scope">{admin ? 'You see every department.' : 'Your departments, and other teams talking to them.'}</p>
              {shown.length ? (
                <ul className="activity">
                  {shown.map(it => {
                    const p = it.from ? people[it.from] : null;
                    return (
                      <li key={it.key}>
                        <button type="button" className="av" style={{ background: p?.human ? '#d8c3a5' : colors[p?.dept || ''] || '#3b4b45', color: p?.human ? '#1c1c1c' : '#fff' }} onClick={cam(o => it.from && o.flyTo(it.from))} aria-label={`Show ${name(it.from)} in the office`}>{initials(name(it.from))}</button>
                        <div className="act"><b>{name(it.from)}{it.to ? <span> → {name(it.to)}</span> : null}</b><span>{it.text}</span>{directDialogueEvent(it.event) && <button type="button" className="link" onClick={async () => { const event = directDialogueEvent(it.event); if (!event) return; const version = ++dialogueVersion.current; const text = await dialogueText(event, undefined, () => clearPrivateDialogue(event.threadId)); if (version === dialogueVersion.current) showDialogue(event, text, 'saved'); }}>View dialogue</button>}</div>
                        <time>{ago(it.at, now)}</time>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="note">Nothing yet. Start a campaign from the Admin page, or wait for the daily sync.</p>}
            </div>
          </aside>
        )}

        <OfficeDialogue records={dialogues} activeId={activeDialogue} name={name} onSelect={setActiveDialogue} onClose={() => { ++dialogueVersion.current; setActiveDialogue(null); }}
          onLocate={id => office?.locateDialogue?.(id)} onOpenThread={record => { const person = record.hostId && people[record.hostId]; if (person && record.threadId) { setSelected({ person, threadId: record.threadId }); setActiveDialogue(null); } }} />

        {selected && <aside className={`${conversationStyles.drawer} float`} aria-label={`${selected.person.name} conversation`}>
          <div className={conversationStyles.drawerHeader}>
            <span className={conversationStyles.drawerAvatar} style={{ background: selected.person.human ? '#8b765c' : colors[selected.person.dept] || '#287b69' }} aria-hidden="true">{initials(selected.person.name)}</span>
            <div className={conversationStyles.drawerTitle}><h2>{selected.person.name}</h2><p>{selected.person.role || (selected.person.human ? 'Human team head' : 'AI team member')}</p></div>
            <button type="button" ref={closeConversation} className={conversationStyles.drawerClose} aria-label="Close agent conversation" onClick={() => { setSelected(null); office?.select(null); }}><Icon name="x" size={18} /></button>
          </div>
          {selected.person.human ? <><p className={conversationStyles.humanNote}>This is a human team head. Select an AI staff member to give them a task or ask the team to hold a meeting.</p><Link className={conversationStyles.drawerLink} href="/approvals">Open approvals<Icon name="arrow" size={14} /></Link></> : <>
            <Link className={conversationStyles.drawerLink} href={`/agents/${selected.person.id}`}>View activity and reports<Icon name="arrow" size={14} /></Link>
            <AgentConversation key={`${selected.person.id}:${selected.threadId || ''}:${selected.meetingId || ''}:${selected.meeting ? 'meeting' : ''}`} agentId={selected.person.id} agentName={selected.person.name} compact initialThreadId={selected.threadId} initialMeetingId={selected.meetingId} requestMeeting={selected.meeting}
              initialActivity={(() => { const event = items.find(it => it.from === selected.person.id); return event ? { text: event.text, at: new Date(event.at).toISOString() } : null; })()}
              onMeetings={(meetings, threadId) => {
                const visible = meetings.map(m => ({ ...m, threadId: m.threadId || threadId || undefined, agentId: m.agentId || selected.person.id }));
                const active = visible.find(m => m.status === 'running' || m.status === 'planned') || null;
                preferredMeeting.current = active;
                // Apply completed states immediately so an older global poll cannot keep attendees at the table.
                currentMeetings.current = currentMeetings.current.map(m => visible.find(v => v.id === m.id) || m);
                if (active && !currentMeetings.current.some(m => m.id === active.id)) currentMeetings.current.unshift(active);
                office?.setMeeting?.(active || currentMeetings.current.find(m => m.status === 'running' || m.status === 'planned') || currentMeetings.current[0] || null);
              }} />
          </>}
        </aside>}

        <div className="dock float" role="toolbar" aria-label="Quick actions">
          {admin ? <Link href="/admin?tab=operations#campaign"><Icon name="rocket" size={22} /><span>Start Campaign</span></Link> : <Link href="/dashboard"><Icon name="chart" size={22} /><span>Dashboard</span></Link>}
          <Link href="/approvals"><Icon name="check" size={22} /><span>Approvals</span></Link>
          {admin ? <Link href="/admin?tab=connections#sync"><Icon name="sync" size={22} /><span>Sync Data</span></Link> : <button type="button" onClick={cam(o => o.flyTo(null))}><Icon name="map" size={22} /><span>Whole Campus</span></button>}
          <button type="button" onClick={() => dispatchEvent(new CustomEvent('office:find'))}><Icon name="findUser" size={22} /><span>Find a Colleague</span></button>
        </div>

        <div className="mapctl float">
          <div className="seg" role="group" aria-label="View">
            {(['2d', '3d'] as const).map(v => <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); office?.setView(v); }}>{v.toUpperCase()}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom out" onClick={cam(o => o.zoom(1.25))}><Icon name="minus" size={18} /></button>
            <button type="button" aria-label="Zoom in" onClick={cam(o => o.zoom(.8))}><Icon name="plus" size={18} /></button>
          </div>
          <button type="button" className="sq" aria-label="Full screen" onClick={cam(o => o.fullscreen())}><Icon name="expand" size={18} /></button>
          <button type="button" className="sq" aria-pressed={panel} aria-label={panel ? 'Hide side panel' : 'Show side panel'} onClick={() => setPanel(p => !p)}><Icon name="panel" size={18} /></button>
        </div>

        <button type="button" className="skychip float" title={sky ? `${sky.moon.name} tonight, ${sky.moon.lit}% lit. Click for ${SKY_STEPS[(skyStep + 1) % SKY_STEPS.length].label.toLowerCase()}.` : 'Sky'}
          aria-label={`Sky: ${SKY_STEPS[skyStep].label}. Change`} onClick={() => { const n = (skyStep + 1) % SKY_STEPS.length; setSkyStep(n); office?.setTime(SKY_STEPS[n].set); setSky(office?.sky()); }}>
          <Icon name={sky && (sky.hour < 6.1 || sky.hour > 18.6) ? 'moon' : 'sun'} size={18} />
          <span><b>{sky ? clock(sky.hour) : '–'}</b><small>{SKY_STEPS[skyStep].id === 'live' ? (sky && (sky.hour < 6.1 || sky.hour > 18.6) ? sky.moon.name : 'Kerala time') : SKY_STEPS[skyStep].label}</small></span>
        </button>

        <p className="float hint">Click an agent to talk · drag to move · scroll to zoom</p>
      </div>
    </section>
  );
}
