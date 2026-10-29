'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILDINGS, ROOMS, PEOPLE } from '@/office/roster.mjs';
import { signOut } from '@/app/login/actions';
import { Icon, type IconName } from './Icon';

type Hit = { id: string; label: string; sub: string; href?: string; icon?: IconName };
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

/** Editors can pause a programmatic workspace navigation until the user resolves a draft. */
export function navigateWorkspace(href:string,push:(url:string)=>void) {
  const request=new CustomEvent('workspace:navigate',{detail:{href},cancelable:true});
  if(!window.dispatchEvent(request))return false;
  push(href);return true;
}

export function TopBar({ name, role, waiting, admin = false, seo = false, studio = false }: { name: string; role: string; waiting: number; admin?: boolean; seo?: boolean; studio?: boolean }) {
  const path = usePathname(), router = useRouter(), onOffice = path.startsWith('/office');
  const [q, setQ] = useState(''), [open, setOpen] = useState(false), [cur, setCur] = useState(0), [dark, setDark] = useState(false);
  const box = useRef<HTMLInputElement>(null), profile = useRef<HTMLDetailsElement>(null);
  const pages = useMemo<Hit[]>(() => [
    { id: 'page-dashboard', label: 'Dashboard', sub: 'Business overview', href: '/dashboard', icon: 'chart' },
    { id: 'page-office', label: 'Office map', sub: 'Your team at work', href: '/office', icon: 'map' },
    { id: 'page-agents', label: 'Agent reports', sub: 'People, activity and conversations', href: '/agents', icon: 'users' },
    { id: 'page-approvals', label: 'Approvals', sub: 'Review work waiting for you', href: '/approvals', icon: 'check' },
    { id: 'page-outcomes', label: 'Outcomes', sub: 'Campaign health and follow-through', href: '/outcomes', icon: 'trend' },
    { id: 'page-automations', label: 'Automations', sub: 'Workflows and scheduled tasks', href: '/automations', icon: 'rocket' },
    { id: 'page-management', label: 'Agent management', sub: 'Roles and instructions', href: '/agents/manage', icon: 'edit' },
    ...(studio ? [{ id: 'page-studio', label: 'Design studio', sub: 'Create and review artwork', href: '/studio', icon: 'spark' as const }] : []),
    ...(seo ? [{ id: 'page-seo', label: 'SEO', sub: 'Search performance', href: '/seo', icon: 'search' as const }] : []),
    ...(admin ? [
      { id: 'page-usage', label: 'Usage and billing', sub: 'Usage limits and costs', href: '/usage', icon: 'rupee' as const },
      { id: 'page-admin', label: 'Settings', sub: 'Connections and office controls', href: '/admin', icon: 'settings' as const },
    ] : []),
  ], [admin, seo, studio]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? [...pages, ...PLACES].filter(h => h.label.toLowerCase().includes(s) || h.sub.toLowerCase().includes(s)).slice(0, 8) : pages.slice(0, 6);
  }, [q, pages]);

  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === 'dark');
    sync();
    const storage = (e: StorageEvent) => {
      if (e.key !== 'pk-theme') return;
      const next = e.newValue === 'dark';
      document.documentElement.dataset.theme = next ? 'dark' : 'light';
      setDark(next);
      window.dispatchEvent(new CustomEvent('office:theme', { detail: next }));
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, []);
  useEffect(() => {
    const focus = () => { box.current?.focus(); setOpen(true); };
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.isComposing) { e.preventDefault(); focus(); }
    };
    window.addEventListener('office:find', focus);
    window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('office:find', focus); window.removeEventListener('keydown', shortcut); };
  }, []);
  useEffect(() => { setOpen(false); if (profile.current) profile.current.open = false; }, [path]);

  const pick = (h: Hit) => {
    const push=(href:string)=>navigateWorkspace(href,router.push);
    if (h.href) push(h.href); else focusOffice(h.id, onOffice, push);
    setQ(''); setOpen(false); setCur(0); box.current?.blur();
  };
  const theme = () => {
    const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('pk-theme', next ? 'dark' : 'light'); } catch {}
    window.dispatchEvent(new CustomEvent('office:theme', { detail: next }));
  };

  return (
    <header className="topbar">
      <button type="button" className="iconbtn mobile-menu-trigger" aria-label="Open workspace navigation" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event('workspace:navigation'))}><Icon name="menu" /></button>
      <Link href="/dashboard" className="wordmark mobile-wordmark" aria-label="Parakkat AI Office dashboard"><b>PARAKKAT</b><small>AI OFFICE</small></Link>
      <div className="search" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
        <Icon name="search" size={19} />
        <input ref={box} value={q} placeholder="Search your workspace…" aria-label="Search pages, people, or departments" role="combobox" aria-expanded={open} aria-controls="search-hits" aria-autocomplete="list" aria-activedescendant={open && hits[cur] ? `search-${hits[cur].id}` : undefined} autoComplete="off"
          onChange={e => { setQ(e.target.value); setOpen(true); setCur(0); }} onFocus={() => { setOpen(true); setCur(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { setOpen(true); setCur(c => Math.max(0, Math.min(hits.length - 1, c + 1))); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { setCur(c => Math.max(0, c - 1)); e.preventDefault(); }
            else if (e.key === 'Enter' && open && hits[cur]) { e.preventDefault(); pick(hits[cur]); }
            else if (e.key === 'Escape') { setOpen(false); setQ(''); box.current?.blur(); }
          }} />
        <kbd className="search-shortcut" aria-hidden="true">⌘ K</kbd>
        {open && <div className="search-results">
          <p className="search-caption">{q.trim() ? 'Search results' : 'Quick navigation'}</p>
          <ul id="search-hits" role="listbox" aria-label="Workspace search results" className="hits">
            {hits.map((h, i) => <li id={`search-${h.id}`} key={h.id} role="option" aria-selected={i === cur} onMouseDown={e => { e.preventDefault(); pick(h); }} onMouseEnter={() => setCur(i)}>
              <span className="search-hit-icon"><Icon name={h.icon || 'findUser'} size={18} /></span><span><b>{h.label}</b><small>{h.sub}</small></span><Icon name="arrow" size={15} />
            </li>)}
          </ul>
          {!hits.length && <p className="search-empty" role="status">No matches. Try an agent name, department, or page.</p>}
        </div>}
      </div>
      <div className="top-actions">
        <button type="button" className="iconbtn theme-toggle" onClick={theme} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}><Icon name={dark ? 'sun' : 'moon'} /></button>
        <Link href="/approvals" className="iconbtn" aria-label={waiting ? `${waiting} approvals waiting for you` : 'View approvals'} title="Approvals"><Icon name="bell" />{waiting > 0 && <i className="dot" />}</Link>
        <details className="me" ref={profile}>
          <summary aria-label={`Account: ${name}, ${role}`}><span className="avatar">{name.trim()[0]?.toUpperCase() || 'P'}</span><span className="who"><b>{name}</b><small>{role}</small></span><Icon name="down" size={16} /></summary>
          <div className="menu"><div className="profile-info"><b>{name}</b><small>{role}</small></div><form action={signOut}><button type="submit"><Icon name="logout" size={18} />Sign out</button></form></div>
        </details>
      </div>
    </header>
  );
}
