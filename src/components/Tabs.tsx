'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Tabs({ admin, waiting }: { admin: boolean; waiting: number }) {
  const path = usePathname();
  const tabs = [['/office', 'Office'], ['/dashboard', 'Dashboard'], ['/approvals', 'Approvals'], ...(admin ? [['/admin', 'Admin']] : [])];
  return (
    <nav className="tabs" aria-label="Views">
      {tabs.map(([href, label]) => (
        <Link key={href} href={href} aria-current={path.startsWith(href) ? 'page' : undefined}>
          {label}{href === '/approvals' && waiting > 0 ? ` (${waiting})` : ''}
        </Link>
      ))}
    </nav>
  );
}
