'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icon, type IconName } from './Icon';

type NavItem = [href: string, label: string, icon: IconName, visible: boolean];

export function Sidebar({ admin, waiting, seo, studio }: { admin: boolean; waiting: number; seo: boolean; studio: boolean }) {
  const path = usePathname(), dialog = useRef<HTMLDialogElement>(null);
  const groups: { label: string; items: NavItem[] }[] = [
    { label: 'Workspace', items: [['/dashboard', 'Dashboard', 'chart', true], ['/office', 'Office map', 'map', true], ['/agents', 'Agent reports', 'users', true]] },
    { label: 'Work', items: [['/approvals', 'Approvals', 'check', true], ['/outcomes', 'Outcomes', 'trend', true], ['/automations', 'Automations', 'rocket', true], ['/studio', 'Design studio', 'spark', studio], ['/seo', 'SEO', 'search', seo]] },
    { label: 'Manage', items: [['/agents/manage', 'Agent management', 'edit', true], ['/usage', 'Usage & billing', 'rupee', admin], ['/admin', 'Settings', 'settings', admin]] },
  ];
  const active = groups.flatMap(g => g.items).filter(([href, , , visible]) => visible && (path === href || path.startsWith(`${href}/`))).sort((a, b) => b[0].length - a[0].length)[0]?.[0];
  useEffect(() => {
    const open = () => { if (!dialog.current?.open) dialog.current?.showModal(); };
    window.addEventListener('workspace:navigation', open);
    return () => window.removeEventListener('workspace:navigation', open);
  }, []);
  useEffect(() => { dialog.current?.close(); }, [path]);
  const brand = <Link href="/dashboard" className="sidebar-brand" aria-label="Parakkat AI Office dashboard" onClick={() => dialog.current?.close()}><span className="brand-emblem"><Icon name="diamond" size={23} /></span><span><b>PARAKKAT</b><small>AI OFFICE</small></span></Link>;
  const links = groups.map(group => <div className="nav-group" key={group.label}><p className="nav-group-label">{group.label}</p>{group.items.filter(item => item[3]).map(([href, label, icon]) => <Link key={href} href={href} className="nav" aria-current={active === href ? 'page' : undefined} title={label} onClick={() => dialog.current?.close()}><Icon name={icon} size={19} /><span>{label}</span>{href === '/approvals' && waiting > 0 && <b className="count">{waiting}</b>}</Link>)}</div>);
  return <>
    <aside className="side">{brand}<nav className="nav-groups" aria-label="Workspace navigation">{links}</nav></aside>
    <dialog className="mobile-navigation" ref={dialog} aria-labelledby="mobile-nav-title" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <div className="mobile-nav-inner"><div className="mobile-nav-head"><h2 id="mobile-nav-title" className="sr-only">Workspace navigation</h2>{brand}<button type="button" className="iconbtn" aria-label="Close navigation" onClick={() => dialog.current?.close()}><Icon name="x" /></button></div><nav className="nav-groups" aria-label="Mobile workspace navigation">{links}</nav></div>
    </dialog>
  </>;
}
