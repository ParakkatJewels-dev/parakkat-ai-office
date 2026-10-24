import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';
import { scorecards, myDepartments, ago } from '@/lib/agents/scorecard';
import { FORMATS } from '@/lib/agents/design';
import { Icon, type IconName } from '@/components/Icon';
import { PageHead, Tile, Avatar, Pager, pageOf, rangeOf, inr, when } from '@/components/ui';

const KIND: Record<string, [IconName, string]> = {
  think: ['spark', 'Working on'], say: ['doc', 'Said'], walk: ['arrow', 'Handed over'], feedback: ['clock', 'Feedback'],
  report: ['check', 'Forwarded'], approval: ['check', 'Approval'], live: ['rocket', 'Went live'],
};
const REPORT: Record<string, [string, string]> = {
  lead_review: ['With the team lead', ''], revise: ['Being revised', 'warn'], rejected_by_lead: ['Stopped by the team lead', 'bad'],
  with_head: ['Waiting on the head', 'warn'], accepted: ['Accepted', 'good'], sent_back: ['Sent back', 'bad'], rejected: ['Rejected', 'bad'],
};

const FEED = 25, REPORTS = 8;

export default async function AgentReport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams, ep = pageOf(sp, 'ep'), rp = pageOf(sp, 'rp'), [e0] = rangeOf(ep, FEED), [r0, r1] = rangeOf(rp, REPORTS);
  const { db, role } = await requireUser();
  const { data: agent } = await db.from('agents').select('id, name, role_desc, department_id, is_lead, model').eq('id', id).maybeSingle();
  if (!agent) notFound();
  const depts = await myDepartments(db, role), dept = depts.find(d => d.id === agent.department_id);
  if (!dept) redirect('/agents');
  const { data: lead } = dept.ai_lead_agent ? await db.from('agents').select('id, name').eq('id', dept.ai_lead_agent).maybeSingle() : { data: null };
  // the feed reads one row past the page to know if there is more, which is cheaper than counting a big event log
  const [{ cards, campaigns }, { data: feed }, { data: reports, count: reportCount }, { data: names }, { data: lessons }] = await Promise.all([
    scorecards(db, [id]),
    db.from('agent_events').select('id, at, kind, text, run_id, from_agent, to_agent').or(`from_agent.eq.${agent.id},to_agent.eq.${agent.id}`).order('at', { ascending: false }).range(e0, e0 + FEED),
    db.from('reports').select('id, title, body, status, lead_note, head_note, revision, updated_at', { count: 'exact' }).eq('author_agent', agent.id).order('updated_at', { ascending: false }).range(r0, r1),
    db.from('agents').select('id, name'),
    db.from('lessons').select('id, lesson, decision, created_at').eq('department_id', agent.department_id).eq('active', true).order('created_at', { ascending: false }).limit(8),
  ]);
  const c = cards[id], N = Object.fromEntries((names || []).map(n => [n.id, n.name]));
  const evs = (feed || []).slice(0, FEED), moreFeed = (feed || []).length > FEED;
  const camps = campaigns.filter(k => k.agent_id === id);
  const formats = Object.entries(FORMATS).filter(([, f]) => f.maker === id).map(([k]) => k);
  const { data: designs } = formats.length ? await db.from('designs').select('id, format, brief, image_path, status').in('format', formats).not('image_path', 'is', null).order('created_at', { ascending: false }).limit(6) : { data: [] };
  const signed = (designs || []).length ? (await db.storage.from('creatives').createSignedUrls(designs!.map(d => d.image_path!), 3600)).data || [] : [];
  const state = c.state === 'now' ? ['Working now', 'good'] : c.state === 'today' ? ['Active today', 'acc'] : ['Quiet', ''];

  return (
    <div className="page">
      <Link href="/agents" className="back"><Icon name="arrow" size={16} />All agents</Link>
      <header className="agent-hero card">
        <Avatar name={agent.name} dept={agent.department_id} size={64} />
        <div className="grow">
          <h1>{agent.name} <span className={`pill ${state[1]}`}><i className={`live-dot ${c.state}`} />{state[0]}</span></h1>
          <p className="sub">{agent.is_lead ? 'AI team lead of ' : ''}{dept.name} · {agent.role_desc}</p>
          {c.last && <p className="agent-now">Latest: {c.last.text}<time> · {ago(c.last.at)}</time></p>}
        </div>
        <div className="facts hero-facts">
          <div><small>Team lead</small><b>{agent.is_lead ? 'Leads this team' : lead?.name || '–'}</b></div>
          <div><small>Reports to</small><b>{ROLE_LABEL[dept.human_head_role as AppRole]}</b></div>
          <div><small>Runs on</small><b>{agent.model}</b></div>
        </div>
        <Link href={`/office?focus=${agent.id}`} className="btn ghost"><Icon name="map" size={18} />Find in the office</Link>
      </header>

      <section className="tiles" aria-label="Last 30 days">
        <Tile icon="spark" label="Actions" value={c.actions} sub="Last 30 days" />
        <Tile icon="doc" tone="blue" label="Reports that reached a head" value={c.forwarded} sub={c.forwarded ? `${c.accepted} accepted (${Math.round((c.accepted / c.forwarded) * 100)}%)` : `${c.reports} filed`} />
        <Tile icon="rocket" tone="amber" label={c.designs ? 'Designs made' : 'Campaigns worked on'} value={c.designs || c.runs} sub={c.designs ? 'From the Design Studio' : `${c.live} live now`} />
        <Tile icon="rupee" tone="violet" label="Revenue from their live campaigns" value={inr(c.revenue)} sub={c.spend ? `${inr(c.spend)} spent · ${(c.revenue / c.spend).toFixed(1)}x return` : 'Shared credit, Meta results'} />
      </section>

      <div className="bento">
        <section className="card s6" id="feed">
          <div className="card-head"><div><h3>What they have been doing</h3><p className="sub">Newest first</p></div></div>
          {evs.length ? <ol className="feed">{evs.map(e => {
            const [ic, label] = KIND[e.kind] || ['doc', e.kind], incoming = e.to_agent === id && e.from_agent !== id;
            return <li key={e.id}><span className={`feed-ic k-${e.kind}`}><Icon name={ic} size={15} /></span><div>
              <span className="sm">{incoming ? `From ${N[e.from_agent!] || 'a head'}` : label}{!incoming && e.to_agent ? ` → ${N[e.to_agent] || e.to_agent}` : ''} · {ago(e.at)}</span>
              <p>{e.text}</p></div></li>;
          })}</ol> : <div className="empty"><Icon name="clock" size={26} /><p>Nothing yet.</p></div>}
          <Pager sp={sp} param="ep" page={ep} size={FEED} hasMore={moreFeed} shown={evs.length} anchor="feed" />
        </section>

        <section className="card s6" id="reports">
          <div className="card-head"><div><h3>Reports</h3><p className="sub">{role === 'super_admin' ? 'Including the ones their team lead stopped' : 'The ones their team lead forwarded to you'}</p></div></div>
          {(reports || []).length ? <ul className="rows">{reports!.map(r => {
            const [label, tone] = REPORT[r.status] || [r.status, ''];
            return <li key={r.id} className="report-row"><div className="grow">
              <div className="conn-top"><b>{r.title}</b><span className={`pill ${tone}`}>{label}</span></div>
              <span className="sm">{when(r.updated_at)}{r.revision > 1 ? ` · revision ${r.revision}` : ''}</span>
              {r.lead_note && <p className="note-line"><b>Team lead:</b> {r.lead_note}</p>}
              {r.head_note && <p className="note-line"><b>Head:</b> {r.head_note}</p>}
              <details className="report-body"><summary>Read it</summary><p>{r.body}</p></details>
            </div></li>;
          })}</ul> : <div className="empty"><Icon name="doc" size={26} /><p>No reports visible to you.</p></div>}
          <Pager sp={sp} param="rp" page={rp} size={REPORTS} total={reportCount} shown={(reports || []).length} anchor="reports" />
        </section>

        <section className="card s12">
          <div className="card-head"><div><h3>What this team has learned</h3><p className="sub">Notes from the heads&apos; decisions, the team lead&apos;s rejections, and Parakkat&apos;s own results and analytics, added automatically. {agent.name} reads these, and the brand book, before every job.</p></div></div>
          {(lessons || []).length ? <ul className="rows lessons">{lessons!.map(l => <li key={l.id}><span className={`pill ${['accepted', 'approve', 'worked'].includes(l.decision || '') ? 'good' : l.decision === 'data' ? 'acc' : 'warn'}`}>{l.decision === 'data' ? 'analytics' : l.decision ? l.decision.replace(/_/g, ' ') : 'note'}</span><div className="grow"><span>{l.lesson}</span><span className="sm">{when(l.created_at)}</span></div></li>)}</ul>
            : <p className="sub">Nothing yet. When you accept, send back or reject this team&apos;s work with a note, it becomes a lesson here.</p>}
        </section>

        {camps.length > 0 && <section className="card s12">
          <div className="card-head"><div><h3>Campaigns they worked on</h3><p className="sub">Results come from Meta once a campaign is live</p></div></div>
          <div className="tablewrap"><table className="table">
            <thead><tr><th>Campaign</th><th>Status</th><th className="r">Spend</th><th className="r">Revenue</th><th className="r">Return</th></tr></thead>
            <tbody>{camps.map(k => { const r = { spend: Number(k.spend), revenue: Number(k.revenue) }; return <tr key={k.campaign_id}><td><b>{k.name}</b></td><td><span className={`pill ${k.status === 'live' ? 'good' : 'warn'}`}>{k.status.replace('_', ' ')}</span></td>
              <td className="r num">{r.spend ? inr(r.spend) : '–'}</td><td className="r num">{r.revenue ? inr(r.revenue) : '–'}</td><td className="r num">{r.spend ? `${(r.revenue / r.spend).toFixed(1)}x` : '–'}</td></tr>; })}</tbody>
          </table></div>
        </section>}

        {(designs || []).length > 0 && <section className="card s12">
          <div className="card-head"><div><h3>Recent designs</h3><p className="sub">More in the Design Studio</p></div><Link href="/studio" className="btn ghost sm-btn">Open the studio</Link></div>
          <ul className="thumbs">{designs!.map(d => { const u = signed.find(s => s.path === d.image_path)?.signedUrl; return <li key={d.id}>{u && <img src={u} alt={d.brief} loading="lazy" decoding="async" />}<span className="sm clip">{d.brief}</span></li>; })}</ul>
        </section>}
      </div>
    </div>
  );
}
