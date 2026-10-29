'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Keep a background review visible without asking the manager to reload the page. */
export function OpportunityRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') router.refresh(); };
    const timer = setInterval(refresh, active ? 10_000 : 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [router, active]);
  return null;
}
