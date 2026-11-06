'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { AppRole } from '@/lib/roles';
import { Icon } from '@/components/Icon';
import type { AgentMeeting } from '@/components/AgentConversation';
import conversationStyles from '@/components/AgentConversation.module.css';
import OfficeDialogue, { type OfficeDialogueRecord } from '@/components/OfficeDialogue';
import { directDialogueEvent, authorizedDialogueText, type DirectDialogueEvent } from '@/office/dialogue-events.mjs';
import { useAgentWorkStatus } from '@/components/useAgentWorkStatus';
import { BUILDINGS, PEOPLE, ROOMS, teamLead } from '@/office/roster.mjs';
import { areaAt, OFFICE_ROOMS } from '@/office/floorplan.mjs';
import { EscMenu, FindPanel, FloorMap, RoomBanner, TouchControls, WalkKeys, WalkPrompt, type Area, type Mode, type Prompt } from './OfficeHud';

const AgentConversation = dynamic(() => import('@/components/AgentConversation'), { loading: () => <p className="note">Opening conversation…</p> });

export type AgentEvent = { id: number; at: string; kind: string; from_agent: string | null; to_agent: string | null; from_dept: string | null; to_dept: string | null; text: string; payload: Record<string, unknown> | null };
type Office = any; // the engine is plain JS; see src/office/engine.mjs for its API
type Hq = any;
type Stats = { total: number; active: number; buildings: { id: string; name: string; total: number; active: number }[] };
type Item = { key: string; at: number; from: string | null; to: string | null; text: string; event: AgentEvent };
type Person = { id: string; name: string; dept: string; room: string; human?: boolean; role?: string };
type Selection = { person: Person; threadId?: string; meetingId?: string; meeting?: boolean };
type WaitingReport = { id: string; title: string; department_id: string };

