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
  // AI staff open their own page; people are found on the office floor.
  ...PEOPLE.map(p => ({ id: p.id, label: p.name, sub: `${p.human ? 'Person' : 'AI staff'} · ${ROOMS.find(r => r.id === p.room)?.name}`, ...(p.human ? {} : { href: `/agents/${encodeURIComponent(p.id)}`, icon: 'users' as const }) })),
];

/** One thing waiting on the signed-in person, as the bell lists it. */
export type Need = { id: string; href: string; kind: 'plan' | 'report' | 'design' | 'video'; title: string; sub: string };
const KIND_LABEL = { plan: 'PL', report: 'RE', design: 'DE', video: 'VI' } as const;

/** Opens the shared New task panel, optionally with words already typed. */
export function askTeam(message = '') {
  window.dispatchEvent(new CustomEvent('workspace:new-task', { detail: { message } }));
}

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

export function TopBar({ name, role, waiting, needs = [], admin = false, seo = false, studio = false, video = false }: { name: string; role: string; waiting: number; needs?: Need[]; admin?: boolean; seo?: boolean; studio?: boolean; video?: boolean }) {
  const path = usePathname(), router = useRouter(), onOffice = path.startsWith('/office');
  const [q, setQ] = useState(''), [open, setOpen] = useState(false), [cur, setCur] = useState(0), [dark, setDark] = useState(false);
  const box = useRef<HTMLInputElement>(null), profile = useRef<HTMLDetailsElement>(null), bell = useRef<HTMLDetailsElement>(null);
  const pages = useMemo<Hit[]>(() => [
    { id: 'page-home', label: 'Home', sub: 'What needs you and how the business is doing', href: '/dashboard', icon: 'home' },
    { id: 'page-inbox', label: 'Inbox', sub: 'Reports and plans waiting for your decision', href: '/approvals', icon: 'inbox' },
    { id: 'page-tasks', label: 'Tasks', sub: 'Everything you asked the team for', href: '/tasks', icon: 'tasks' },
    { id: 'page-office', label: 'Office', sub: 'Walk the floor and see who is working', href: '/office', icon: 'cube' },
    ...(studio ? [{ id: 'page-studio', label: 'Studio', sub: 'Make and review artwork', href: '/studio', icon: 'spark' as const }] : []),
    ...(video ? [{ id: 'page-video', label: 'Video', sub: 'Send footage for editing', href: '/video', icon: 'film' as const }] : []),
    { id: 'page-campaigns', label: 'Campaigns', sub: 'Start campaigns, runs and schedules', href: '/campaigns', icon: 'rocket' },
    { id: 'page-customers', label: 'Customer inbox', sub: 'Customer questions and reply drafts', href: '/customers', icon: 'chat' },
    { id: 'page-results', label: 'Results', sub: 'Did the work pay off?', href: '/outcomes', icon: 'trend' },
    ...(seo ? [{ id: 'page-seo', label: 'SEO', sub: 'Search rankings and keywords', href: '/seo', icon: 'search' as const }] : []),
    { id: 'page-agents', label: 'Agents', sub: 'Your AI team, their work and instructions', href: '/agents', icon: 'users' },
    ...(admin ? [
      { id: 'page-usage', label: 'Usage & billing', sub: 'Budget, limits and costs', href: '/usage', icon: 'rupee' as const },
      { id: 'page-admin', label: 'Settings', sub: 'People, brand, AI and connections', href: '/admin', icon: 'settings' as const },
    ] : []),
  ], [admin, seo, studio, video]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pages.slice(0, 6);
    // Whatever was typed can always go to the team as a task: that choice comes last.
    const found = [...pages, ...PLACES].filter(h => h.label.toLowerCase().includes(s) || h.sub.toLowerCase().includes(s)).slice(0, 7);
    return [...found, { id: 'ask-team', label: `Ask the team: “${q.trim().slice(0, 60)}”`, sub: 'Opens New task with these words', icon: 'send' as const }];
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
  useEffect(() => { setOpen(false); if (profile.current) profile.current.open = false; if (bell.current) bell.current.open = false; }, [path]);
  useEffect(() => {
    // The bell and account menus close on a click elsewhere or Escape, like any other menu.
    const close = (e: Event) => { for (const menu of [bell.current, profile.current]) if (menu?.open && !(e instanceof KeyboardEvent ? e.key !== 'Escape' : menu.contains(e.target as Node))) menu.open = false; };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);

  const pick = (h: Hit) => {
    const push=(href:string)=>navigateWorkspace(href,router.push);
    if (h.id === 'ask-team') askTeam(q.trim()); else if (h.href) push(h.href); else focusOffice(h.id, onOffice, push);
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
      <Link href="/dashboard" className="wordmark mobile-wordmark" aria-label="Parakkat AI Office home"><b>Parakkat</b><small>AI Office</small></Link>
      <div className="search" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
        <Icon name="search" size={19} />
        <input ref={box} value={q} placeholder="Search pages, agents, teams…" aria-label="Search pages, agents, people or departments" role="combobox" aria-expanded={open} aria-controls="search-hits" aria-autocomplete="list" aria-activedescendant={open && hits[cur] ? `search-${hits[cur].id}` : undefined} autoComplete="off"
          onChange={e => { setQ(e.target.value); setOpen(true); setCur(0); }} onFocus={() => { setOpen(true); setCur(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { setOpen(true); setCur(c => Math.max(0, Math.min(hits.length - 1, c + 1))); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { setCur(c => Math.max(0, c - 1)); e.preventDefault(); }
            else if (e.key === 'Enter' && open && hits[cur]) { e.preventDefault(); pick(hits[cur]); }
            else if (e.key === 'Escape') { setOpen(false); setQ(''); box.current?.blur(); }
          }} />
        <kbd className="search-shortcut" aria-hidden="true">⌘ K</kbd>
        {open && <div className="search-results">
          <p className="search-caption">{q.trim() ? 'Results' : 'Go to'}</p>
          <ul id="search-hits" role="listbox" aria-label="Workspace search results" className="hits">
            {hits.map((h, i) => <li id={`search-${h.id}`} key={h.id} role="option" aria-selected={i === cur} onMouseDown={e => { e.preventDefault(); pick(h); }} onMouseEnter={() => setCur(i)}>
              <span className="search-hit-icon"><Icon name={h.icon || 'findUser'} size={18} /></span><span><b>{h.label}</b><small>{h.sub}</small></span><Icon name="arrow" size={15} />
            </li>)}
          </ul>
          {!hits.length && <p className="search-empty" role="status">No matches. Try an agent name, a team or a page.</p>}
        </div>}
      </div>
      <div className="top-actions">
        <button type="button" className="top-create" aria-haspopup="dialog" onClick={() => askTeam()}><Icon name="plus" size={17}/><span>New task</span></button>
        <button type="button" className="iconbtn theme-toggle" onClick={theme} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}><Icon name={dark ? 'sun' : 'moon'} /></button>
        <details className="needs" ref={bell}>
          <summary aria-label={waiting ? `${waiting} things need you` : 'Nothing needs you'} title="Needs you"><Icon name="bell" />{waiting > 0 && <b className="needs-count">{waiting > 99 ? '99+' : waiting}</b>}</summary>
          <div className="needs-panel">
            <h2>{waiting ? `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} you` : 'Nothing needs you'}</h2>
            {needs.length ? <ul>{needs.map(n => <li key={n.id}><Link href={n.href}><span className={`kind ${n.kind}`} aria-hidden="true">{KIND_LABEL[n.kind]}</span><span><b>{n.title}</b><small>{n.sub}</small></span></Link></li>)}
              <li><Link className="all" href="/approvals">Open the Inbox<Icon name="arrow" size={15} /></Link></li></ul>
              : <p>{waiting ? 'Open the Inbox to see them.' : 'When the team sends you a report or plan, it appears here.'}</p>}
            {!needs.length && waiting > 0 && <ul><li><Link className="all" href="/approvals">Open the Inbox<Icon name="arrow" size={15} /></Link></li></ul>}
          </div>
        </details>
        <details className="me" ref={profile}>
          <summary aria-label={`Account: ${name}, ${role}`}><span className="avatar">{name.trim()[0]?.toUpperCase() || 'P'}</span><span className="who"><b>{name}</b><small>{role}</small></span><Icon name="down" size={16} /></summary>
          <div className="menu"><div className="profile-info"><b>{name}</b><small>{role}</small></div><form action={signOut}><button type="submit"><Icon name="logout" size={18} />Sign out</button></form></div>
        </details>
      </div>
    </header>
  );
}
