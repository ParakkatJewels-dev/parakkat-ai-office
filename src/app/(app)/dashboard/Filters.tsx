'use client';
import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/Icon';

type Account = { platform: string; id: string; label: string };
const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['mtd', 'This month'], ['custom', 'Custom dates']] as const;

/** Date range, ad platform and ad account. Each change updates the address, so a filtered view can be bookmarked or shared. */
export function Filters({ accounts, from, to }: { accounts: Account[]; from: string; to: string }) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams(), [pending, start] = useTransition();
  const range = sp.get('range') || '30', platform = sp.get('platform') || '', account = sp.get('account') || '';
  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v ? q.set(k, v) : q.delete(k);
    start(() => router.push(`${path}${q.size ? `?${q}` : ''}`, { scroll: false }));
  };
  const shown = accounts.filter(a => !platform || a.platform === platform);
  const any = range !== '30' || platform || account;
  return (
    <div className={`filters ${pending ? 'loading' : ''}`} role="search" aria-label="Dashboard filters">
      <span className="filters-ic">{pending ? <span className="spin" aria-hidden="true" /> : <Icon name="filter" size={16} />}</span>
      <label className="fl">Dates<select className="in" value={range} onChange={e => set({ range: e.target.value === '30' ? null : e.target.value, ...(e.target.value === 'custom' ? { from, to } : { from: null, to: null }) })}>
        {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {range === 'custom' && <>
        <label className="fl">From<input type="date" className="in" defaultValue={from} max={to} onChange={e => e.target.value && set({ from: e.target.value })} /></label>
        <label className="fl">To<input type="date" className="in" defaultValue={to} min={from} onChange={e => e.target.value && set({ to: e.target.value })} /></label>
      </>}
      <label className="fl">Ad platform<select className="in" value={platform} onChange={e => set({ platform: e.target.value || null, account: null })}>
        <option value="">Meta and Google</option><option value="meta">Meta</option><option value="google">Google</option></select></label>
      <label className="fl">Ad account<select className="in" value={account} onChange={e => set({ account: e.target.value || null })} disabled={!shown.length}>
        <option value="">{shown.length ? 'All accounts' : 'No accounts synced yet'}</option>
        {shown.map(a => <option key={`${a.platform}:${a.id}`} value={a.id}>{platform ? '' : `${a.platform === 'meta' ? 'Meta' : 'Google'} · `}{a.label}</option>)}</select></label>
      {any && <button type="button" className="btn ghost sm-btn quiet" onClick={() => set({ range: null, from: null, to: null, platform: null, account: null })}><Icon name="x" size={14} />Clear</button>}
    </div>
  );
}