const who = (e: AgentEvent) => e.from_agent || (typeof e.payload?.from_person === 'string' ? e.payload.from_person : null);
const whom = (e: AgentEvent) => e.to_agent || (typeof e.payload?.to_person === 'string' ? e.payload.to_person : null);
const fromEvent = (e: AgentEvent): Item => ({ key: 'e' + e.id, at: Date.parse(e.at), from: who(e), to: whom(e), text: e.text, event: e });
const ago = (t: number, now: number) => { const m = Math.round((now - t) / 6e4); return m < 1 ? 'now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const initials = (n: string) => n.replace(' AI', '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const keralaClock = (now: number) => new Date(now).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const QUICK_ASKS = ['What are you doing now?', 'Any problems?', 'How far along are you?', "What's next?"];
const COUNT = (n: number) => String(n);
const stationDepts = ROOMS.filter(r => r.id !== 'lead' && r.id !== 'board');

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
  const hqHost = useRef<HTMLDivElement>(null), hqCanvas = useRef<HTMLCanvasElement>(null), hqLabels = useRef<HTMLDivElement>(null), hq = useRef<Hq>(null);
  const [office, setOffice] = useState<Office>(null);
  const [items, setItems] = useState<Item[]>(() => initial.map(fromEvent));
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState(true);
  const [view, setView] = useState<'2d' | '3d'>('3d');
  const [stats, setStats] = useState<Stats | null>(null);
  const [now, setNow] = useState(() => Date.parse(observedAt));
  const workFeed = useAgentWorkStatus(observedAt);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [dialogues, setDialogues] = useState<OfficeDialogueRecord[]>([]), [activeDialogue, setActiveDialogue] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('overview'), [hqOpen, setHqOpen] = useState(false);
  const [area, setArea] = useState<Area>(null), [prompt, setPrompt] = useState<Prompt>(null), [banner, setBanner] = useState<Area>(null);
  const [menu, setMenu] = useState(false), [find, setFind] = useState(false), [thirdPerson, setThirdPerson] = useState(false), [touch, setTouch] = useState(false), [hint, setHint] = useState(true);
  const [waiting, setWaiting] = useState<WaitingReport[]>([]);
  const dialogueVersion = useRef(0);
  const authEpoch = useRef(0);
  const deniedThreads = useRef(new Set<string>()), privateVisits = useRef(new Map<string, Set<string>>());
  const closeConversation = useRef<HTMLButtonElement>(null);
  const preferredMeeting = useRef<AgentMeeting | null>(null), currentMeetings = useRef<AgentMeeting[]>([]);
  const admin = role === 'super_admin';
  const screenMode: Mode = hqOpen ? 'hq' : mode;

  // build the office once
  useEffect(() => {
    let o: Office, stop = false;
    try { if (localStorage.getItem('pk-chat') === '0' || innerWidth < 860) setPanel(false); } catch {}
    setTouch(matchMedia('(pointer: coarse)').matches);
    (async () => {
      try {
        const [THREE, { OrbitControls }, { createOffice, DEPT_COLOR }, roster] = await Promise.all([
          import('three'), import('three/examples/jsm/controls/OrbitControls.js'), import('@/office/engine.mjs'), import('@/office/roster.mjs')]);
        if (stop) return;
        o = createOffice({ THREE, OrbitControls, canvas: canvas.current!, labels: labels.current!, host: world.current!, roster, fill: true,
          avoid: () => [...(world.current?.querySelectorAll('.float') || [])] as HTMLElement[],
          onSelect: (p: Person) => { if (o.mode === 'walk') o.setInputEnabled(false); setSelected({ person: { id: p.id, name: p.name, dept: p.dept, room: typeof p.room === 'string' ? p.room : p.dept, human: p.human, role: p.role } }); },
          onMeetingClick: (meeting: AgentMeeting | null) => {
            const id = meeting?.agentId || meeting?.agent_id || 'cmo', person = roster.PEOPLE.find((p: Person) => p.id === id);
            if (person) setSelected({ person, threadId: meeting?.threadId || meeting?.thread_id, meetingId: meeting?.id, meeting: !meeting });
          },
          onMode: (next: 'overview' | 'walk') => { setMode(next); if (next === 'overview') { setMenu(false); setHint(true); } },
          onArea: (a: Area) => { setArea(a); if (a?.no) setBanner(a); },
          onPrompt: setPrompt,
          onTalk: (p: Person) => { o.setInputEnabled(false); setSelected({ person: { id: p.id, name: p.name, dept: p.dept, room: typeof p.room === 'string' ? p.room : p.dept, human: p.human, role: p.role } }); },
          onMenu: (open: boolean) => { if (open) { o.setInputEnabled(false); setMenu(true); } },
        });
        setPeople(Object.fromEntries(roster.PEOPLE.map((p: Person) => [p.id, p])));
        setColors(DEPT_COLOR);
        setOffice(o);
        const params = new URLSearchParams(location.search), focus = params.get('focus');
        if (focus) o.flyTo(focus);
        if (params.get('view') === 'hq') setHqOpen(true);
      } catch (e) { setError('This browser cannot show the 3D office. Home and the Inbox still work.'); console.error(e); }
    })();
    const onResize = () => o?.resize();
    const onFocus = (e: Event) => o?.flyTo((e as CustomEvent<string>).detail);
    addEventListener('resize', onResize); addEventListener('office:focus', onFocus);
    return () => { stop = true; removeEventListener('resize', onResize); removeEventListener('office:focus', onFocus); o?.dispose(); };
  }, []);

  // live numbers
  useEffect(() => {
    if (!office) return;
    const tick = () => { setStats(office.stats()); setNow(Date.now()); };
    tick(); const t = setInterval(tick, 1500); return () => clearInterval(t);
  }, [office]);

  // Actual server work is independent of short speech animations and historical events.
  useEffect(() => {
    if (!office) return;
    office.setWorkStatuses?.(workFeed.availability === 'ready' ? workFeed.statuses : {});
    setStats(office.stats());
  }, [office, workFeed.statuses, workFeed.availability]);

  // Reports waiting on a person. Row-level security limits these to what this viewer may see.
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const db = supabaseBrowser();
    const load = async () => {
      if (document.visibilityState !== 'hidden') {
        try { const { data } = await db.from('reports').select('id,title,department_id').eq('status', 'with_head').order('created_at', { ascending: false }).limit(40); if (!stop && data) setWaiting(data as WaitingReport[]); } catch { /* the next poll recovers */ }
      }
      if (!stop) timer = setTimeout(load, 30000);
    };
    void load(); return () => { stop = true; clearTimeout(timer); };
  }, []);

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
        setDialogues([]); setActiveDialogue(null); setSelected(null); setWaiting([]);
      }
      accountId = nextId;
    });
    void catchUp().catch(() => {});
    return () => { controller.abort(); clearTimeout(timer); authListener.subscription.unsubscribe(); db.removeChannel(ch); };
  }, [office]);

  useEffect(() => { office?.setQuest(me, false); }, [office, me]);
  useEffect(() => {
    office?.setInset(mode === 'overview' ? (selected ? 488 : panel ? 300 : 0) : 0);
    try { localStorage.setItem('pk-chat', panel ? '1' : '0'); } catch {}
  }, [panel, selected, office, mode]);
  useEffect(() => {
    preferredMeeting.current = null;
    office?.setMeeting?.(currentMeetings.current.find(m => m.status === 'running' || m.status === 'planned') || currentMeetings.current[0] || null);
  }, [selected?.person.id, selected?.threadId, office]);

  const closeChat = (keepWalking = true) => {
    setSelected(null); office?.select(null);
    if (office?.mode === 'walk') { office.setInputEnabled(true); if (keepWalking && !touch) office.capturePointer(); }
  };
  useEffect(() => {
    if (!selected) return;
    closeConversation.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') closeChat(); };
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
        } catch { /* the next poll recovers without interrupting the office */ }
      }
      if (!controller.signal.aborted) timer = setTimeout(update, 10000);
    };
    void update();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [office]);

  /* ---------- what the wall screens and Agent HQ show: all of it real ---------- */
  const liveWork = useMemo(() => {
    const list: { id: string; state: string; label: string }[] = [];
    if (workFeed.availability === 'ready') for (const [id, s] of Object.entries(workFeed.statuses) as [string, { state: string; label: string; expiresAt: number }][]) if (s.expiresAt > now) list.push({ id, state: s.state, label: s.label });
    return list;
  }, [workFeed.statuses, workFeed.availability, now]);
  const name = (id: string | null) => (id && people[id]?.name.replace(' AI', '')) || id || 'System';
  useEffect(() => {
    if (!office) return;
    const working = liveWork.filter(w => w.state === 'working' || w.state === 'thinking');
    office.setBoard?.({ status: `LIVE · ${keralaClock(now)}`, columns: [
      { title: 'Working now', count: working.length, items: working.map(w => `${name(w.id)}: ${w.label}`) },
      { title: 'Waiting on people', count: waiting.length, items: waiting.map(r => r.title) },
      { title: 'Latest', count: items.length, items: items.slice(0, 4).map(i => `${name(i.from)}: ${i.text}`) },
    ] });
  }, [office, liveWork, waiting, items, Math.floor(now / 60000)]);

  const hqData = useMemo(() => {
    const departments: Record<string, { state: string; workers: number; lines: string[] }> = {}, order: Record<string, number> = { blocked: 5, waiting: 4, thinking: 3, working: 2 };
    for (const w of liveWork) {
      const dept = people[w.id]?.dept; if (!dept) continue;
      const d = departments[dept] ||= { state: 'asleep', workers: 0, lines: [] };
      if ((order[w.state] || 0) > (order[d.state] || 0)) d.state = w.state;
      if (w.state === 'working' || w.state === 'thinking') d.workers++;
      d.lines.push(`${name(w.id)} · ${w.label}`);
    }
    for (const r of waiting) { const d = departments[r.department_id] ||= { state: 'asleep', workers: 0, lines: [] }; if (d.state === 'asleep') d.state = 'ok'; d.lines.push(r.title); }
    const awake = stationDepts.filter(r => departments[r.id] && departments[r.id].state !== 'asleep').length;
    return { departments, awake, summary: `${stats?.active ?? 0} of ${stats?.total ?? 70} staff working` };
  }, [liveWork, waiting, people, stats]);

  // Agent HQ takes over the screen and has its own scene, so the office stops drawing while it is open.
  useEffect(() => {
    if (!office || !hqOpen) return;
    let stop = false;
    office.setVisible(false);
    (async () => {
      const [THREE, { createAgentHq }, { DEPT_COLOR }] = await Promise.all([import('three'), import('@/office/agent-hq.mjs'), import('@/office/engine.mjs')]);
      if (stop) return;
      hq.current = createAgentHq({ THREE, canvas: hqCanvas.current!, labels: hqLabels.current!, host: hqHost.current!, inset: 296,
        departments: stationDepts.map(r => { const lead = PEOPLE.find(p => p.id === teamLead(r.id)); return { id: r.id, name: r.name, short: r.name, color: (DEPT_COLOR as Record<string, string>)[r.id], lead: lead?.name, role: lead?.role, count: PEOPLE.filter(p => p.dept === r.id).length }; }),
        onOpen: (id: string) => { const lead = PEOPLE.find(p => p.id === teamLead(id)); if (lead) setSelected({ person: lead as Person }); } });
      hq.current.update(hqData);
    })();
    return () => { stop = true; hq.current?.dispose(); hq.current = null; office.setVisible(true); };
  }, [office, hqOpen]);
  useEffect(() => { hq.current?.update(hqData); }, [hqData]);

  const cam = (fn: (o: Office) => void) => () => office && fn(office);
  const liveReady = !!stats && workFeed.availability === 'ready';
  const events24h = items.filter(i => now - i.at < 864e5).length;
  const findable = useMemo(() => [
    ...OFFICE_ROOMS.map(r => ({ id: r.id, label: r.name, sub: `Room ${String(r.no).padStart(2, '0')}` })),
    ...ROOMS.map(r => ({ id: r.id, label: r.name, sub: `Team · ${BUILDINGS.find(b => b.id === r.building)?.short || ''}` })),
    ...PEOPLE.map(p => ({ id: p.id, label: p.name, sub: `${p.human ? 'Person' : 'AI staff'} · ${ROOMS.find(r => r.id === p.room)?.name || ''}` })),
  ], []);
  const walkIn = () => { setHqOpen(false); setSelected(null); office?.select(null); if (office?.mode !== 'walk') office?.enterWalk(); };
  const goOverview = () => { setHqOpen(false); setMenu(false); setSelected(null); office?.setInputEnabled(true); office?.exitWalk(); };
  const resume = () => { setMenu(false); office?.setInputEnabled(true); if (!touch) office?.capturePointer(); };
  const openNav = () => window.dispatchEvent(new Event('workspace:navigation'));
  const chooseFind = (id: string) => { setFind(false); setMenu(false); if (office?.mode === 'walk') { office.setInputEnabled(true); office.flyTo(id); if (!touch) office.capturePointer(); } else office?.flyTo(id); };
  useEffect(() => { if (mode !== 'walk') return; const t = setTimeout(() => setHint(false), 7000); return () => clearTimeout(t); }, [mode]);
  // clear a finished banner so walking back into a room shows it again
  useEffect(() => { if (!banner) return; const t = setTimeout(() => setBanner(null), 3400); return () => clearTimeout(t); }, [banner]);

  const conversation = (compact: boolean) => selected && !selected.person.human ? <AgentConversation key={`${selected.person.id}:${selected.threadId || ''}:${selected.meetingId || ''}:${selected.meeting ? 'meeting' : ''}`} agentId={selected.person.id} agentName={selected.person.name} compact initialThreadId={selected.threadId} initialMeetingId={selected.meetingId} requestMeeting={selected.meeting} quickAsks={compact ? QUICK_ASKS : undefined}
    initialActivity={(() => { const event = items.find(it => it.from === selected.person.id); return event ? { text: event.text, at: new Date(event.at).toISOString() } : null; })()}
    onMeetings={(meetings, threadId) => {
      const visible = meetings.map(m => ({ ...m, threadId: m.threadId || threadId || undefined, agentId: m.agentId || selected.person.id }));
      const active = visible.find(m => m.status === 'running' || m.status === 'planned') || null;
      preferredMeeting.current = active;
      // Apply completed states immediately so an older global poll cannot keep attendees at the table.
      currentMeetings.current = currentMeetings.current.map(m => visible.find(v => v.id === m.id) || m);
      if (active && !currentMeetings.current.some(m => m.id === active.id)) currentMeetings.current.unshift(active);
      office?.setMeeting?.(active || currentMeetings.current.find(m => m.status === 'running' || m.status === 'planned') || currentMeetings.current[0] || null);
    }} /> : null;
  const statusLine = selected ? (() => { const work = liveWork.find(w => w.id === selected.person.id); return work ? `${work.label}` : selected.person.role || (selected.person.human ? 'Human team head' : 'AI team member'); })() : '';
  const humanNote = selected?.person.human ? <><p className={conversationStyles.humanNote}>This is a human team head. Select an AI staff member to give them a task or ask the team to hold a meeting.</p><Link className={conversationStyles.drawerLink} href="/approvals">Open approvals<Icon name="arrow" size={14} /></Link></> : null;

  const log = (limit: number) => items.slice(0, limit);

  return (
    <section className="om" data-theme="dark" data-mode={screenMode}>
      <div className="world" ref={world}>
        {error ? <div className="empty" style={{ margin: '110px 20px' }}>{error}</div> : <canvas ref={canvas} aria-label="3D Parakkat office. Walk inside, or look down into the building from above." />}
        <div id="labels" ref={labels} />

        {/* ---------- top of the screen, every mode ---------- */}
        <div className="hud-brand float">
          <button type="button" className="hud-btn" aria-label="Open workspace navigation" onClick={openNav}><Icon name="menu" size={18} /></button>
          {screenMode === 'hq' ? <div className="hud-brand-name hud-panel">AGENT HQ<small className="hq-live"><i aria-hidden="true" />{workFeed.availability === 'ready' ? 'LIVE' : 'STATUS OFFLINE'} · {keralaClock(now)}</small></div> : <Link href="/dashboard" className="hud-brand-name hud-panel">PARAKKAT AI OFFICE<small>74 PEOPLE · ALWAYS ON</small></Link>}
        </div>
        <div className="hud-modes hud-panel float" role="group" aria-label="View">
          <button type="button" aria-pressed={screenMode === 'overview'} onClick={goOverview}>From above</button>
          <button type="button" aria-pressed={screenMode === 'walk'} onClick={walkIn}>Walk inside</button>
          <button type="button" aria-pressed={screenMode === 'hq'} onClick={() => { office?.exitWalk(); setSelected(null); setHqOpen(true); }}>Agent HQ</button>
        </div>

        {/* ---------- from above ---------- */}
        {screenMode === 'overview' && <>
          <div className="hud-tiles float">
            <div className="hud-tile hud-panel"><b>{liveReady ? `${stats.active}/${stats.total}` : '–'}</b><span>{workFeed.availability === 'unavailable' ? 'Status offline' : 'Working now'}</span></div>
            <Link href="/approvals" className="hud-tile hud-panel" data-alert={waiting.length > 0} style={{ textDecoration: 'none' }}><b>{COUNT(waiting.length)}</b><span>Waiting on you</span></Link>
            <div className="hud-tile hud-panel"><b>{keralaClock(now)}</b><span>Kerala time</span></div>
          </div>
          <div className="hud-side float">
            <div className="hud-seg hud-panel" role="group" aria-label="Map controls">
              {(['3d', '2d'] as const).map(v => <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); office?.setView(v); }}>{v.toUpperCase()}</button>)}
              <button type="button" aria-label="Zoom in" onClick={cam(o => o.zoom(.8))}><Icon name="plus" size={17} /></button>
              <button type="button" aria-label="Zoom out" onClick={cam(o => o.zoom(1.25))}><Icon name="minus" size={17} /></button>
              <button type="button" aria-label="Whole office" onClick={cam(o => o.flyTo(null))}><Icon name="map" size={17} /></button>
              <button type="button" aria-label="Full screen" onClick={cam(o => o.fullscreen())}><Icon name="expand" size={17} /></button>
              <button type="button" aria-pressed={panel} aria-label={panel ? 'Hide activity log' : 'Show activity log'} onClick={() => setPanel(p => !p)}><Icon name="panel" size={17} /></button>
            </div>
          </div>
          {panel && !selected && (
            <aside className="hud-rail hud-panel float" aria-label="Agent activity">
              <div className="hud-rail-head"><span>Agent activity · live log</span><b>{items.length}</b></div>
              {items.length ? <ol className="live-log">
                {log(40).map((it, i) => (
                  <li key={it.key}><span className="n">{String(i + 1).padStart(2, '0')}</span><div>
                    <button type="button" className="who" onClick={cam(o => it.from && o.focus(it.from))}>{name(it.from)}{it.to ? ` → ${name(it.to)}` : ''}</button>
                    <p>{it.text}</p><time>{ago(it.at, now)}</time>
                    {directDialogueEvent(it.event) && <button type="button" className="link" onClick={async () => { const event = directDialogueEvent(it.event); if (!event) return; const version = ++dialogueVersion.current; const text = await dialogueText(event, undefined, () => clearPrivateDialogue(event.threadId)); if (version === dialogueVersion.current) showDialogue(event, text, 'saved'); }}>View dialogue</button>}
                  </div></li>
                ))}
              </ol> : <p className="live-log-empty">Nothing yet. Start a campaign in Campaigns, or wait for the daily sync.</p>}
              <div className="hud-rail-foot">{admin ? 'You see every department.' : 'Your departments, and other teams talking to them.'}</div>
            </aside>
          )}
          <div className="hud-dock float" role="toolbar" aria-label="Quick actions">
            <Link className="hud-btn" href="/tasks"><Icon name="doc" size={17} /><span>Tasks & chat</span></Link>
            {admin ? <Link className="hud-btn" href="/campaigns"><Icon name="rocket" size={17} /><span>Start campaign</span></Link> : <Link className="hud-btn" href="/dashboard"><Icon name="home" size={17} /><span>Home</span></Link>}
            <Link className="hud-btn" href="/approvals"><Icon name="inbox" size={17} /><span>Inbox</span></Link>
            {admin && <Link className="hud-btn" href="/admin?tab=connections#sync"><Icon name="sync" size={17} /><span>Sync data</span></Link>}
            <button type="button" className="hud-btn" aria-pressed={find} onClick={() => setFind(f => !f)}><Icon name="findUser" size={17} /><span>Find a colleague</span></button>
          </div>
        </>}
        {find && !menu && screenMode !== 'hq' && <FindPanel items={findable} onChoose={chooseFind} onClose={() => { setFind(false); if (office?.mode === 'walk') setMenu(true); }} />}

        {/* ---------- on foot ---------- */}
        {screenMode === 'walk' && <>
          {!selected && <div className="crosshair float" aria-hidden="true" />}
          {!selected && !menu && <WalkPrompt prompt={prompt} />}
          {!touch && <WalkKeys />}
          {hint && !selected && !menu && <p className="walk-hint float">{touch ? 'Drag to look around. Use the stick to walk.' : 'Click to look around with the mouse. Walk up to the doors and they open.'}</p>}
          {touch && !selected && !menu && <TouchControls office={office} prompt={prompt} />}
          {banner && !selected && !menu && <RoomBanner area={banner} />}
          {selected && <aside className="walk-chat hud-panel float" aria-label={`${selected.person.name} conversation`}>
            <div className="walk-chat-head">
              <span className="walk-chat-avatar" style={{ background: selected.person.human ? '#8b765c' : colors[selected.person.dept] || '#6b5a44' }} aria-hidden="true">{initials(selected.person.name)}</span>
              <div><b>{selected.person.name}</b><small>{statusLine}</small></div>
              <button type="button" ref={closeConversation} className="hud-btn" aria-label="Close and keep walking" onClick={() => closeChat()}><Icon name="x" size={16} /></button>
            </div>
            <div className="walk-chat-body">{selected.person.human ? humanNote : conversation(true)}</div>
            {!selected.person.human && <div className="walk-chat-foot"><span>Esc to keep walking</span><Link href={`/agents/${selected.person.id}`}>Activity and reports</Link></div>}
          </aside>}
          {menu && <EscMenu thirdPerson={thirdPerson} onResume={resume} onOverview={goOverview} onHq={() => { goOverview(); setHqOpen(true); }} onFind={() => { setMenu(false); setFind(true); }} onNav={openNav} onToggleView={() => { office?.toggleThirdPerson(); setThirdPerson(t => !t); }} />}
        </>}
        {screenMode !== 'hq' && <FloorMap office={office} mode={screenMode} area={area} onChoose={id => { const here = office?.mode === 'walk'; office?.flyTo(id); if (!here) { const r = OFFICE_ROOMS.find(x => x.id === id); setArea(r ? { id: r.id, name: r.name, no: r.no } : null); } else { const p = office.player(), a = areaAt(p.x, p.z); setArea(a); } }} />}

        {/* ---------- Agent HQ ---------- */}
        {hqOpen && <div className="hq" ref={hqHost}>
          <canvas ref={hqCanvas} aria-label="Agent HQ: every department as a station that wakes when real work starts" />
          <div className="hq-labels" ref={hqLabels} />
          <div className="hud-tiles float" style={{ zIndex: 6 }}>
            <div className="hud-tile hud-panel"><b>{keralaClock(now)}</b><span>Kerala time</span></div>
            <div className="hud-tile hud-panel"><b>{items.length >= 120 ? '120+' : events24h}</b><span>Events · 24h</span></div>
            <div className="hud-tile hud-panel"><b>{hqData.awake}/{stationDepts.length}</b><span>Teams awake</span></div>
          </div>
          <aside className="hq-log hud-panel float" aria-label="Agent activity log">
            <div className="hud-rail-head"><span>Agent activity · live log</span><b>{items.length}</b></div>
            {items.length ? <ol className="live-log">{log(30).map((it, i) => <li key={it.key}><span className="n">{String(i + 1).padStart(2, '0')}</span><span>{name(it.from)} · {it.text}</span></li>)}</ol> : <p className="live-log-empty">No agent activity yet.</p>}
          </aside>
          {waiting.length > 0 && <Link className="hq-waiting float" href="/approvals">Waiting for your OK · {waiting.length}</Link>}
        </div>}

        <div style={{ position: 'relative', zIndex: 7 }}>
          <OfficeDialogue records={dialogues} activeId={activeDialogue} name={name} onSelect={setActiveDialogue} onClose={() => { ++dialogueVersion.current; setActiveDialogue(null); }}
            onLocate={id => office?.locateDialogue?.(id)} onOpenThread={record => { const person = record.hostId && people[record.hostId]; if (person && record.threadId) { setSelected({ person, threadId: record.threadId }); setActiveDialogue(null); } }} />
        </div>

        {/* ---------- conversation drawer, from above and in HQ ---------- */}
        {selected && screenMode !== 'walk' && <aside className={`${conversationStyles.drawer} float`} style={{ zIndex: 7 }} aria-label={`${selected.person.name} conversation`}>
          <div className={conversationStyles.drawerHeader}>
            <span className={conversationStyles.drawerAvatar} style={{ background: selected.person.human ? '#8b765c' : colors[selected.person.dept] || '#287b69' }} aria-hidden="true">{initials(selected.person.name)}</span>
            <div className={conversationStyles.drawerTitle}><h2>{selected.person.name}</h2><p>{selected.person.role || (selected.person.human ? 'Human team head' : 'AI team member')}</p></div>
            <button type="button" ref={closeConversation} className={conversationStyles.drawerClose} aria-label="Close agent conversation" onClick={() => closeChat(false)}><Icon name="x" size={18} /></button>
          </div>
          {selected.person.human ? humanNote : <>
            <Link className={conversationStyles.drawerLink} href={`/agents/${selected.person.id}`}>View activity and reports<Icon name="arrow" size={14} /></Link>
            {conversation(false)}
          </>}
        </aside>}
      </div>
    </section>
  );
}
