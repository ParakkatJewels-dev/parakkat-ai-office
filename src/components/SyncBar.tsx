'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';

type Status = { running: boolean; last: { at: string; results: Record<string, string> } | null };

/**
 * A thin bar under the top bar while a sync runs in the background, on every page. It checks every few seconds,
 * says when the sync is done (and what failed, if anything), and refreshes the page so the new numbers show.
 */
export function SyncBar({ running }: { running: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(running), [secs, setSecs] = useState(0), [doneMsg, setDone] = useState<{ ok: boolean; text: string } | null>(null);
  const was = useRef(running);
  useEffect(() => { if (running) { setOn(true); setDone(null); } }, [running]);
  useEffect(() => {
    if (!on) return;
    const clock = setInterval(() => setSecs(s => s + 1), 1000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch('/api/sync/status', { cache: 'no-store' }); if (!r.ok) return;
        const s: Status = await r.json();
        if (s.running) { was.current = true; return; }
        setOn(false); setSecs(0);
        const res = Object.entries(s.last?.results || {}), bad = res.filter(([, v]) => /^error/.test(v));
        setDone(bad.length ? { ok: false, text: `Sync finished with problems: ${bad.map(([k, v]) => `${k} ${v.replace(/^error: /, '')}`).join('; ').slice(0, 220)}` }
          : { ok: true, text: 'Sync finished. The numbers are up to date.' });
        router.refresh();
      } catch { /* try again on the next tick */ }
    }, 4000);
    return () => { clearInterval(clock); clearInterval(poll); };
  }, [on, router]);
  useEffect(() => { if (!doneMsg?.ok) return; const t = setTimeout(() => setDone(null), 8000); return () => clearTimeout(t); }, [doneMsg]);

  if (on) return (
    <div className="syncbar" role="status" aria-live="polite">
      <span className="spin" aria-hidden="true" />
      <span>Syncing data in the background… {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}. You can keep working.</span>
      <span className="progress indeterminate" aria-hidden="true" />
    </div>
  );
  if (doneMsg) return (
    <div className={`syncbar ${doneMsg.ok ? 'ok' : 'bad'}`} role="status">
      <Icon name="sync" size={16} /><span>{doneMsg.text}</span>
      <button className="btn ghost sm-btn" onClick={() => setDone(null)}>Dismiss</button>
    </div>
  );
  return null;
}
