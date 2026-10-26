'use client';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/Icon';

/** Starts a sync; the sync itself runs in the background and the bar at the top of every page follows it. */
export function SyncButton() {
  const { pending } = useFormStatus();
  return (
    <button className={`btn ghost ${pending ? 'busy' : ''}`} disabled={pending} aria-busy={pending}>
      {pending ? <span className="spin" aria-hidden="true" /> : <Icon name="sync" size={18} />}
      <span aria-live="polite">{pending ? 'Starting sync…' : 'Sync data now'}</span>
    </button>
  );
}
