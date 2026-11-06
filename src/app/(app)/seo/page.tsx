import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { headsDept } from '@/lib/auth/depts';
import { Icon } from '@/components/Icon';
import { Submit } from '@/components/forms';
import { PageHead, Avatar, Pager, pageOf, rangeOf, inr, when } from '@/components/ui';
import { runSeoNow } from './actions';
import styles from './Seo.module.css';

export const maxDuration = 300;

type Pt = { date: string; value: number };

/** A tiny line of the last 3 months of Google Trends interest. */
function Spark({ pts }: { pts: Pt[] | null }) {
  if (!pts || pts.length < 2) return <span className="sm">–</span>;
  const max = Math.max(1, ...pts.map(p => p.value)), line = pts.map((p, i) => `${(i / (pts.length - 1)) * 96},${22 - (p.value / max) * 20}`).join(' ');
  return <svg viewBox="0 0 96 24" className="spark" aria-hidden="true"><polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}
const KW = 25;
const SHOW = { all: 'All terms', rising: 'Rising', easy: 'Easy wins' } as const;
const SORT = { searches: 'Searches a month', trend: 'Trend', bid: 'Bid range' } as const;
const REPORT_WORD: Record<string, [string, string]> = { with_head: ['Waiting on you', 'needs'], accepted: ['Accepted', 'good'], sent_back: ['Sent back', 'warn'], rejected: ['Rejected', 'bad'], rejected_by_lead: ['Rejected', 'bad'] };
const pct = (n: number | null) => n == null ? '–' : `${n > 0 ? '+' : ''}${n}%`;

