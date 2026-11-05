'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { floorMapShapes, OFFICE_ROOMS } from '@/office/floorplan.mjs';

type Office = any; // the engine is plain JS; see src/office/engine.mjs for its API
export type Area = { id: string; name: string; no?: number } | null;
export type Mode = 'overview' | 'walk' | 'hq';
export type Prompt = { kind: string; text: string; target?: string } | null;

const MAP = floorMapShapes();
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** The floor plan in the corner: lights up wherever you are, shows who is working, and takes you to any room. */
export function FloorMap({ office, mode, area, onChoose }: { office: Office; mode: Mode; area: Area; onChoose: (id: string) => void }) {
  const me = useRef<HTMLDivElement>(null);
  const [dots, setDots] = useState<{ id: string; x: number; y: number; waiting: boolean }[]>([]);
  useEffect(() => {
    if (!office) return;
    const tick = () => setDots(office.positions().filter((p: { working: boolean; waiting: boolean }) => p.working || p.waiting).map((p: { id: string; x: number; z: number; waiting: boolean }) => { const at = MAP.project(p.x, p.z); return { id: p.id, x: at.x, y: at.y, waiting: p.waiting }; }));
    tick(); const t = setInterval(tick, 1500); return () => clearInterval(t);
  }, [office]);
  useEffect(() => {
    if (!office || mode !== 'walk') return;
    let raf = 0;
    const move = () => { raf = requestAnimationFrame(move); const el = me.current; if (!el) return; const p = office.player(), at = MAP.project(p.x, p.z); el.style.left = pct(Math.max(1, Math.min(MAP.width - 1, at.x)), MAP.width); el.style.top = pct(Math.max(1, Math.min(MAP.height - 1, at.y)), MAP.height); el.style.transform = `rotate(${-p.yaw + Math.PI}rad)`; };
    move(); return () => cancelAnimationFrame(raf);
  }, [office, mode]);
  const room = area?.no ? `Room ${String(area.no).padStart(2, '0')} / ${OFFICE_ROOMS.length}` : '';
  const shape = (r: { id: string; name: string; no?: number; x: number; y: number; w: number; h: number }, kind: string) => (
    <button type="button" key={r.id} className={kind} data-active={area?.id === r.id} title={r.name} aria-label={`${mode === 'walk' ? 'Go to' : 'Show'} ${r.name}`} onClick={() => onChoose(r.id)}
      style={{ left: pct(r.x, MAP.width), top: pct(r.y, MAP.height), width: pct(r.w, MAP.width), height: pct(r.h, MAP.height) }} />
  );
  return (
    <nav className="floor-map hud-panel float" aria-label="Floor plan">
      <div className="floor-map-head"><b>{area?.name || 'Floor plan'}</b><span>{room || `${OFFICE_ROOMS.length} rooms`}</span></div>
      <div className="floor-map-plan" style={{ aspectRatio: `${MAP.width} / ${MAP.height}` }}>
        {MAP.areas.map(a => shape(a, `area${a.id === 'hallway' ? ' hall' : ''}`))}
        {MAP.rooms.filter(r => r.id !== 'restrooms').map(r => shape(r, ''))}
        {MAP.rooms.filter(r => r.id === 'restrooms').map(r => shape(r, ''))}
        {dots.map(d => <i key={d.id} className="floor-map-dot" data-waiting={d.waiting} style={{ left: pct(d.x, MAP.width), top: pct(d.y, MAP.height) }} />)}
        {mode === 'walk' && <div className="floor-map-me" ref={me} aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 0l5 12-5-3-5 3z" fill="#ffd338" stroke="#141210" /></svg></div>}
      </div>
    </nav>
  );
}

/** "Room 03 / 10", shown for a moment when you walk in. */
export function RoomBanner({ area }: { area: Area }) {
  if (!area?.no) return null;
  return <div className="room-banner float" key={area.id} role="status"><small>ROOM {String(area.no).padStart(2, '0')} / {OFFICE_ROOMS.length}</small><b>{area.name}</b></div>;
}

const KEYS: [string[], string][] = [[['W', 'A', 'S', 'D'], 'walk'], [['Shift'], 'run'], [['Space'], 'jump'], [['E'], 'interact'], [['V'], '1st / 3rd person'], [['Esc'], 'menu']];
/** The keys, always in view along the bottom while you walk. */
export function WalkKeys() {
  return <div className="walk-keys float" aria-label="Walking controls">{KEYS.map(([keys, label]) => <span key={label}>{keys.map(k => <kbd key={k}>{k}</kbd>)} {label}</span>)}<span className="walk-keys-more">click for mouse look · drag also works</span></div>;
}
export function WalkPrompt({ prompt }: { prompt: Prompt }) {
  if (!prompt) return null;
  return <div className="walk-prompt float" role="status"><kbd>E</kbd><span>{prompt.text}</span></div>;
}

/** Thumb controls for phones and tablets. */
export function TouchControls({ office, prompt }: { office: Office; prompt: Prompt }) {
  const knob = useRef<HTMLElement>(null), origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const release = () => { origin.current = null; office?.setTouchMove(0, 0); if (knob.current) knob.current.style.transform = ''; };
  return <>
    <div className="touch-stick float" aria-hidden="true"
      onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { const o = origin.current; if (!o || o.id !== e.pointerId) return; const dx = Math.max(-46, Math.min(46, e.clientX - o.x)), dy = Math.max(-46, Math.min(46, e.clientY - o.y)); office?.setTouchMove(-dy / 46, dx / 46); if (knob.current) knob.current.style.transform = `translate(${dx}px,${dy}px)`; }}
      onPointerUp={release} onPointerCancel={release}><i ref={knob} /></div>
    <button type="button" className="touch-e float" aria-label={prompt ? `Press E ${prompt.text}` : 'Nothing to interact with here'} disabled={!prompt} onClick={() => office?.interact()}>E</button>
  </>;
}

