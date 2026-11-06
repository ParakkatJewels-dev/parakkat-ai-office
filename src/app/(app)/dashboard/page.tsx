import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { liveRuns, runSteps } from '@/lib/agents/campaign';
import { Icon } from '@/components/Icon';
import { Tile, Stepper, Pager, pageOf, inr, when } from '@/components/ui';
import { googleId, metaId } from '@/lib/connectors/accounts.mjs';
import { Filters } from './Filters';
import styles from './Dashboard.module.css';
import { scopedOdooBranchSales } from '@/lib/connectors/odoo-scope';
import { needsFor } from '@/lib/needs';
import { WorkingNow } from '@/components/WorkingNow';

const KIND = { plan: 'PL', report: 'RE', design: 'DE', video: 'VI' } as const;
const KIND_WORD = { plan: 'Campaign plan', report: 'Report', design: 'Design', video: 'Video' } as const;

const PLATFORM: Record<string, { label: string; color: string }> = { meta: { label: 'Meta', color: '#3d6fb0' }, google: { label: 'Google', color: '#1fc7a4' } };

const DAY = 864e5, iso = (d: Date) => d.toISOString().slice(0, 10), isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
/** The dates the filters ask for: a preset ending today, this month so far, or two dates (at most two years apart). */
function period(sp: Record<string, string | undefined>) {
  const today = new Date(), to = iso(today), range = sp.range || '30';
  if (range === 'mtd') return { from: `${to.slice(0, 8)}01`, to, label: 'this month so far' };
  if (range === 'custom' && isDate(sp.from) && isDate(sp.to) && sp.from! <= sp.to!) {
    const from = Date.parse(sp.to!) - Date.parse(sp.from!) > 730 * DAY ? iso(new Date(Date.parse(sp.to!) - 730 * DAY)) : sp.from!;
    const f = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return { from, to: sp.to!, label: `${f(from)} to ${f(sp.to!)}` };
  }
  const n = ['7', '90'].includes(range) ? Number(range) : 30;
  return { from: iso(new Date(today.getTime() - (n - 1) * DAY)), to, label: `the last ${n} days` };
}

