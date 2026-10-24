import { requireUser } from '@/lib/auth/session';

const inr = (n: number) => n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`;

export default async function Dashboard() {
  const { db, name } = await requireUser();
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [{ data: orders }, { data: products }, { data: ads }, { data: posts }, { data: moves }, { data: runs }] = await Promise.all([
    db.from('orders_daily').select('day, product_id, units, revenue').gte('day', since),
    db.from('products').select('id, title, image_url'),
    db.from('ad_insights_daily').select('platform, spend, revenue, purchases').gte('day', since),
    db.from('social_posts').select('id, caption, media_type, permalink, saves, reach, media_url').order('saves', { ascending: false, nullsFirst: false }).limit(5),
    db.from('competitor_moves').select('id, kind, summary, seen_at, competitors(name)').order('seen_at', { ascending: false }).limit(6),
    db.from('agent_runs').select('id, occasion, stage, status, started_at').order('started_at', { ascending: false }).limit(5),
  ]);
  const revenue = (orders || []).reduce((s, o) => s + Number(o.revenue), 0), units = (orders || []).reduce((s, o) => s + o.units, 0);
  const spend = (ads || []).reduce((s, a) => s + Number(a.spend), 0), adRev = (ads || []).reduce((s, a) => s + Number(a.revenue), 0);
  const byDay = new Map<string, number>(); (orders || []).forEach(o => byDay.set(o.day, (byDay.get(o.day) || 0) + Number(o.revenue)));
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b)), max = Math.max(1, ...days.map(d => d[1]));
  const pts = days.map(([, v], i) => `${(i / Math.max(1, days.length - 1)) * 640},${230 - (v / max) * 210}`).join(' ');
  const title = new Map((products || []).map(p => [p.id, p]));
  const top = [...(orders || []).reduce((m, o) => m.set(o.product_id, (m.get(o.product_id) || 0) + Number(o.revenue)), new Map<number, number>())].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const hr = new Date().getHours();
  return (
    <div className="stack">
      <div><h2 style={{ fontSize: 'clamp(24px,3vw,34px)' }}>{hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'}, {name.split(' ')[0]}</h2></div>
      <div className="bento">
        <div className="card hero s8"><div className="eyebrow">Shopify revenue · last 30 days</div><div className="big">{inr(revenue)}</div><p style={{ opacity: .8, margin: '6px 0 0' }}>{units} items sold</p>
          {days.length > 1 ? <svg viewBox="0 0 640 240" role="img" aria-label="Daily revenue, last 30 days" style={{ width: '100%', marginTop: 12 }}><polyline points={pts} fill="none" stroke="#e2d1c3" strokeWidth="2.5" /></svg> : <p className="note" style={{ color: '#cdb894' }}>Connect Shopify and run a sync to see the chart.</p>}</div>
        <div className="card s4 champ"><div className="eyebrow">Return on ad spend · 30 days</div><div className="big">{spend ? `${(adRev / spend).toFixed(1)}x` : '–'}</div><p className="note">{inr(spend)} spent across Meta and Google</p></div>
        <div className="card s4"><h3>Top products</h3><ul className="list">{top.length ? top.map(([id, v]) => <li key={id}><div className="grow"><b>{title.get(id)?.title || id}</b></div><span className="num">{inr(v)}</span></li>) : <li className="note">No orders synced yet.</li>}</ul></div>
        <div className="card s4"><h3>Posts people saved</h3><ul className="list">{(posts || []).length ? posts!.map(p => <li key={p.id}><div className="grow"><a href={p.permalink || '#'} target="_blank" rel="noreferrer"><b>{(p.caption || p.media_type || '').slice(0, 60)}</b></a><span className="sm">{p.media_type} · reach {p.reach ?? '?'}</span></div><span className="num">{p.saves ?? 0} saves</span></li>) : <li className="note">No Instagram posts synced yet.</li>}</ul></div>
        <div className="card s4"><h3>Competitor moves</h3><ul className="list">{(moves || []).length ? moves!.map(m => <li key={m.id}><div className="grow"><b>{(m.competitors as any)?.name}</b><span className="sm">{m.summary}</span></div><span className="pill acc">{m.kind}</span></li>) : <li className="note">Add competitors on the Admin page.</li>}</ul></div>
        <div className="card s12"><h3>Recent agent runs</h3><ul className="list">{(runs || []).length ? runs!.map(r => <li key={r.id}><div className="grow"><b>{r.occasion}</b><span className="sm">Started {new Date(r.started_at).toLocaleString('en-IN')}</span></div><span className={`pill ${r.status === 'failed' ? 'bad' : r.status === 'waiting' ? 'acc' : ''}`}>{r.status === 'waiting' ? 'with the heads' : `${r.status} · ${r.stage}`}</span></li>) : <li className="note">No runs visible to you yet.</li>}</ul></div>
      </div>
    </div>
  );
}
