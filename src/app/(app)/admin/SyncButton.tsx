'use client';
import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/Icon';

/** Stays pressed while the sync runs, with a running clock and a moving bar, so it is clear it is working and not started twice. */
export function SyncButton() {
  const { pending } = useFormStatus();
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!pending) { setSecs(0); return; }
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <span className="sync-wrap">
      <button className={`btn ghost ${pending ? 'busy' : ''}`} disabled={pending} aria-busy={pending}>
        {pending ? <span className="spin" aria-hidden="true" /> : <Icon name="sync" size={18} />}
        <span aria-live="polite">{pending ? `Syncing… ${clock}` : 'Sync data now'}</span>
      </button>
      {pending && <span className="sm sync-hint">Shopify, Meta and Google. This can take up to three minutes.</span>}
      {pending && <span className="progress indeterminate" role="progressbar" aria-label="Syncing" />}
    </span>
  );
}
