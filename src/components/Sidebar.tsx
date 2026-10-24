'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './Icon';

export function Sidebar({ admin, waiting }: { admin: boolean; waiting: number }) {
  const path = usePathname();
  const items: [string, string, IconName][] = [['/office', 'Office Map', 'map'], ['/dashboard', 'Dashboard', 'chart'], ['/approvals', 'Approvals', 'check'], ...(admin ? [['/admin', 'Admin', 'settings'] as [string, string, IconName]] : [])];
  return (
    <nav className="side" aria-label="Views">
      {items.map(([href, label, icon]) => (
        <Link key={href} href={href} className="nav" aria-current={path.startsWith(href) ? 'page' : undefined}>
          <Icon name={icon} /><span>{label}</span>
          {href === '/approvals' && waiting > 0 && <b className="count">{waiting}</b>}
        </Link>
      ))}
      <div className="loc">
        <Icon name="pin" />
        <div><b>Parakkat HQ</b><small>Alappuzha, Kerala</small></div>
      </div>
    </nav>
  );
}
