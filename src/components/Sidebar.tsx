'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icon, type IconName } from './Icon';

type NavItem = [href: string, label: string, icon: IconName, visible: boolean];

/** The sidebar is grouped by job: the daily loop first, then making things, results, and the team. */
export function Sidebar({ admin, waiting, seo, studio, video }: { admin: boolean; waiting: number; seo: boolean; studio: boolean; video: boolean }) {
  const path = usePathname(), dialog = useRef<HTMLDialogElement>(null);
  const groups: { label: string; items: NavItem[] }[] = [
    { label: 'Daily', items: [['/dashboard', 'Home', 'home', true], ['/approvals', 'Inbox', 'inbox', true], ['/tasks', 'Tasks', 'tasks', true], ['/office', 'Office', 'cube', true]] },
    { label: 'Create', items: [['/studio', 'Studio', 'spark', studio], ['/video', 'Video', 'film', video], ['/campaigns', 'Campaigns', 'rocket', true], ['/customers', 'Customer inbox', 'chat', true]] },
    { label: 'Results', items: [['/outcomes', 'Results', 'trend', true], ['/seo', 'SEO', 'search', seo]] },
    { label: 'Team', items: [['/agents', 'Agents', 'users', true], ['/usage', 'Usage & billing', 'rupee', admin], ['/admin', 'Settings', 'settings', admin]] },
  ];
  const active = groups.flatMap(g => g.items).filter(([href, , , visible]) => visible && (path === href || path.startsWith(`${href}/`))).sort((a, b) => b[0].length - a[0].length)[0]?.[0];
  useEffect(() => {
    const open = () => { if (!dialog.current?.open) dialog.current?.showModal(); };
    window.addEventListener('workspace:navigation', open);
    return () => window.removeEventListener('workspace:navigation', open);
  }, []);
  useEffect(() => { dialog.current?.close(); }, [path]);
  const count = waiting > 0 && <b className="count" aria-label={`${waiting} waiting`}>{waiting > 99 ? '99+' : waiting}</b>;
  const brand = <Link href="/dashboard" className="sidebar-brand" aria-label="Parakkat AI Office home" onClick={() => dialog.current?.close()}><span className="brand-emblem"><Icon name="diamond" size={20} /></span><span><b>Parakkat</b><small>AI Office</small></span></Link>;
  const links = groups.map(group => <div className="nav-group" key={group.label}><p className="nav-group-label">{group.label}</p>{group.items.filter(item => item[3]).map(([href, label, icon]) => <Link key={href} href={href} className="nav" aria-current={active === href ? 'page' : undefined} title={label} onClick={() => dialog.current?.close()}><Icon name={icon} size={19} /><span>{label}</span>{href === '/approvals' && count}</Link>)}</div>);
  // On a phone the four daily places sit in a bar at the bottom; More opens everything else.
  const tabs: NavItem[] = groups[0].items;
  return <>
    <aside className="side">{brand}<nav className="nav-groups" aria-label="Workspace navigation">{links}</nav></aside>
    <nav className="tabbar" aria-label="Main">
      {tabs.map(([href, label, icon]) => <Link key={href} href={href} aria-current={active === href ? 'page' : undefined}><span className="tabbar-ic"><Icon name={icon} size={20} />{href === '/approvals' && count}</span>{label}</Link>)}
      <button type="button" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}><span className="tabbar-ic"><Icon name="menu" size={20} /></span>More</button>
    </nav>
    <dialog className="mobile-navigation" ref={dialog} aria-labelledby="mobile-nav-title" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <div className="mobile-nav-inner"><div className="mobile-nav-head"><h2 id="mobile-nav-title" className="sr-only">Workspace navigation</h2>{brand}<button type="button" className="iconbtn" aria-label="Close navigation" onClick={() => dialog.current?.close()}><Icon name="x" /></button></div><nav className="nav-groups" aria-label="Mobile workspace navigation">{links}</nav></div>
    </dialog>
  </>;
}
