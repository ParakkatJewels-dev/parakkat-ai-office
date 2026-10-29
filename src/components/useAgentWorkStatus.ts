'use client';

import { useEffect, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { localWorkSnapshot } from '@/office/work-status-feed.mjs';

type Snapshot = ReturnType<typeof localWorkSnapshot>;
type Availability = 'loading' | 'ready' | 'unavailable';

/** One lightweight poll per page; no model calls or historical-event inference. */
export function useAgentWorkStatus(observedAt: string) {
  const [now, setNow] = useState(() => Date.parse(observedAt));
  const [feed, setFeed] = useState<{statuses:Snapshot;checkedAt:number;availability:Availability}>({statuses:{},checkedAt:0,availability:'loading'});
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>, busy = false, repeat = false, epoch = 0;
    const visible = () => document.visibilityState !== 'hidden';
    const clear = (availability:Availability) => setFeed({statuses:{},checkedAt:0,availability});
    const update = async () => {
      clearTimeout(timer);
      if (busy) { repeat = true; return; }
      if (controller.signal.aborted || !visible()) return;
      busy = true;
      const version = epoch, sentAt = performance.now();
      try {
        const response = await fetch('/api/agents/work-status', {cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(7000)])});
        const data = response.ok ? await response.json() : null;
        if (controller.signal.aborted || version !== epoch || !visible()) return;
        if (!data || !Number.isFinite(Date.parse(data.observedAt)) || !data.statuses || typeof data.statuses !== 'object' || Array.isArray(data.statuses)) throw new Error('Live work unavailable');
        const checkedAt = Date.now();
        setFeed({statuses:localWorkSnapshot(data,performance.now()-sentAt,checkedAt),checkedAt,availability:'ready'});
        setNow(checkedAt);
      } catch {
        if (!controller.signal.aborted && version === epoch) clear('unavailable');
      } finally {
        busy = false;
        if (!controller.signal.aborted && visible()) timer = setTimeout(update,repeat ? 0 : 4000);
        repeat = false;
      }
    };
    const visibility = () => {
      ++epoch; clearTimeout(timer); clear('loading'); setNow(Date.now());
      if (visible()) void update();
    };
    const db = supabaseBrowser();
    let accountId: string|null|undefined;
    const {data:auth} = db.auth.onAuthStateChange((event:AuthChangeEvent, session:Session|null) => {
      const nextId = session?.user.id || null;
      if (event === 'SIGNED_OUT' || accountId !== undefined && accountId !== nextId) {
        ++epoch; clear('unavailable');
        if (nextId) void update();
      }
      accountId = nextId;
    });
    document.addEventListener('visibilitychange',visibility);
    const clock = setInterval(() => setNow(Date.now()),1000);
    void update();
    return () => { controller.abort(); clearTimeout(timer); clearInterval(clock); auth.subscription.unsubscribe(); document.removeEventListener('visibilitychange',visibility); };
  }, []);
  const availability = feed.availability === 'ready' && now-feed.checkedAt > 12_000 ? 'unavailable' : feed.availability;
  return {statuses:feed.statuses,availability,now};
}
