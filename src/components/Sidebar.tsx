'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './Icon';

export function Sidebar({ admin, waiting, seo, studio }: { admin: boolean; waiting: number; seo: boolean; studio: boolean }) {
  const path = usePathname();
  const items = ([
    ['/office', 'Office Map', 'map', true], ['/dashboard', 'Dashboard', 'chart', true], ['/approvals', 'Approvals', 'check', true], ['/agents', 'Agents', 'users', true],
    ['/seo', 'SEO', 'search', seo], ['/studio', 'Design Studio', 'spark', studio], ['/admin', 'Admin', 'settings', admin],
  ] as [string, string, IconName, boolean][]).filter(i => i[3]);
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