export default async function Seo({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { db, role } = await requireUser();
  if (!(await headsDept(db, role, 'seo'))) redirect('/office');
  const sp = await searchParams, kp = pageOf(sp, 'kp'), [k0, k1] = rangeOf(kp, KW), q = (sp.q || '').trim().slice(0, 80);
  const show = (sp.show && sp.show in SHOW ? sp.show : 'all') as keyof typeof SHOW, sort = (sp.sort && sp.sort in SORT ? sp.sort : 'searches') as keyof typeof SORT;
  const href = (patch: Record<string, string | null>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ q: q || null, show: show === 'all' ? null : show, sort: sort === 'searches' ? null : sort, ...patch })) if (v) u.set(k, v); return `/seo${u.size ? `?${u}` : ''}`; };
  // the keyword table is sorted, filtered and paged in the database; the summary line is counts
  const cols = 'keyword, avg_monthly_searches, competition, bid_low, bid_high, trend_interest, trend_change, trend_series, rising, updated_at';
  let table = db.from('seo_keywords').select(cols, { count: 'exact' }).not('avg_monthly_searches', 'is', null);
  if (q) table = table.ilike('keyword', `%${q.replace(/[%_\\]/g, '')}%`);
  if (show === 'rising') table = table.eq('rising', true);
  if (show === 'easy') table = table.in('competition', ['LOW', 'MEDIUM']);
  table = sort === 'trend' ? table.order('trend_change', { ascending: false, nullsFirst: false }) : sort === 'bid' ? table.order('bid_high', { ascending: false, nullsFirst: false }) : table;
  const head = { count: 'exact' as const, head: true };
  const [{ data: byVolume, count: volCount }, { count: total }, { count: risingCount }, { count: easy }, { data: biggest }, { data: tracked }, { data: rising }, { data: latest }, { data: reports }, { data: agents }, { data: conns }] = await Promise.all([
    table.order('avg_monthly_searches', { ascending: false }).range(k0, k1),
    db.from('seo_keywords').select('keyword', head),
    db.from('seo_keywords').select('keyword', head).eq('rising', true),
    db.from('seo_keywords').select('keyword', head).in('competition', ['LOW', 'MEDIUM']).not('avg_monthly_searches', 'is', null),
    db.from('seo_keywords').select('keyword, avg_monthly_searches').not('avg_monthly_searches', 'is', null).order('avg_monthly_searches', { ascending: false }).limit(1),
    db.from('seo_keywords').select('keyword, trend_interest, trend_change, trend_series').not('trend_series', 'is', null).order('trend_change', { ascending: false, nullsFirst: false }).limit(12),
    db.from('seo_keywords').select('keyword').eq('rising', true).order('updated_at', { ascending: false }).limit(18),
    db.from('seo_keywords').select('updated_at').order('updated_at', { ascending: false }).limit(1),
    db.from('reports').select('id, author_agent, title, body, status, lead_note, updated_at').eq('department_id', 'seo').order('updated_at', { ascending: false }).limit(6),
    db.from('agents').select('id, name').eq('department_id', 'seo'),
    db.from('connections').select('provider, status, last_synced_at, last_error').in('provider', ['google_trends', 'keyword_planner']),
  ]);
  const A = Object.fromEntries((agents || []).map(a => [a.id, a.name])), top = biggest?.[0], last = latest?.[0]?.updated_at;
  const sortHead = (k: keyof typeof SORT, className?: string) => <th scope="col" className={className} aria-sort={sort === k ? 'descending' : undefined}>
    <Link href={href({ sort: k === 'searches' ? null : k, kp: null })} className={sort === k ? styles.sorted : undefined}>{SORT[k]}{sort === k && <Icon name="down" size={13} />}</Link></th>;

  return (
    <div className={`page ${styles.page}`}>
      {sp.msg && <p className="flash ok" role="status">{sp.msg}</p>}
      {sp.error && <p className="flash" role="alert">{sp.error}</p>}
      <PageHead title="SEO" sub="What people in Kerala search for, from Google Trends and Google Ads Keyword Planner. The SEO Desk checks every Monday, and the Campaign Strategist uses it when planning.">
        <form action={runSeoNow}><Submit icon="sync" pending="Checking searches…">Run the SEO check now</Submit></form>
      </PageHead>

      <nav className={styles.strip} aria-label="Keyword views">
        {Object.entries(SHOW).map(([k, label]) => <Link key={k} href={href({ show: k === 'all' ? null : k, kp: null })} className={show === k ? styles.on : undefined} aria-current={show === k ? 'page' : undefined}>
          {label}<b>{k === 'all' ? total || 0 : k === 'rising' ? risingCount || 0 : easy || 0}</b></Link>)}
        <span className={styles.stripNote}>{top ? <>Biggest: <b>{top.keyword}</b> · {top.avg_monthly_searches!.toLocaleString('en-IN')} a month · </> : null}{last ? `Checked ${when(last)}` : 'Not checked yet'}</span>
      </nav>

      {(conns || []).some(c => c.status === 'error') && <div className="banner bad-banner" role="alert"><Icon name="plug" size={20} /><span>{(conns || []).filter(c => c.status === 'error').map(c => `${c.provider === 'google_trends' ? 'Google Trends' : 'Keyword Planner'}: ${c.last_error}`).join(' · ')}</span></div>}

      <div className={styles.layout}>
        <section className={`card ${styles.main}`} aria-labelledby="kw-title">
          <div className={styles.toolbar}><h2 id="kw-title">Keywords</h2><span className={styles.count}>{volCount || 0}</span>
            <form className={styles.find} role="search" action="/seo">{show !== 'all' && <input type="hidden" name="show" value={show} />}{sort !== 'searches' && <input type="hidden" name="sort" value={sort} />}<Icon name="search" size={16}/><input name="q" defaultValue={q} placeholder="Filter keywords" aria-label="Filter keywords"/>{q && <Link href={href({ q: null, kp: null })} aria-label="Clear the filter"><Icon name="x" size={14} /></Link>}</form></div>
          {byVolume?.length ? <div className={styles.tablewrap} tabIndex={0} role="region" aria-label="Keyword search results"><table className="table">
            <thead><tr><th scope="col">Search term</th>
              {sortHead('searches', 'r')}<th scope="col">Competition</th>{sortHead('bid', 'r')}{sortHead('trend')}
            </tr></thead>
            <tbody>{byVolume.map(k => <tr key={k.keyword}>
              <td><b>{k.keyword}</b>{k.rising && <span className="pill warn">rising</span>}</td>
              <td className="r num">{k.avg_monthly_searches!.toLocaleString('en-IN')}</td>
              <td><span className={`pill ${k.competition === 'LOW' ? 'good' : k.competition === 'HIGH' ? 'bad' : 'warn'}`}>{(k.competition || '?').toLowerCase()}</span></td>
              <td className="r num">{k.bid_high ? `${inr(k.bid_low || 0)}–${inr(k.bid_high)}` : '–'}</td>
              <td><span className={styles.trend}><Spark pts={k.trend_series as Pt[] | null} />{k.trend_change != null && <span className={`num ${k.trend_change >= 0 ? 'up' : 'down'}`}>{pct(k.trend_change)}</span>}</span></td>
            </tr>)}</tbody>
          </table></div> : <div className="empty"><Icon name="search" size={26} /><p>{q ? `No keywords match "${q}".` : show !== 'all' ? 'No keywords in this view yet.' : 'No keyword data yet. Connect Google Ads in Settings.'}</p></div>}
          <Pager sp={sp} param="kp" page={kp} size={KW} total={volCount} shown={(byVolume || []).length} />
        </section>

        <aside className={styles.side}>
          <section className="card" aria-labelledby="trends-title">
            <div className={styles.sideHead}><h2 id="trends-title">Interest in Kerala</h2><span>Google Trends · 3 months</span></div>
            {tracked?.length ? <ul className={styles.trendRows}>{tracked.map(k => <li key={k.keyword}>
              <Link href={href({ q: k.keyword, kp: null })} className="clip" title={k.keyword}>{k.keyword}</Link>
              <Spark pts={k.trend_series as Pt[]} /><span className={`num ${(k.trend_change ?? 0) >= 0 ? 'up' : 'down'}`}>{pct(k.trend_change)}</span>
            </li>)}</ul> : <p className="sub">Run the SEO check to read Google Trends.</p>}
          </section>
          <section className="card" aria-labelledby="rising-title">
            <div className={styles.sideHead}><h2 id="rising-title">Rising searches</h2><span>Growing fastest</span></div>
            {rising?.length ? <div className={styles.tags}>{rising.map(k => <Link key={k.keyword} href={href({ q: k.keyword, kp: null })} className="pill acc">{k.keyword}</Link>)}</div> : <p className="sub">None found yet.</p>}
          </section>
        </aside>
      </div>

      <section className={`card ${styles.reports}`} aria-labelledby="seo-reports-title">
        <div className={styles.toolbar}><h2 id="seo-reports-title">SEO reports</h2><span className={styles.count}>Checked by the SEO Lead · decide them in the Inbox</span></div>
        {(reports || []).length ? <ul className={styles.reportRows}>{reports!.map(r => { const word = REPORT_WORD[r.status] || [r.status.replace(/_/g, ' '), '']; return <li key={r.id}>
          <Link href={`/approvals?report=${r.id}`} className={styles.reportRow}>
            <Avatar name={A[r.author_agent] || r.author_agent} dept="seo" size={24} />
            <b className="clip">{r.title}</b>
            <span className={styles.when}>{when(r.updated_at)}</span>
            <span className={`pill ${word[1]}`}>{word[0]}</span>
            <Icon name="next" size={16} />
          </Link></li>; })}</ul> : <div className="empty"><Icon name="doc" size={26} /><p>No SEO reports yet.</p></div>}
      </section>
    </div>
  );
}
