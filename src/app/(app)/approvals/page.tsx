import { requireUser } from '@/lib/auth/session';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';
import { decideReport, decideApproval } from './actions';
import { Icon } from '@/components/Icon';
import { Submit } from '@/components/forms';
import type { Proposal } from '@/lib/agents/campaign';
import { PageHead, Tile, Avatar, Stepper, Pager, pageOf, rangeOf, inr, when } from '@/components/ui';

export const maxDuration = 300; // publishing to Meta happens in the approve action

type Step = { role: AppRole; decision: string; note: string | null };

const REPORTS = 10, PLANS = 6, DECIDED = 10;

/** Where a plan stands for me: who signs next, and whether that is me. */
function standing(p: { status: string; required_roles: unknown; approval_steps: unknown }, role: AppRole) {
  const steps = p.approval_steps as Step[], approved = new Set(steps.filter(s => s.decision === 'approve').map(s => s.role));
  const headsLeft = (p.required_roles as AppRole[]).filter(r => !approved.has(r));
  const next: AppRole[] = p.status !== 'pending' ? [] : headsLeft.length ? headsLeft : ['super_admin'];
  return { steps, approved, next, mine: next.includes(role) && (role !== 'super_admin' || headsLeft.length === 0) };
}

export default async function Approvals({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { db, role } = await requireUser();
  const sp = await searchParams, rp = pageOf(sp, 'rp'), pp = pageOf(sp, 'pp'), dp = pageOf(sp, 'dp');
  const [r0, r1] = rangeOf(rp, REPORTS), [p0, p1] = rangeOf(pp, PLANS), [d0, d1] = rangeOf(dp, DECIDED);
  // Row-level security: heads only get their own departments' forwarded reports and the plans that touch them.
  // Each list is read one page at a time; the tiles come from counts, not from loading everything.
  const reportCols = 'id, department_id, author_agent, lead_agent, title, body, status, lead_note, head_note, revision, updated_at';
  const [{ data: myReports, count: myCount }, { data: doneReports, count: doneCount }, { data: plans, count: planCount }, { data: pending }, { count: live }, { data: agents }, { data: depts }] = await Promise.all([
    db.from('reports').select(reportCols, { count: 'exact' }).eq('status', 'with_head').order('updated_at', { ascending: false }).range(r0, r1),
    db.from('reports').select(reportCols, { count: 'exact' }).in('status', ['accepted', 'sent_back', 'rejected']).order('updated_at', { ascending: false }).range(d0, d1),
    db.from('approvals').select('id, status, version, required_roles, created_at, approval_steps(role, decision, note), campaigns(id, name, occasion, plan, budget_daily, channels, creatives(id, kind, language, headline, body, image_path))', { count: 'exact' }).order('created_at', { ascending: false }).range(p0, p1),
    db.from('approvals').select('id, status, required_roles, approval_steps(role, decision)').eq('status', 'pending').limit(500),
    db.from('approvals').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    db.from('agents').select('id, name, department_id'), db.from('departments').select('id, name'),
  ]);
  const A = Object.fromEntries((agents || []).map(a => [a.id, a.name])), AD = Object.fromEntries((agents || []).map(a => [a.id, a.department_id])), D = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  const paths = (plans || []).flatMap(p => ((p.campaigns as any)?.creatives || []).map((c: any) => c.image_path).filter(Boolean));
  const signed = paths.length ? (await db.storage.from('creatives').createSignedUrls(paths, 3600)).data || [] : [];
  const url = (p: string) => signed.find(s => s.path === p)?.signedUrl ?? undefined;

  const view = (plans || []).map(p => ({ p, c: p.campaigns as any, ...standing(p, role) }));
  const minePlans = (pending || []).filter(p => standing(p, role).mine).length;
  return (
    <div className="page">
      {sp.error && <p className="flash">{sp.error}</p>}
      <PageHead title="Approvals" sub="Reports reach you only after your department's AI team lead has checked them. Plans go from the AI CMO to the heads they touch, then to the Super Admin, who alone can publish." />

      <section className="tiles" aria-label="Summary">
        <Tile icon="doc" label="Reports waiting on you" value={myCount || 0} sub={myCount ? 'Checked by an AI team lead' : 'All caught up'} />
        <Tile icon="check" tone="amber" label="Plans waiting on you" value={minePlans} sub={`${(pending || []).length} in sign-off`} />
        <Tile icon="rocket" tone="blue" label="Campaigns live" value={live || 0} sub="Published to Meta" />
        <Tile icon="clock" tone="violet" label="Decided recently" value={doneCount || 0} sub="Reports accepted, sent back or rejected" />
      </section>

      <nav className="chips" aria-label="Sections"><a href="#reports">Reports <b>{myCount || 0}</b></a><a href="#plans">Campaign plans <b>{planCount || 0}</b></a>{(doneCount || 0) > 0 && <a href="#decided">Decided</a>}</nav>

      <section id="reports" className="section">
        <h2 className="section-title">Reports waiting on you</h2>
        {myReports?.length ? myReports.map(r => (
          <article key={r.id} className="card report">
            <header className="report-head">
              <Avatar name={A[r.author_agent] || r.author_agent} dept={r.department_id} size={44} />
              <div className="grow"><h3 className="title">{r.title}</h3>
                <p className="sub">From <b>{A[r.author_agent]}</b> · {D[r.department_id]} · {when(r.updated_at)}{r.revision > 1 ? ` · revision ${r.revision}` : ''}</p></div>
              <span className="pill acc">{D[r.department_id]}</span>
            </header>
            {r.lead_note && <blockquote className="lead-note"><Avatar name={A[r.lead_agent!] || 'Lead'} dept={AD[r.lead_agent!] || r.department_id} size={28} /><div><b>{A[r.lead_agent!]} <span>AI team lead</span></b><p>{r.lead_note}</p></div></blockquote>}
            <details className="report-body" open><summary>Report</summary><p>{r.body}</p></details>
            <form action={decideReport} className="decide">
              <input type="hidden" name="id" value={r.id} />
              <textarea className="in" name="note" placeholder="Note for the team lead (needed to send back or reject)" aria-label="Note" />
              <div className="decide-btns"><Submit ghost name="decision" value="reject" pending="Rejecting…">Reject</Submit><Submit ghost name="decision" value="send_back" pending="Sending back…">Send back</Submit><Submit name="decision" value="accept" icon="check" pending="Accepting…">Accept</Submit></div>
            </form>
          </article>
        )) : <div className="empty"><Icon name="doc" size={26} /><p>No reports waiting on you.</p></div>}
        <Pager sp={sp} param="rp" page={rp} size={REPORTS} total={myCount} shown={(myReports || []).length} anchor="reports" />
      </section>

      <section id="plans" className="section">
        <h2 className="section-title">Campaign plans</h2>
        {view.length ? view.map(({ p, c, steps, approved, next, mine }) => {
          const chain: AppRole[] = [...(p.required_roles as AppRole[]), 'super_admin'];
          const banner = c.creatives?.find((x: any) => x.image_path);
          const bad = steps.filter(s => s.decision !== 'approve');
          return (
            <article key={p.id} className="card plan">
              <div className="plan-art">{banner && url(banner.image_path) ? <img src={url(banner.image_path)} alt={`Banner for ${c.name}`} loading="lazy" decoding="async" /> : <div className="empty"><Icon name="spark" size={26} /><p>No banner image</p></div>}</div>
              <div className="plan-main">
                <header className="report-head"><div className="grow"><span className="pill acc">{c.occasion}</span><h3 className="title">{c.name}{p.version > 1 ? ` · v${p.version}` : ''}</h3></div>
                  <span className={`pill ${p.status === 'published' ? 'good' : p.status === 'pending' ? 'warn' : p.status === 'approved' ? 'acc' : 'bad'}`}>{p.status === 'published' ? 'Live' : p.status === 'pending' ? (mine ? 'Needs you' : 'In sign-off') : p.status === 'changes' ? 'Changes requested' : p.status}</span></header>
                <div className="facts">
                  <div><small>Daily budget</small><b>{inr(Number(c.budget_daily))}</b></div>
                  <div><small>Runs for</small><b>{c.plan.days} days</b></div>
                  <div><small>Total</small><b>{inr(Number(c.budget_daily) * Number(c.plan.days || 0))}</b></div>
                  <div><small>Channels</small><b>{c.channels.join(', ')}</b></div>
                </div>
                {c.plan.split && <p className="sub">{c.plan.split}</p>}
                {c.plan.report ? <ProposalReport r={c.plan.report} />
                  : (c.plan.reasons || []).length > 0 && <ul className="reasons">{c.plan.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>}
                {c.plan.ai_review && <blockquote className="lead-note"><Avatar name="CMO AI" dept="board" size={28} /><div><b>AI CMO <span>reviewed the plan</span></b><p>{c.plan.ai_review}</p></div></blockquote>}
                {c.creatives?.length > 0 && <div className="copy">{c.creatives.map((x: any) => <p key={x.id}><span className="pill">{x.language.toUpperCase()}</span> <b>{x.headline}</b> {x.body}</p>)}</div>}
                <h4 className="eyebrow">Sign-off</h4>
                <Stepper steps={[{ label: 'AI CMO', state: 'done' }, ...chain.map(r => ({
                  label: ROLE_LABEL[r],
                  state: (r === 'super_admin' ? ['approved', 'published'].includes(p.status) : approved.has(r)) ? 'done' as const
                    : bad.some(s => s.role === r) ? 'bad' as const : next.includes(r) ? 'now' as const : 'todo' as const,
                }))]} />
                {bad.map(s => <p key={s.role} className="flag"><b>{s.decision === 'changes' ? 'Changes requested' : 'Rejected'} by {ROLE_LABEL[s.role]}:</b> {s.note}</p>)}
                {mine ? (
                  <form action={decideApproval} className="decide">
                    <input type="hidden" name="id" value={p.id} />
                    <textarea className="in" name="note" placeholder="Note for the team (needed to request changes or reject)" aria-label="Note" />
                    <div className="decide-btns"><Submit ghost name="decision" value="reject" pending="Rejecting…">Reject</Submit><Submit ghost name="decision" value="changes" pending="Sending…">Request changes</Submit><Submit name="decision" value="approve" icon={role === 'super_admin' ? 'rocket' : 'check'} pending={role === 'super_admin' ? 'Approving and publishing…' : 'Approving…'}>{role === 'super_admin' ? 'Approve and publish' : 'Approve'}</Submit></div>
                  </form>
                ) : p.status === 'pending' && <p className="sub">Waiting on {next.map(r => ROLE_LABEL[r]).join(', ')}.</p>}
              </div>
            </article>
          );
        }) : <div className="empty"><Icon name="check" size={26} /><p>No plans yet. Start a campaign from the Admin page.</p></div>}
        <Pager sp={sp} param="pp" page={pp} size={PLANS} total={planCount} shown={view.length} anchor="plans" />
      </section>

      {(doneReports || []).length > 0 && <section id="decided" className="section">
        <h2 className="section-title">Recent report decisions</h2>
        <ul className="card rows">{doneReports!.map(r => (
          <li key={r.id}><Avatar name={A[r.author_agent] || r.author_agent} dept={r.department_id} /><div className="grow"><b className="clip">{r.title}</b><span className="sm">{D[r.department_id]}{r.head_note ? ` · ${r.head_note}` : ''}</span></div>
            <span className={`pill ${r.status === 'accepted' ? 'good' : r.status.includes('reject') ? 'bad' : 'warn'}`}>{r.status.replace(/_/g, ' ')}</span></li>
        ))}</ul>
        <Pager sp={sp} param="dp" page={dp} size={DECIDED} total={doneCount} shown={(doneReports || []).length} anchor="decided" />
      </section>}
    </div>
  );
}

/** Why, for what, the data behind it, how it runs, and what it should bring in, so a head can decide without asking. */
function ProposalReport({ r }: { r: Proposal }) {
  const m = r.impact;
  return (
    <details className="proposal" open>
      <summary>Proposal report</summary>
      <div className="facts impact">
        <div><small>Budget</small><b>{inr(m.budget_total)}</b></div>
        <div><small>Expected sales</small><b>{m.revenue_low != null ? `${inr(m.revenue_low)} to ${inr(m.revenue_high!)}` : 'Not enough data'}</b></div>
        <div><small>Return on ad spend</small><b>{m.roas_basis != null ? `${m.roas_basis.toFixed(1)}x` : '–'}</b></div>
        <div><small>Pieces, about</small><b>{m.units ?? '–'}</b></div>
      </div>
      <p className="sm basis">{m.basis}</p>
      <dl className="prop">
        <dt>Why now</dt><dd>{r.why}</dd>
        <dt>What it is for</dt><dd>{r.goal}</dd>
        {r.data_used.length > 0 && <><dt>Based on</dt><dd><ul className="datalist">{r.data_used.map((d, i) => <li key={i}><span className="pill">{d.source}</span>{d.finding}</li>)}</ul></dd></>}
        {r.how.length > 0 && <><dt>How it runs</dt><dd><ol>{r.how.map((h, i) => <li key={i}>{h}</li>)}</ol></dd></>}
        {r.risks.length > 0 && <><dt>Risks</dt><dd><ul>{r.risks.map((h, i) => <li key={i}>{h}</li>)}</ul></dd></>}
        {r.measure && <><dt>How we will judge it</dt><dd>{r.measure}</dd></>}
      </dl>
    </details>
  );
}
