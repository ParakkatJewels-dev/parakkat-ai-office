'use client';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/Icon';

/** Stays pressed while the sync runs, so it is not started twice. */
export function SyncButton() {
  const { pending } = useFormStatus();
  return <button className="btn ghost" disabled={pending} aria-live="polite"><Icon name={pending ? 'clock' : 'sync'} size={18} />{pending ? 'Syncing… up to a few minutes' : 'Sync data now'}</button>;
}