type Summary = {
  revenue: number; prev_revenue: number; units: number; prev_units: number; spend: number; ad_revenue: number; prev_spend: number; prev_ad_revenue: number;
  days: [string, number][]; platforms: { platform: string; spend: number; revenue: number }[]; top: { id: number; revenue: number; title: string | null; image_url: string | null }[];
};

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { db, name, role } = await requireUser();
  const sp = await searchParams, P = period(sp);
  const platform = sp.platform === 'meta' || sp.platform === 'google' ? sp.platform : null, account = sp.account && /^[\w-]{1,40}$/.test(sp.account) ? sp.account : null;
  const end = `${P.to}T23:59:59.999Z`, delta = (now: number, before: number) => before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}% vs before` : undefined;
  // totals are summed in the database (dashboard_report), so they stay right however many order and ad rows there are
  const [{ data: summary, error: summaryError }, { data: posts, error: postsError }, { data: moves }, { data: runs }, { data: accts }, { data: branchRows, error: branchError }, inbox, { data: syncJob }] = await Promise.all([
    db.rpc('dashboard_report', { p_from: P.from, p_to: P.to, p_platform: platform, p_account: account }),
    db.from('social_posts').select('id, caption, media_type, permalink, saves, reach, media_url').gte('posted_at', P.from).lte('posted_at', end).order('saves', { ascending: false, nullsFirst: false }).limit(5),
    db.from('competitor_moves').select('id, kind, summary, seen_at, competitors(name)').gte('seen_at', P.from).lte('seen_at', end).order('seen_at', { ascending: false }).limit(6),
    db.from('agent_runs').select('id, occasion, stage, status, started_at, state').eq('kind', 'campaign').gte('started_at', P.from).lte('started_at', end).order('started_at', { ascending: false }).limit(5),
    db.rpc('ad_accounts'),
    scopedOdooBranchSales(db, P.from, P.to).then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
    needsFor(db, role, 6),
    db.from('autopilot_jobs').select('last_run_at, last_result').eq('name', 'sync').maybeSingle(),
  ]);
  const live = await liveRuns(db, (runs || []).map(r => r.id));
  const accounts = ((accts || []) as { platform: string; account_id: string }[]).map(a => ({ platform: a.platform, id: a.account_id, label: a.platform === 'google' ? googleId(a.account_id) : metaId(a.account_id) }));
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
  const dateLabel = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });
  const hour = Number(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  const first = name.includes('@') ? '' : name.split(' ')[0];
  const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${first ? `, ${first}` : ''}`;
  const waiting = inbox.waiting, plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  // every showroom and the online store, from Odoo
  const branches = ((branchRows || []) as { branch: string; kind: string; orders: number; revenue: number; prev_revenue: number }[]).map(b => ({ ...b, revenue: Number(b.revenue), prev: Number(b.prev_revenue) }));
  const branchPage = Math.min(pageOf(sp, 'bp'), Math.max(1, Math.ceil(branches.length / 5)));
  const shownBranches = branches.slice((branchPage - 1) * 5, branchPage * 5);
  const branchTotal = branches.reduce((t, b) => t + b.revenue, 0), branchMax = branches[0]?.revenue || 1;
  const change = (now: number, before: number) => before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%` : 'new';

  const view = ['ads', 'social', 'branches', 'campaigns'].includes(sp.view || '') ? sp.view! : 'sales';
  const viewHref = (v: string) => { const q = new URLSearchParams(); for (const [k, val] of Object.entries(sp)) if (val && !['view', 'bp'].includes(k)) q.set(k, val); if (v !== 'sales') q.set('view', v); return `/dashboard${q.size ? `?${q}` : ''}`; };
  const VIEWS: [string, string][] = [['sales', 'Sales'], ['ads', 'Ads'], ['social', 'Social'], ['branches', 'Branches'], ['campaigns', 'Campaigns']];

  return (
    <div className={`page ${styles.dashboard}`}>
      <header className={styles.hello}>
        <div><span className={styles.date}>{greeting} · {dateLabel}</span><h1>{inbox.failed ? 'Your day at a glance' : waiting ? `${plural(waiting, 'thing needs', 'things need')} you` : 'You’re all caught up'}</h1></div>
        <div className="page-actions"><Filters accounts={accounts} from={P.from} to={P.to} ads={view === 'ads'} /><Link href="/office" className="btn ghost"><Icon name="cube" size={17} />Office</Link></div>
      </header>
      {(summaryError || branchError || postsError) && <div className="flash" role="alert">Some numbers couldn’t load. Refresh to try again; a dash means “not loaded”, not zero.</div>}
      {syncJob?.last_result?.startsWith('failed') && <div className="banner" role="status"><Icon name="sync" size={18} /><span>The last data update failed, so some numbers may be old.</span></div>}

      <section className="tiles" aria-label="Key numbers">
        <Tile icon="rupee" label="Online sales" value={summaryError ? '—' : inr(revenue)} sub={summaryError ? undefined : delta(revenue, Number(S.prev_revenue))} />
        <Tile icon="bag" tone="amber" label="Items sold" value={summaryError ? '—' : units.toLocaleString('en-IN')} sub={summaryError ? undefined : delta(units, Number(S.prev_units))} />
        <Tile icon="megaphone" tone="blue" label="Ad spend" value={summaryError ? '—' : inr(spend)} sub={summaryError ? undefined : delta(spend, prevSpend)} />
        <Tile icon="trend" tone="violet" label="Ad return" value={!summaryError && spend ? `${roas.toFixed(1)}x` : '–'} sub={prevRoas ? `was ${prevRoas.toFixed(1)}x` : undefined} />
      </section>

      <div className={styles.top}>
        <section className={`card ${styles.needs}`} aria-labelledby="needs-title">
          <div className="card-head"><h2 id="needs-title">Needs you</h2>{waiting > 0 && <span className="pill needs">{waiting}</span>}</div>
          {inbox.failed ? <div className="empty"><Icon name="inbox" size={20} /><p>Your Inbox couldn’t load. Refresh to try again.</p></div>
            : inbox.items.length ? <ul className={styles.needList}>{inbox.items.map(n => <li key={n.id}><Link href={n.href}>
              <span className={`kind ${n.kind}`} aria-hidden="true">{KIND[n.kind]}</span>
              <span className={styles.needText}><b>{n.title}</b><small>{KIND_WORD[n.kind]}{n.agent ? ` · ${n.agent}` : ''} · {when(n.at)}</small></span>
              <Icon name="next" size={16} /></Link></li>)}</ul>
            : <div className="empty"><Icon name="check" size={20} /><p>Nothing waits on you.</p></div>}
          {waiting > inbox.items.length && <Link href="/approvals" className={styles.all}>All {waiting} in the Inbox<Icon name="arrow" size={15} /></Link>}
        </section>
        <section className="card" aria-labelledby="team-title">
          <div className="card-head"><h2 id="team-title">Team at work</h2><Link href="/office" className={styles.link}>Office<Icon name="arrow" size={14} /></Link></div>
          <WorkingNow observedAt={new Date().toISOString()} />
        </section>
      </div>

      <nav className="tabs" aria-label="Business">{VIEWS.map(([v, label]) => <Link key={v} href={viewHref(v)} scroll={false} className={view === v ? 'on' : ''} aria-current={view === v ? 'page' : undefined}>{label}</Link>)}</nav>
      <div className="bento">
        {view === 'sales' && <>
        <section className="card s8">
          <div className="card-head"><div><h3>Online sales by day</h3></div><b className="card-num">{summaryError ? '—' : inr(revenue)}</b></div>
          {days.length > 1 ? (
            <svg viewBox={`0 0 ${W} ${H + 22}`} className="chart" role="img" aria-label={`Daily revenue for ${P.label}, peaking at ${inr(max)}`}>
              <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".32" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
              {[0, .5, 1].map(f => <g key={f}><line x1="0" x2={W} y1={Y(max * f)} y2={Y(max * f)} className="grid" /><text x={W} y={Y(max * f) - 5} textAnchor="end" className="axis">{inr(max * f)}</text></g>)}
              <polygon points={`0,${H - 8} ${line} ${W},${H - 8}`} fill="url(#rev)" />
              <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
              <circle cx={X(days.length - 1)} cy={Y(days[days.length - 1][1])} r="4.5" fill="var(--accent)" stroke="var(--panel)" strokeWidth="2" />
              {[0, Math.floor((days.length - 1) / 2), days.length - 1].map((i, k) => <text key={i} x={X(i)} y={H + 16} textAnchor={(['start', 'middle', 'end'] as const)[k]} className="axis">{short(days[i][0])}</text>)}
            </svg>
          ) : <div className="empty"><Icon name="chart" size={26} /><p>{summaryError ? 'Revenue could not load. Refresh this page to try again.' : 'Connect Shopify in Settings to see daily sales.'}</p></div>}
        </section>
        <section className="card s4">
          <div className="card-head"><div><h3>Top products</h3></div></div>
          {top.length ? <ul className="rows">{top.map((t, i) => (
            <li key={t.id}>
              {t.image_url ? <img src={t.image_url} alt="" className="thumb" loading="lazy" decoding="async" /> : <span className="thumb rank">{i + 1}</span>}
              <div className="grow"><b className="clip">{t.title || `Product ${t.id}`}</b><span className="meter"><i style={{ width: `${(t.revenue / topMax) * 100}%` }} /></span></div>
              <span className="num">{inr(t.revenue)}</span>
            </li>
          ))}</ul> : <div className="empty"><Icon name="bag" size={26} /><p>{summaryError ? 'Product results could not load.' : 'No orders synced yet.'}</p></div>}
        </section>
        </>}
        {view === 'ads' && <>
        <section className="card s5">
          <div className="card-head"><div><h3>Ad spend</h3></div></div>
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
          ) : <div className="empty"><Icon name="megaphone" size={26} /><p>{summaryError ? 'Ad spend could not load. Refresh this page to try again.' : platform || account ? 'No ad spend for these filters.' : 'No ad spend yet. Connect Meta or Google Ads in Settings.'}</p></div>}
        </section>
        <section className="card s7">
          <div className="card-head"><div><h3>Recent campaigns</h3></div></div>
          {(runs || []).length ? <ul className="runs">{runs!.map(r => {
            const v = runSteps(r, live.has(r.id));
            return (
              <li key={r.id}>
                <div className="run-name"><b>{r.occasion || 'Campaign run'}</b><span className="sm">Started {when(r.started_at)}</span></div>
                <Stepper steps={v.steps} />
                <span className={`pill ${v.pill[1]}`}>{v.pill[0]}</span>
              </li>
            );
          })}</ul> : <div className="empty"><Icon name="rocket" size={26} /><p>No campaigns have run in this period. <Link href="/campaigns">Start one</Link>.</p></div>}
        </section>
        </>}
        {view === 'social' && <>
        <section className="card s6">
          <div className="card-head"><div><h3>Most saved posts</h3></div></div>
          {(posts || []).length ? <ul className="rows">{posts!.map(p => (
            <li key={p.id}>
              {p.media_url && p.media_type !== 'VIDEO' ? <img src={p.media_url} alt="" className="thumb" loading="lazy" decoding="async" /> : <span className="thumb"><Icon name="heart" size={18} /></span>}
              <div className="grow"><a href={p.permalink || '#'} target="_blank" rel="noreferrer" className="clip"><b>{(p.caption || p.media_type || 'Post').slice(0, 70)}</b></a><span className="sm">{(p.media_type || '').toLowerCase().replace('_', ' ')} · reach {p.reach?.toLocaleString('en-IN') ?? '?'}</span></div>
              <span className="num">{p.saves ?? 0}<small> saves</small></span>
            </li>
          ))}</ul> : <div className="empty"><Icon name="heart" size={26} /><p>{postsError ? 'Instagram posts could not load.' : 'No Instagram posts synced yet.'}</p></div>}
        </section>
        <section className="card s6">
          <div className="card-head"><div><h3>Competitor moves</h3></div></div>
          {(moves || []).length ? <ol className="timeline">{moves!.map(m => (
            <li key={m.id}><i /><div><b>{(m.competitors as any)?.name}</b> <span className="pill acc">{m.kind}</span><p>{m.summary}</p><time>{when(m.seen_at)}</time></div></li>
          ))}</ol> : <div className="empty"><Icon name="eye" size={26} /><p>Add competitors in Settings and the team will watch them for you.</p></div>}
        </section>
        </>}
        {view === 'branches' && <>
        <section className="card s12" id="branch-sales">
          <div className="card-head"><div><h3>Branches</h3></div>{branches.length > 0 && <b className="card-num">{inr(branchTotal)}</b>}</div>
          {branches.length ? <><ul className="rows">{shownBranches.map(b => (
            <li key={b.branch}>
              <span className="thumb"><Icon name={b.kind === 'online' ? 'bag' : 'map'} size={18} /></span>
              <div className="grow"><b className="clip">{b.branch}</b><span className="meter"><i style={{ width: `${(b.revenue / branchMax) * 100}%` }} /></span>
                <span className="sm">{b.kind === 'showroom' ? 'Showroom' : b.kind === 'online' ? 'Online' : 'Other sales'} · {Number(b.orders).toLocaleString('en-IN')} orders · {change(b.revenue, b.prev)} vs the days before</span></div>
              <span className="num">{inr(b.revenue)}</span>
            </li>
          ))}</ul><Pager sp={sp} param="bp" page={branchPage} size={5} total={branches.length} shown={shownBranches.length} anchor="branch-sales"/></> : <div className="empty"><Icon name="chart" size={26} /><p>{branchError ? 'Branch results could not load. Refresh to try again.' : 'Connect your billing system in Settings to see every branch.'}</p></div>}
        </section>
        </>}
        {view === 'campaigns' && <>
        <section className="card s12">
          <div className="card-head"><div><h3>Recent campaigns</h3></div></div>
          {(runs || []).length ? <ul className="runs">{runs!.map(r => {
            const v = runSteps(r, live.has(r.id));
            return (
              <li key={r.id}>
                <div className="run-name"><b>{r.occasion || 'Campaign run'}</b><span className="sm">Started {when(r.started_at)}</span></div>
                <Stepper steps={v.steps} />
                <span className={`pill ${v.pill[1]}`}>{v.pill[0]}</span>
              </li>
            );
          })}</ul> : <div className="empty"><Icon name="rocket" size={26} /><p>No campaigns have run in this period. <Link href="/campaigns">Start one</Link>.</p></div>}
        </section>
        </>}
      </div>
    </div>
  );
}