/** Esc while walking. */
export function EscMenu({ onResume, onOverview, onHq, onFind, onNav, thirdPerson, onToggleView }: { onResume: () => void; onOverview: () => void; onHq: () => void; onFind: () => void; onNav: () => void; thirdPerson: boolean; onToggleView: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return (
    <div className="esc-menu" role="dialog" aria-modal="true" aria-label="Menu" onClick={e => { if (e.target === e.currentTarget) onResume(); }}>
      <div className="esc-menu-box hud-panel">
        <h2>Menu</h2>
        <div className="esc-menu-actions">
          <button type="button" ref={first} className="primary" onClick={onResume}>Keep walking</button>
          <button type="button" onClick={onFind}>Find a colleague</button>
          <button type="button" onClick={onToggleView}>Switch to {thirdPerson ? 'first' : 'third'} person</button>
          <button type="button" onClick={onHq}>Agent HQ</button>
          <button type="button" onClick={onOverview}>Leave and see from above</button>
          <button type="button" onClick={onNav}>Open the workspace menu</button>
        </div>
        <dl className="esc-menu-keys">{KEYS.map(([keys, label]) => <div key={label} style={{ display: 'contents' }}><dt>{keys.map(k => <kbd key={k}>{k}</kbd>)}</dt><dd>{label}</dd></div>)}</dl>
      </div>
    </div>
  );
}

type Findable = { id: string; label: string; sub: string };
/** Find a person or a team, and go to them. */
export function FindPanel({ items, onChoose, onClose }: { items: Findable[]; onChoose: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? items.filter(i => `${i.label} ${i.sub}`.toLowerCase().includes(t)) : items).slice(0, 40); }, [q, items]);
  return (
    <div className="find-panel hud-panel float" role="search" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a colleague or team" aria-label="Find a colleague or team" />
      <ul>{shown.map(i => <li key={i.id}><button type="button" onClick={() => onChoose(i.id)}><span>{i.label}</span><small>{i.sub}</small></button></li>)}{!shown.length && <li style={{ padding: 9, color: '#a39c8e', fontSize: 13 }}>Nobody by that name.</li>}</ul>
    </div>
  );
}
