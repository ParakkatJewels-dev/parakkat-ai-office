import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { headsDept } from '@/lib/auth/depts';
import { Icon } from '@/components/Icon';
import { PageHead, Tile, Avatar, inr, when } from '@/components/ui';
import { runSeoNow } from './actions';

export const maxDuration = 300;

type Pt = { date: string; value: number };

/** A tiny line of the last 3 months of Google Trends interest. */
function Spark({ pts }: { pts: Pt[] | null }) {
  if (!pts || pts.length < 2) return <span className="sm">–</span>;
  const max = Math.max(1, ...pts.map(p => p.value)), line = pts.map((p, i) => `${(i / (pts.length - 1)) * 96},${22 - (p.value / max) * 20}`).join(' ');
  return <svg viewBox="0 0 96 24" className="spark" aria-hidden="true"><polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}
const pct = (n: number | null) => n == null ? '–' : `${n > 0 ? '+' : ''}${n}%`;

export default async function Seo({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { db, role } = await requireUser();
  if (!(await headsDept(db, role, 'seo'))) redirect('/office');
  const sp = await searchParams;
  const [{ data: kws }, { data: reports }, { data: agents }, { data: conns }] = await Promise.all([
    db.from('seo_keywords').select('keyword, avg_monthly_searches, competition, bid_low, bid_high, trend_interest, trend_change, trend_series, rising, source, updated_at').limit(1000),
    db.from('reports').select('id, author_agent, title, body, status, lead_note, updated_at').eq('department_id', 'seo').order('updated_at', { ascending: false }).limit(6),
    db.from('agents').select('id, name').eq('department_id', 'seo'),
    db.from('connections').select('provider, status, last_synced_at, last_error').in('provider', ['google_trends', 'keyword_planner']),
  ]);
  const all = kws || [], A = Object.fromEntries((agents || []).map(a => [a.id, a.name]));
  const byVolume = all.filter(k => k.avg_monthly_searches).sort((a, b) => b.avg_monthly_searches! - a.avg_monthly_searches!).slice(0, 40);
  const tracked = all.filter(k => (k.trend_series as Pt[] | null)?.length).sort((a, b) => (b.trend_change ?? -999) - (a.trend_change ?? -999));
  const rising = all.filter(k => k.rising).slice(0, 18);
  const last = all.reduce((m, k) => k.updated_at > m ? k.updated_at : m, '');
  const easy = byVolume.filter(k => k.competition === 'LOW' || k.competition === 'MEDIUM').length;

  return (
    <div className="page">
      {sp.msg && <p className="flash ok">{sp.msg}</p>}
      {sp.error && <p className="flash">{sp.error}</p>}
      <PageHead title="SEO" sub="What people in Kerala search for, from Google Trends and Google Ads Keyword Planner. The SEO Desk checks every Monday, and the Campaign Strategist uses it when planning.">
        <form action={runSeoNow}><button className="btn"><Icon name="sync" size={18} />Run the SEO check now</button></form>
      </PageHead>

      <section className="tiles" aria-label="Summary">
        <Tile icon="search" label="Search terms tracked" value={all.length} sub={last ? `Checked ${when(last)}` : 'Not checked yet'} />
        <Tile icon="trend" tone="amber" label="Rising searches" value={rising.length} sub="From Google Trends" />
        <Tile icon="users" tone="blue" label="Biggest term" value={byVolume[0] ? `${(byVolume[0].avg_monthly_searches! / 1000).toFixed(byVolume[0].avg_monthly_searches! < 10000 ? 1 : 0)}k` : '–'} sub={byVolume[0]?.keyword || 'Needs Keyword Planner'} />
        <Tile icon="spark" tone="violet" label="Winnable terms" value={easy} sub="Real volume, low or medium competition" />
      </section>

      {(conns || []).some(c => c.status === 'error') && <div className="banner bad-banner"><Icon name="plug" size={20} /><span>{(conns || []).filter(c => c.status === 'error').map(c => `${c.provider === 'google_trends' ? 'Google Trends' : 'Keyword Planner'}: ${c.last_error}`).join(' · ')}</span></div>}

      <div className="bento">
        <section className="card s8">
          <div className="card-head"><div><h3>Keywords by monthly searches</h3><p className="sub">Keyword Planner, India. Bids are the top-of-page range in Google Ads.</p></div></div>
          {byVolume.length ? <div className="tablewrap"><table className="table">
            <thead><tr><th>Search term</th><th className="r">Searches a month</th><th>Competition</th><th className="r">Bid range</th><th>Trend</th></tr></thead>
            <tbody>{byVolume.map(k => <tr key={k.keyword}>
              <td><b>{k.keyword}</b>{k.rising && <span className="pill warn">rising</span>}</td>
              <td className="r num">{k.avg_monthly_searches!.toLocaleString('en-IN')}</td>
              <td><span className={`pill ${k.competition === 'LOW' ? 'good' : k.competition === 'HIGH' ? 'bad' : 'warn'}`}>{(k.competition || '?').toLowerCase()}</span></td>
              <td className="r num">{k.bid_high ? `${inr(k.bid_low || 0)}–${inr(k.bid_high)}` : '–'}</td>
              <td><Spark pts={k.trend_series as Pt[] | null} /></td>
            </tr>)}</tbody>
          </table></div> : <div className="empty"><Icon name="search" size={26} /><p>No Keyword Planner data yet. It needs the Google Ads keys and a developer token with Basic access.</p></div>}
        </section>

        <div className="s4 stack">
          <section className="card">
            <div className="card-head"><div><h3>Interest in Kerala</h3><p className="sub">Google Trends, last 3 months</p></div></div>
            {tracked.length ? <ul className="rows">{tracked.map(k => <li key={k.keyword}>
              <div className="grow"><b className="clip">{k.keyword}</b><span className="sm">Interest {k.trend_interest ?? '?'} of 100</span></div>
              <Spark pts={k.trend_series as Pt[]} /><span className={`num ${(k.trend_change ?? 0) >= 0 ? 'up' : 'down'}`}>{pct(k.trend_change)}</span>
            </li>)}</ul> : <div className="empty"><Icon name="trend" size={26} /><p>Run the SEO check to read Google Trends.</p></div>}
          </section>
          <section className="card">
            <div className="card-head"><div><h3>Rising searches</h3><p className="sub">Related searches growing fastest</p></div></div>
            {rising.length ? <div className="tags">{rising.map(k => <span key={k.keyword} className="pill acc">{k.keyword}</span>)}</div> : <p className="sub">None found yet.</p>}
          </section>
        </div>

        <section className="card s12">
          <div className="card-head"><div><h3>Reports from the SEO Desk</h3><p className="sub">Checked by the SEO Lead before they reach you. Accept or send them back on the Approvals page.</p></div></div>
          {(reports || []).length ? <ul className="rows">{reports!.map(r => <li key={r.id}>
            <Avatar name={A[r.author_agent] || r.author_agent} dept="seo" />
            <div className="grow"><b className="clip">{r.title}</b><details className="report-body"><summary>{A[r.author_agent]} · {when(r.updated_at)}</summary><p>{r.body}</p></details></div>
            <span className={`pill ${r.status === 'accepted' ? 'good' : r.status === 'with_head' ? 'warn' : r.status.includes('reject') ? 'bad' : ''}`}>{r.status === 'with_head' ? 'Waiting on you' : r.status.replace(/_/g, ' ')}</span>
          </li>)}</ul> : <div className="empty"><Icon name="doc" size={26} /><p>No SEO reports yet.</p></div>}
        </section>
      </div>
    </div>
  );
}
