'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Keep the office's canvas, overlays and shared controls on their original styles. */
export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isOffice = pathname === '/office' || pathname.startsWith('/office/');
  return <div className={isOffice ? 'shell' : 'shell workspace'}>{children}</div>;
}
