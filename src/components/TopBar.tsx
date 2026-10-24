'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILDINGS, ROOMS, PEOPLE } from '@/office/roster.mjs';
import { signOut } from '@/app/login/actions';
import { Icon } from './Icon';

type Hit = { id: string; label: string; sub: string };
const PLACES: Hit[] = [
  ...BUILDINGS.map(b => ({ id: b.id, label: b.name, sub: 'Building' })),
  ...ROOMS.map(r => ({ id: r.id, label: r.name, sub: `Department · ${BUILDINGS.find(b => b.id === r.building)?.short}` })),
  ...PEOPLE.map(p => ({ id: p.id, label: p.name, sub: `${p.human ? 'Person' : 'AI staff'} · ${ROOMS.find(r => r.id === p.room)?.name}` })),
];

/** Sends the office to a building, department or person; from another page it opens the office first. */
export function focusOffice(id: string, onOffice: boolean, push: (u: string) => void) {
  if (onOffice) window.dispatchEvent(new CustomEvent('office:focus', { detail: id }));
  else push(`/office?focus=${encodeURIComponent(id)}`);
}

export function TopBar({ name, role, waiting }: { name: string; role: string; waiting: number }) {
  const path = usePathname(), router = useRouter(), onOffice = path.startsWith('/office');
  const [q, setQ] = useState(''), [open, setOpen] = useState(false), [cur, setCur] = useState(0), [dark, setDark] = useState(true);
  const box = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => { const s = q.trim().toLowerCase(); return s ? PLACES.filter(h => h.label.toLowerCase().includes(s) || h.sub.toLowerCase().includes(s)).slice(0, 8) : []; }, [q]);

  useEffect(() => { setDark(document.documentElement.dataset.theme !== 'light'); }, []);
  // "Find a colleague" on the office page focuses this box
  useEffect(() => { const f = () => box.current?.focus(); window.addEventListener('office:find', f); return () => window.removeEventListener('office:find', f); }, []);

  const pick = (h: Hit) => { focusOffice(h.id, onOffice, router.push); setQ(''); setOpen(false); box.current?.blur(); };
  const theme = () => {
    const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('pk-theme', next ? 'dark' : 'light'); } catch {}
    window.dispatchEvent(new CustomEvent('office:theme', { detail: next }));
  };

  return (
    <header className="topbar">
      <Link href="/office" className="wordmark" aria-label="Parakkat office map"><b>PARAKKAT</b><small>JEWELS | MARKETING HQ</small></Link>
      <div className="search" role="combobox" aria-expanded={open && hits.length > 0} aria-haspopup="listbox" aria-owns="search-hits">
        <Icon name="search" size={18} />
        <input ref={box} value={q} placeholder="Search rooms, people, or departments…" aria-label="Search rooms, people, or departments"
          onChange={e => { setQ(e.target.value); setOpen(true); setCur(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { setCur(c => Math.min(hits.length - 1, c + 1)); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { setCur(c => Math.max(0, c - 1)); e.preventDefault(); }
            else if (e.key === 'Enter' && hits[cur]) pick(hits[cur]);
            else if (e.key === 'Escape') { setQ(''); box.current?.blur(); }
          }} />
        {open && hits.length > 0 && (
          <ul id="search-hits" role="listbox" className="hits">
            {hits.map((h, i) => (
              <li key={h.id} role="option" aria-selected={i === cur} onMouseDown={e => { e.preventDefault(); pick(h); }} onMouseEnter={() => setCur(i)}>
                <b>{h.label}</b><small>{h.sub}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="top-actions">
        <button type="button" className="iconbtn" onClick={theme} aria-label={dark ? 'Switch to day' : 'Switch to evening'} title={dark ? 'Day' : 'Evening'}><Icon name={dark ? 'sun' : 'moon'} /></button>
        <Link href="/approvals" className="iconbtn" aria-label={waiting ? `${waiting} waiting for you` : 'Approvals'}><Icon name="bell" />{waiting > 0 && <i className="dot" />}</Link>
        <details className="me">
          <summary><span className="avatar">{name.trim()[0]?.toUpperCase() || 'P'}</span><span className="who"><b>{name}</b><small>{role}</small></span><Icon name="down" size={18} /></summary>
          <form action={signOut} className="menu"><button type="submit"><Icon name="logout" size={18} />Sign out</button></form>
        </details>
      </div>
    </header>
  );
}
