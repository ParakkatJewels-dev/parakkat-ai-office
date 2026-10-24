import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { STAGES } from '@/lib/agents/campaign';
import { Icon } from '@/components/Icon';
import { PageHead, Tile, Stepper, inr, when } from '@/components/ui';

const PLATFORM: Record<string, { label: string; color: string }> = { meta: { label: 'Meta', color: '#3d6fb0' }, google: { label: 'Google', color: '#1fc7a4' } };
const STAGE_LABEL: Record<string, string> = { analyse: 'Analyse', competitors: 'Competitors', plan: 'Plan', create: 'Create', review: 'Review', approval: 'Approval', done: 'Live' };

/** Change against the 30 days before, as "+12%" or "-4%". */
const delta = (now: number, before: number) => before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}% vs last 30 days` : 'last 30 days';

type Summary = {
  revenue: number; prev_revenue: number; units: number; prev_units: number; spend: number; ad_revenue: number; prev_spend: number; prev_ad_revenue: number;
  days: [string, number][]; platforms: { platform: string; spend: number; revenue: number }[]; top: { id: number; revenue: number; title: string | null; image_url: string | null }[];
};

export default async function Dashboard() {
  const { db, name } = await requireUser();
  // totals are summed in the database (dashboard_summary), so they stay right however many order and ad rows there are
  const [{ data: summary }, { data: posts }, { data: moves }, { data: runs }] = await Promise.all([
    db.rpc('dashboard_summary', { p_days: 30 }),
    db.from('social_posts').select('id, caption, media_type, permalink, saves, reach, media_url').order('saves', { ascending: false, nullsFirst: false }).limit(5),
    db.from('competitor_moves').select('id, kind, summary, seen_at, competitors(name)').order('seen_at', { ascending: false }).limit(6),
    db.from('agent_runs').select('id, occasion, stage, status, started_at').order('started_at', { ascending: false }).limit(5),
  ]);
  const S = (summary || { revenue: 0, prev_revenue: 0, units: 0, prev_units: 0, spend: 0, ad_revenue: 0, prev_spend: 0, prev_ad_revenue: 0, days: [], platforms: [], top: [] }) as Summary;
  const revenue = Number(S.revenue), units = Number(S.units), spend = Number(S.spend), adRev = Number(S.ad_revenue);
  const prevSpend = Number(S.prev_spend), prevRoas = prevSpend ? Number(S.prev_ad_revenue) / prevSpend : 0;
  const roas = spend ? adRev / spend : 0;

  // revenue chart: one point per day, area under a line
  const days = S.days.map(([d, v]) => [d, Number(v)] as [string, number]), max = Math.max(1, ...days.map(d => d[1]));
  const W = 720, H = 220, X = (i: number) => (i / Math.max(1, days.length - 1)) * W, Y = (v: number) => H - 8 - (v / max) * (H - 28);
  const line = days.map(([, v], i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const short = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  // ad spend split by platform
  const split = S.platforms.map(p => [p.platform, Number(p.spend), Number(p.revenue)] as const);
  let acc = 0; const C = 2 * Math.PI * 42;

  const top = S.top.map(t => ({ ...t, revenue: Number(t.revenue) }));
  const topMax = top[0]?.revenue || 1;
  const hr = new Date().getHours();

  return (
    <div className="page">
      <PageHead title={`${hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'}, ${name.split(' ')[0]}`}
        sub={`Here is how Parakkat Jewels did over the last 30 days. ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}.`}>
        <Link href="/office" className="btn ghost"><Icon name="map" size={18} />Office map</Link>
        <Link href="/approvals" className="btn"><Icon name="check" size={18} />Approvals</Link>
      </PageHead>

      <section className="tiles" aria-label="Key numbers">
        <Tile icon="rupee" label="Shopify revenue" value={inr(revenue)} sub={delta(revenue, Number(S.prev_revenue))} />
        <Tile icon="bag" tone="amber" label="Items sold" value={units.toLocaleString('en-IN')} sub={delta(units, Number(S.prev_units))} />
        <Tile icon="megaphone" tone="blue" label="Ad spend" value={inr(spend)} sub={delta(spend, prevSpend)} />
        <Tile icon="trend" tone="violet" label="Return on ad spend" value={spend ? `${roas.toFixed(1)}x` : '–'} sub={prevRoas ? `${roas >= prevRoas ? 'Up' : 'Down'} from ${prevRoas.toFixed(1)}x` : 'Meta and Google combined'} />
      </section>

      <div className="bento">
        <section className="card s8">
          <div className="card-head"><div><h3>Revenue by day</h3><p className="sub">Shopify orders, last 30 days</p></div><b className="card-num">{inr(revenue)}</b></div>
          {days.length > 1 ? (
            <svg viewBox={`0 0 ${W} ${H + 22}`} className="chart" role="img" aria-label={`Daily revenue for the last 30 days, peaking at ${inr(max)}`}>
              <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".32" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
              {[0, .5, 1].map(f => <g key={f}><line x1="0" x2={W} y1={Y(max * f)} y2={Y(max * f)} className="grid" /><text x={W} y={Y(max * f) - 5} textAnchor="end" className="axis">{inr(max * f)}</text></g>)}
              <polygon points={`0,${H - 8} ${line} ${W},${H - 8}`} fill="url(#rev)" />
              <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
              <circle cx={X(days.length - 1)} cy={Y(days[days.length - 1][1])} r="4.5" fill="var(--accent)" stroke="var(--panel)" strokeWidth="2" />
              {[0, Math.floor((days.length - 1) / 2), days.length - 1].map((i, k) => <text key={i} x={X(i)} y={H + 16} textAnchor={(['start', 'middle', 'end'] as const)[k]} className="axis">{short(days[i][0])}</text>)}
            </svg>
          ) : <div className="empty"><Icon name="chart" size={26} /><p>Connect Shopify and run a sync to see daily revenue.</p></div>}
        </section>

        <section className="card s4">
          <div className="card-head"><div><h3>Ad spend by platform</h3><p className="sub">Last 30 days</p></div></div>
          {split.length ? (
            <div className="donut">
              <svg viewBox="0 0 100 100" role="img" aria-label={split.map(([p, v]) => `${PLATFORM[p]?.label || p} ${inr(v)}`).join(', ')}>
                <circle cx="50" cy="50" r="42" className="donut-track" />
                {split.map(([p, v]) => { const len = (v / spend) * C, off = acc; acc += len; return <circle key={p} cx="50" cy="50" r="42" fill="none" stroke={PLATFORM[p]?.color || '#888'} strokeWidth="11" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 50 50)" />; })}
                <text x="50" y="48" textAnchor="middle" className="donut-num">{inr(spend)}</text><text x="50" y="61" textAnchor="middle" className="donut-sub">spent</text>
              </svg>
              <ul className="legend">{split.map(([p, v, rev]) => {
                return <li key={p}><i style={{ background: PLATFORM[p]?.color || '#888' }} /><b>{PLATFORM[p]?.label || p}</b><span className="num">{inr(v)}</span><small>{Math.round((v / spend) * 100)}% · {(rev / v || 0).toFixed(1)}x return</small></li>;
              })}</ul>
            </div>
          ) : <div className="empty"><Icon name="megaphone" size={26} /><p>No ad spend synced yet. Connect Meta or Google Ads on the Admin page.</p></div>}
        </section>

        <section className="card s4">
          <div className="card-head"><div><h3>Top products</h3><p className="sub">By revenue</p></div></div>
          {top.length ? <ul className="rows">{top.map((t, i) => (
            <li key={t.id}>
              {t.image_url ? <img src={t.image_url} alt="" className="thumb" loading="lazy" decoding="async" /> : <span className="thumb rank">{i + 1}</span>}
              <div className="grow"><b className="clip">{t.title || `Product ${t.id}`}</b><span className="meter"><i style={{ width: `${(t.revenue / topMax) * 100}%` }} /></span></div>
              <span className="num">{inr(t.revenue)}</span>
            </li>
          ))}</ul> : <div className="empty"><Icon name="bag" size={26} /><p>No orders synced yet.</p></div>}
        </section>

        <section className="card s4">
          <div className="card-head"><div><h3>Posts people saved</h3><p className="sub">Instagram, most saved first</p></div></div>
          {(posts || []).length ? <ul className="rows">{posts!.map(p => (
            <li key={p.id}>
              {p.media_url && p.media_type !== 'VIDEO' ? <img src={p.media_url} alt="" className="thumb" loading="lazy" decoding="async" /> : <span className="thumb"><Icon name="heart" size={18} /></span>}
              <div className="grow"><a href={p.permalink || '#'} target="_blank" rel="noreferrer" className="clip"><b>{(p.caption || p.media_type || 'Post').slice(0, 70)}</b></a><span className="sm">{(p.media_type || '').toLowerCase().replace('_', ' ')} · reach {p.reach?.toLocaleString('en-IN') ?? '?'}</span></div>
              <span className="num">{p.saves ?? 0}<small> saves</small></span>
            </li>
          ))}</ul> : <div className="empty"><Icon name="heart" size={26} /><p>No Instagram posts synced yet.</p></div>}
        </section>

        <section className="card s4">
          <div className="card-head"><div><h3>Competitor moves</h3><p className="sub">Spotted by the War Room</p></div></div>
          {(moves || []).length ? <ol className="timeline">{moves!.map(m => (
            <li key={m.id}><i /><div><b>{(m.competitors as any)?.name}</b> <span className="pill acc">{m.kind}</span><p>{m.summary}</p><time>{when(m.seen_at)}</time></div></li>
          ))}</ol> : <div className="empty"><Icon name="eye" size={26} /><p>Add competitors on the Admin page and the War Room will watch them.</p></div>}
        </section>

        <section className="card s12">
          <div className="card-head"><div><h3>Recent campaign runs</h3><p className="sub">Each run moves through the team, then waits for the heads</p></div></div>
          {(runs || []).length ? <ul className="runs">{runs!.map(r => {
            const at = STAGES.indexOf(r.stage as any);
            return (
              <li key={r.id}>
                <div className="run-name"><b>{r.occasion}</b><span className="sm">Started {when(r.started_at)}</span></div>
                <Stepper steps={STAGES.map((s, i) => ({ label: STAGE_LABEL[s], state: i < at || r.stage === 'done' ? 'done' : i === at ? (r.status === 'failed' ? 'bad' : 'now') : 'todo' }))} />
                <span className={`pill ${r.status === 'failed' ? 'bad' : r.status === 'waiting' ? 'warn' : r.stage === 'done' ? 'good' : 'acc'}`}>{r.status === 'waiting' ? 'With the heads' : r.stage === 'done' ? 'Live' : r.status}</span>
              </li>
            );
          })}</ul> : <div className="empty"><Icon name="rocket" size={26} /><p>No runs visible to you yet.</p></div>}
        </section>
      </div>
    </div>
  );
}
