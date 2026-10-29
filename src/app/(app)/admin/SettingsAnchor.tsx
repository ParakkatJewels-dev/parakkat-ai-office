'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Keep saved office quick links working after settings are split into focused sections. */
export function SettingsAnchor() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    if (params.has('tab') && !(params.get('tab') === 'connections' && ['#chatgpt', '#gemini'].includes(hash))) return;
    const tab = hash === '#campaign' || hash === '#opportunities' ? 'operations' : hash === '#sync' ? 'connections' : ['#chatgpt', '#gemini'].includes(hash) ? 'ai' : null;
    if (!tab) return;
    params.set('tab', tab);
    router.replace(`/admin?${params.toString()}${hash}`);
  }, [router]);
  return null;
}
