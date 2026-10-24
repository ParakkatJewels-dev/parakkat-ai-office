'use client';
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { AppRole } from '@/lib/roles';

export type AgentEvent = { id: number; at: string; kind: string; from_agent: string | null; to_agent: string | null; from_dept: string | null; to_dept: string | null; text: string; payload: Record<string, string> | null };
type Office = any; // the engine is plain JS; see src/office/engine.mjs for its API

const who = (e: AgentEvent) => e.from_agent || e.payload?.from_person || null;
const whom = (e: AgentEvent) => e.to_agent || e.payload?.to_person || null;

export default function OfficeClient({ me, role, initial }: { me: string; role: AppRole; initial: AgentEvent[] }) {
  const world = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), labels = useRef<HTMLDivElement>(null);
  const [office, setOffice] = useState<Office>(null);
  const [feed, setFeed] = useState<AgentEvent[]>(initial);
  const [names, setNames] = useState<Record<string, string>>({});
  const [chat, setChat] = useState(true);
  const [demo, setDemo] = useState(initial.length === 0);
  const [error, setError] = useState('');

  // build the campus once
  useEffect(() => {
    let o: Office, stop = false;
    (async () => {
      try {
        const [THREE, { OrbitControls }, { createOffice }, roster] = await Promise.all([
          import('three'), import('three/examples/jsm/controls/OrbitControls.js'), import('@/office/engine.mjs'), import('@/office/roster.mjs')]);
        if (stop) return;
        o = createOffice({ THREE, OrbitControls, canvas: canvas.current!, labels: labels.current!, host: world.current!, roster,
          avoid: () => [...(world.current?.querySelectorAll('.glass') || [])] as HTMLElement[] });
        setNames(Object.fromEntries(roster.PEOPLE.map((p: { id: string; name: string }) => [p.id, p.name])));
        setOffice(o);
      } catch (e) { setError('This browser cannot show the 3D office. The dashboard and approvals still work.'); console.error(e); }
    })();
    const onResize = () => o?.resize();
    addEventListener('resize', onResize);
    return () => { stop = true; removeEventListener('resize', onResize); o?.dispose(); };
  }, []);

  // demo story when nothing has happened yet
  useEffect(() => {
    if (!office || !demo) return;
    let alive = true;
    import('@/office/demo.mjs').then(({ createDemo }) => {
      if (!alive) return;
      const d = createDemo(office, { log: () => {}, stage: () => {}, changed: () => {} });
      d.state.role = me; d.start();
    });
    return () => { alive = false; };
  }, [office, demo, me]);

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
        setDemo(false); setFeed(f => [e as AgentEvent, ...f].slice(0, 120)); play(e as AgentEvent);
      }).subscribe();
    return () => { supabaseBrowser().removeChannel(ch); };
  }, [office]);

  useEffect(() => { office?.setQuest(me, false); }, [office, me]);
  useEffect(() => { setTimeout(() => office?.resize(), 0); }, [chat, office]);

  const cam = (fn: (o: Office) => void) => () => office && fn(office);
  return (
    <section>
      <div className="office" style={chat ? undefined : { gridTemplateColumns: 'minmax(0,1fr)' }}>
        <div className="world" ref={world}>
          {error ? <div className="empty" style={{ margin: '110px 20px' }}>{error}</div> : <canvas ref={canvas} aria-label="3D Parakkat campus with AI staff at work" />}
          <div className="hud">
            <div id="labels" ref={labels} />
            <div className="hud-top">
              {demo && <div className="glass" style={{ padding: '8px 12px', fontSize: 13, marginRight: 'auto' }}>Demo story · no live agent activity yet</div>}
              <div className="glass chips">
                <button type="button" onClick={cam(o => o.flyTo(null))}>Campus</button>
                <button type="button" onClick={cam(o => o.flyTo('ic'))}>Intelligence Centre</button>
                <button type="button" onClick={cam(o => o.flyTo('hq'))}>Marketing HQ</button>
                <button type="button" onClick={cam(o => o.flyTo('ch'))}>Creative House</button>
              </div>
            </div>
            <div className="hud-top" style={{ top: 'auto', bottom: 12 }}>
              <div className="glass chips" role="group" aria-label="Camera">
                <button type="button" aria-label="Turn left" onClick={cam(o => o.turn(20))}>⟲</button>
                <button type="button" aria-label="Turn right" onClick={cam(o => o.turn(-20))}>⟳</button>
                <button type="button" aria-label="Tilt up" onClick={cam(o => o.tilt(-8))}>▲</button>
                <button type="button" aria-label="Tilt down" onClick={cam(o => o.tilt(8))}>▼</button>
                <button type="button" aria-label="Zoom in" onClick={cam(o => o.zoom(.8))}>+</button>
                <button type="button" aria-label="Zoom out" onClick={cam(o => o.zoom(1.25))}>−</button>
                <button type="button" onClick={cam(o => o.setNight(!o.night))}>Day / night</button>
                <button type="button" onClick={() => setChat(c => !c)}>{chat ? 'Hide chat' : 'Show chat'}</button>
                <button type="button" onClick={cam(o => o.fullscreen())}>Full screen</button>
              </div>
            </div>
          </div>
        </div>
        {chat && (
          <aside className="card">
            <h3>Office chatter</h3>
            <p className="note" style={{ margin: '-4px 0 12px' }}>{role === 'super_admin' ? 'You see every department.' : 'Your departments, and conversations other teams have with them.'}</p>
            {feed.length ? (
              <ul className="feed">
                {feed.map(e => (
                  <li key={e.id}><span className="meta">{new Date(e.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}{whom(e) ? ` · to ${names[whom(e)!] || whom(e)}` : ''}</span>
                    <b>{names[who(e) || ''] || who(e) || 'System'}</b> {e.text}</li>
                ))}
              </ul>
            ) : <p className="note">Nothing yet. Start a campaign from the Admin page, or wait for the daily sync.</p>}
          </aside>
        )}
      </div>
      <p className="note">Drag to move around, right-drag or two fingers to turn and tilt, scroll or pinch to zoom. Keys: W A S D or arrows, Q and E to turn, R and F to tilt.</p>
    </section>
  );
}
