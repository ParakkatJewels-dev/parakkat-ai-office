'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';

/** While work runs in the background, a quiet note that says so, and the page refreshes itself until it is done. */
export function Refresher({ active, every = 8000, children }: { active: boolean; every?: number; children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, every);
    return () => clearInterval(t);
  }, [active, every, router]);
  if (!active) return null;
  return <p className="flash working" role="status"><span className="spin" aria-hidden="true" /><span>{children}</span><Icon name="sync" size={15} /></p>;
}
