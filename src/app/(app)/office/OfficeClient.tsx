'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { AppRole } from '@/lib/roles';
import { Icon } from '@/components/Icon';

export type AgentEvent = { id: number; at: string; kind: string; from_agent: string | null; to_agent: string | null; from_dept: string | null; to_dept: string | null; text: string; payload: Record<string, string> | null };
type Office = any; // the engine is plain JS; see src/office/engine.mjs for its API
type Stats = { total: number; active: number; buildings: { id: string; name: string; total: number; active: number }[] };
type Item = { key: string; at: number; from: string | null; to: string | null; text: string };
type Person = { id: string; name: string; dept: string; room: string; human?: boolean };
type Sky = { hour: number; live: boolean; lapse: boolean; moon: { name: string; lit: number } };
// the sky button steps through: live Kerala time, a day in 90 seconds, then sunrise, midday, sunset and night
const SKY_STEPS: { id: string; label: string; set: number | 'lapse' | null }[] = [
  { id: 'live', label: 'Live time', set: null }, { id: 'lapse', label: 'Day in 90 s', set: 'lapse' }, { id: 'rise', label: 'Sunrise', set: 6.3 },
  { id: 'noon', label: 'Midday', set: 12.5 }, { id: 'set', label: 'Sunset', set: 18.25 }, { id: 'night', label: 'Night', set: 21.5 },
];
const clock = (h: number) => { const m = Math.floor((h % 1) * 60), hh = Math.floor(h) % 24; return `${hh % 12 || 12}:${String(m).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };

const who = (e: AgentEvent) => e.from_agent || e.payload?.from_person || null;
const whom = (e: AgentEvent) => e.to_agent || e.payload?.to_person || null;
const fromEvent = (e: AgentEvent): Item => ({ key: 'e' + e.id, at: Date.parse(e.at), from: who(e), to: whom(e), text: e.text });
const BUILDING_COL: Record<string, string> = { hq: '#22c79f', ic: '#3b82f6', ch: '#f59e0b' };
const ago = (t: number, now: number) => { const m = Math.round((now - t) / 6e4); return m < 1 ? 'now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const initials = (n: string) => n.replace(' AI', '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

export default function OfficeClient({ me, role, initial }: { me: string; role: AppRole; initial: AgentEvent[] }) {
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
  const [error, setError] = useState('');
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
          night: document.documentElement.dataset.theme !== 'light', avoid: () => [...(world.current?.querySelectorAll('.float') || [])] as HTMLElement[] });
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

  // live: play each new event in the office, one queue per agent so nobody is in two places at once
  useEffect(() => {
    if (!office) return;
    const queues = new Map<string, Promise<void>>();
    const play = (e: AgentEvent) => {
      const a = who(e), b = whom(e); if (!a || !office.byId[a]) return;
      const kind = e.kind === 'feedback' ? 'feedback' : 'talking';
      const job = async () => {
        if (e.kind === 'think') return office.think(a, e.text);
        if (b && b !== a && office.byId[b]) { office.setCarry(a, e.kind === 'report' || e.kind === 'walk' || e.kind === 'approval'); await office.walkTo(a, b); await office.say(a, e.text, kind); office.walkHome(a); }
        else await office.say(a, e.text, kind);
      };
      queues.set(a, (queues.get(a) || Promise.resolve()).then(job, job));
    };
    const ch = supabaseBrowser().channel('agent_events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_events' }, ({ new: e }: { new: unknown }) => {
        setItems(list => [fromEvent(e as AgentEvent), ...list].slice(0, 120)); play(e as AgentEvent);
      }).subscribe();
    return () => { supabaseBrowser().removeChannel(ch); };
  }, [office]);

  useEffect(() => { office?.setQuest(me, false); }, [office, me]);
  useEffect(() => { office?.setInset(panel ? 336 : 0); try { localStorage.setItem('pk-chat', panel ? '1' : '0'); } catch {} }, [panel, office]);

  const cam = (fn: (o: Office) => void) => () => office && fn(office);
  const pct = stats ? Math.round(stats.active / stats.total * 100) : 0, R = 42, C = 2 * Math.PI * R;
  const name = (id: string | null) => (id && people[id]?.name.replace(' AI', '')) || id || 'System';
  const shown = items.slice(0, all ? 40 : 6);

  return (
    <section className="om">
      <div className="world" ref={world}>
        {error ? <div className="empty" style={{ margin: '110px 20px' }}>{error}</div> : <canvas ref={canvas} aria-label="3D Parakkat campus with AI staff at work" />}
        <div id="labels" ref={labels} />

        {panel && (
          <aside className="rail float" aria-label="Office status">
            <div className="pane">
              <h3>Live Occupancy</h3>
              <div className="occ">
                <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
                  <defs><linearGradient id="occ" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#5eead4" /><stop offset="1" stopColor="#0ea5a0" /></linearGradient></defs>
                  <circle cx="52" cy="52" r={R} fill="none" stroke="var(--track)" strokeWidth="9" />
                  <circle cx="52" cy="52" r={R} fill="none" stroke="url(#occ)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${C * pct / 100} ${C}`} transform="rotate(-90 52 52)" style={{ transition: 'stroke-dasharray .6s' }} />
                </svg>
                <div><div className="occ-num">{stats ? `${stats.active}/${stats.total}` : '–'}</div><div className="occ-sub">Staff active now</div></div>
                <div className="occ-pct">{pct}%</div>
              </div>
              <ul className="bars">
                {(stats?.buildings || []).map(b => (
                  <li key={b.id}>
                    <button type="button" onClick={cam(o => o.flyTo(b.id))}>
                      <span className="bdot" style={{ background: BUILDING_COL[b.id] }} /><span className="bname">{b.name}</span><span className="num">{b.active} / {b.total}</span>
                      <span className="track"><i style={{ width: `${b.total ? b.active / b.total * 100 : 0}%`, background: BUILDING_COL[b.id] }} /></span>
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
                        <div className="act"><b>{name(it.from)}{it.to ? <span> → {name(it.to)}</span> : null}</b><span>{it.text}</span></div>
                        <time>{ago(it.at, now)}</time>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="note">Nothing yet. Start a campaign from the Admin page, or wait for the daily sync.</p>}
            </div>
          </aside>
        )}

        <div className="dock float" role="toolbar" aria-label="Quick actions">
          {admin ? <Link href="/admin#campaign"><Icon name="rocket" size={22} /><span>Start Campaign</span></Link> : <Link href="/dashboard"><Icon name="chart" size={22} /><span>Dashboard</span></Link>}
          <Link href="/approvals"><Icon name="check" size={22} /><span>Approvals</span></Link>
          {admin ? <Link href="/admin#sync"><Icon name="sync" size={22} /><span>Sync Data</span></Link> : <button type="button" onClick={cam(o => o.flyTo(null))}><Icon name="map" size={22} /><span>Whole Campus</span></button>}
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

        <p className="float hint">Drag to move · right-drag to turn · scroll to zoom</p>
      </div>
    </section>
  );
}
