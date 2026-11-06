import Link from 'next/link';
import presentation from './Approvals.module.css';
import { ApprovalAnchor } from './ApprovalAnchor';
import { requireUser } from '@/lib/auth/session';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';
import { decideReport, decideApproval, requestCampaignReview, decideDesign } from './actions';
import { campaignReviewState } from './approval-ui.mjs';
import { redesign } from '../studio/actions';
import { Refresher } from '@/components/Refresher';
import { Icon } from '@/components/Icon';
import { Submit } from '@/components/forms';
import { Markdown } from '@/components/Markdown';
import { DecisionNote } from '@/components/DecisionNote';
import type { Proposal } from '@/lib/agents/campaign';
import { UUID } from '@/lib/automation/core.mjs';
import { publicationBlock } from '@/lib/agents/publish-core.mjs';
import { PageHead, Avatar, Stepper, Pager, pageOf, rangeOf, inr, when } from '@/components/ui';

export const maxDuration = 300; // publishing to Meta happens in the approve action

type Step = { role: AppRole; decision: string; note: string | null };

const REPORTS = 12, PLANS = 6, DECIDED = 10;
// The seven status words used everywhere.
const DESIGNS = 20;
type DesignAsk = { id: string; source: string; image_path: string; title: string; status: 'pending' | 'approved' | 'changes' | 'rejected'; requested_role: AppRole; request_note: string | null; decision_note: string | null; decided_at: string | null; created_at: string };
const DESIGN_WORD = { approved: ['Approved', 'good'], changes: ['Sent back', 'warn'], rejected: ['Rejected', 'bad'] } as const;
const REPORT_WORD: Record<string, string> = { with_head: 'Needs you', accepted: 'Approved', sent_back: 'Sent back', rejected: 'Rejected', lead_review: 'AI review', revise: 'Working', rejected_by_lead: 'Rejected' };

// Reports are grouped by the day they reached the head, in India time.
const istDay = (at: string) => new Date(at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
function dayLabel(day: string, today: string) {
  const diff = Math.round((Date.parse(today) - Date.parse(day)) / 864e5), d = new Date(`${day}T12:00:00Z`);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return diff === 0 ? `Today · ${date}` : diff === 1 ? `Yesterday · ${date}` : diff < 7 ? `${d.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })} · ${date}` : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const clock = (at: string) => new Date(at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

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
  const reportCols = 'id, automation_task_id, department_id, author_agent, lead_agent, title, body, status, lead_note, head_note, revision, updated_at';
  const requestedReport=typeof sp.report==='string'&&UUID.test(sp.report)?sp.report:null;
  const requestedCampaign=typeof sp.campaign==='string'&&UUID.test(sp.campaign)?sp.campaign:null;
  const requestedDesign=typeof sp.design==='string'&&UUID.test(sp.design)?sp.design:null;
  const section = requestedCampaign ? 'plans' : requestedReport ? 'reports' : requestedDesign ? 'designs' : ['plans','decided','designs'].includes(sp.tab || '') ? sp.tab! : 'reports';
  const sectionHref=(tab:string)=>{const params=new URLSearchParams(); for(const [key,value] of Object.entries(sp)) if(value && !['tab','report','campaign','design','error','msg'].includes(key))params.set(key,value); params.set('tab',tab);return `/approvals?${params}`;};
  const planCols='id, status, version, quality_snapshot, required_roles, created_at, approval_steps(role, decision, note), campaigns(id, name, status, occasion, plan, budget_daily, channels, external_ids, creatives(id, kind, language, headline, body, image_path, art_status, art_error, versions, review_note))';
  // Studio designs sent for sign-off. The Super Admin sees all of them, a head the ones they sent.
  // Until the design-approval database update is applied these error, and the tab says so.
  const designCols = 'id, source, image_path, title, status, requested_role, request_note, decision_note, decided_at, created_at';
  const [{ data: myReports, count: myCount }, { data: doneReports, count: doneCount }, { data: plans, count: planCount }, { data: pending }, { data: agents }, { data: depts }, {data: focusedReport}, {data: focusedPlan}, designWait, designOpen, designDone] = await Promise.all([
    db.from('reports').select(reportCols, { count: 'exact' }).eq('status', 'with_head').order('updated_at', { ascending: false }).range(r0, r1),
    db.from('reports').select(reportCols, { count: 'exact' }).in('status', ['accepted', 'sent_back', 'rejected']).order('updated_at', { ascending: false }).range(d0, d1),
    db.from('approvals').select(planCols, { count: 'exact' }).eq('status','pending').order('created_at', { ascending: false }).range(p0, p1),
    db.from('approvals').select('id, status, required_roles, approval_steps(role, decision)').eq('status', 'pending').limit(500),
    db.from('agents').select('id, name, department_id'), db.from('departments').select('id, name'),
    requestedReport?db.from('reports').select(reportCols).eq('id',requestedReport).maybeSingle():Promise.resolve({data:null}),
    requestedCampaign?db.from('approvals').select(planCols).eq('campaign_id',requestedCampaign).order('version',{ascending:false}).limit(1).maybeSingle():Promise.resolve({data:null}),
    db.from('design_approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    section === 'designs' ? db.from('design_approvals').select(designCols).eq('status', 'pending').order('created_at', { ascending: true }).limit(DESIGNS) : Promise.resolve({ data: [], error: null }),
    section === 'designs' ? db.from('design_approvals').select(designCols).neq('status', 'pending').order('decided_at', { ascending: false }).limit(DESIGNS) : Promise.resolve({ data: [], error: null }),
  ]);
  const designsOff = !!designWait.error;
  const waitingDesigns = (designOpen.data || []) as DesignAsk[], decidedDesigns = (designDone.data || []) as DesignAsk[];
  const designPaths = [...waitingDesigns, ...decidedDesigns].map(d => d.image_path);
  const designSigned = designPaths.length ? (await db.storage.from('creatives').createSignedUrls(designPaths, 3600)).data || [] : [];
  const designUrl = (path: string) => designSigned.find(s => s.path === path)?.signedUrl ?? undefined;
  const openDesignId = sp.design === 'none' ? null : requestedDesign || waitingDesigns[0]?.id || null;
  const A = Object.fromEntries((agents || []).map(a => [a.id, a.name])), D = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  const displayPlans=focusedPlan?[focusedPlan,...(plans||[]).filter(plan=>plan.id!==focusedPlan.id)]:(plans||[]);
  const paths = displayPlans.flatMap(p => ((p.campaigns as any)?.creatives || []).map((c: any) => c.image_path).filter(Boolean));
  const signed = paths.length ? (await db.storage.from('creatives').createSignedUrls(paths, 3600)).data || [] : [];
  const url = (p: string) => signed.find(s => s.path === p)?.signedUrl ?? undefined;

  const view = displayPlans.filter(p=>p.campaigns).map(p => ({ p, c: p.campaigns as any, ...standing(p, role) }));
  const minePlans = (pending || []).filter(p => standing(p, role).mine).length;
  const displayReports=focusedReport?[focusedReport,...(myReports||[]).filter(report=>report.id!==focusedReport.id)]:(myReports||[]);
  const selectedReport=sp.report==='none'?null:displayReports[0];
  const openPlanId=sp.campaign==='none'?null:view[0]?.p.id;
  const today=istDay(new Date().toISOString());
  const reportDays=[...new Set(displayReports.map(r=>istDay(r.updated_at)))].map(day=>({day,label:dayLabel(day,today),rows:displayReports.filter(r=>istDay(r.updated_at)===day)}));
  const pageQ=rp>1?`&rp=${rp}`:'';
  return (
    <div className={`page ${presentation.page}`}><ApprovalAnchor/>
      {sp.error && <p className="flash" role="alert">{sp.error}</p>}
      {sp.msg && <p className="flash ok" role="status">{sp.msg}</p>}
      <Refresher active={view.some(v => (v.c?.creatives || []).some((x: any) => ['queued', 'making'].includes(x.art_status)))}>A banner is being redesigned in the background. This page updates on its own.</Refresher>
      <PageHead title="Inbox" sub="Everything the team needs you to decide. Read the summary, then accept, send back or reject." />

      <nav className="tabs" aria-label="Inbox sections">
        <Link href={sectionHref('reports')} className={section==='reports'?'on':''} aria-current={section==='reports'?'page':undefined}><Icon name="doc" size={16}/>Reports{(myCount || 0) > 0 && <span className={`pill ${role === 'super_admin' ? '' : 'needs'}`}>{myCount}</span>}</Link>
        <Link href={sectionHref('plans')} className={section==='plans'?'on':''} aria-current={section==='plans'?'page':undefined}><Icon name="rocket" size={16}/>Campaign plans{minePlans > 0 && <span className="pill needs">{minePlans}</span>}</Link>
        {!designsOff && <Link href={sectionHref('designs')} className={section==='designs'?'on':''} aria-current={section==='designs'?'page':undefined}><Icon name="spark" size={16}/>Designs{(designWait.count || 0) > 0 && <span className={`pill ${role === 'super_admin' ? 'needs' : ''}`}>{designWait.count}</span>}</Link>}
        <Link href={sectionHref('decided')} className={section==='decided'?'on':''} aria-current={section==='decided'?'page':undefined}><Icon name="check" size={16}/>Decided</Link>
      </nav>

      {section==='reports' && <section id="reports" className="section">
        <h2 className="sr-only">Reports waiting on you</h2>
        {requestedReport&&!focusedReport&&<p className="sub">That report isn’t available: it may belong to another team.</p>}
        {displayReports.length ? <div className={`card ${presentation.list}`}>
          {reportDays.map(group => <div key={group.day} role="group" aria-label={group.label}>
            <p className={presentation.day}>{group.label}</p>
            {group.rows.map(r => {
              const open = selectedReport?.id === r.id;
              const pill = <span className={`pill ${r.status==='with_head'?(role==='super_admin'?'':'needs'):r.status==='accepted'?'good':r.status==='rejected'?'bad':'warn'}`}>{r.status==='with_head'&&role==='super_admin'?'With the team head':REPORT_WORD[r.status]||r.status.replaceAll('_',' ')}</span>;
              return <div key={r.id} id={`report-${r.id}`} className={open ? presentation.rowOpen : undefined}>
                <Link href={open ? `/approvals?tab=reports&report=none${pageQ}` : `/approvals?tab=reports&report=${r.id}${pageQ}#report-${r.id}`} className={presentation.row} aria-expanded={open}>
                  <Avatar name={A[r.author_agent] || r.author_agent} dept={r.department_id} size={24} />
                  <b className={presentation.rowTitle}>{r.title}</b>
                  <span className={presentation.rowTeam}>{D[r.department_id]}</span>
                  <span className={presentation.rowWhen}>{clock(r.updated_at)}</span>
                  {pill}
                  <Icon name={open ? 'up' : 'down'} size={16} />
                </Link>
                {open && <div className={presentation.openBody}>
                  <div className={presentation.reading}>
                    {r.lead_note && <p className={presentation.leadView}><b>{A[r.lead_agent!] || 'The AI lead'}:</b> {r.lead_note}</p>}
                    <Markdown text={r.body} className={`md ${presentation.reportText}`} />
                    <p className="sub">From {A[r.author_agent] || 'the team'}{r.revision > 1 ? ` · revision ${r.revision}` : ''}{r.automation_task_id && <> · <Link href={`/automations?task=${encodeURIComponent(r.automation_task_id)}`}>See who worked on it</Link></>}</p>
                    {r.status!=='with_head'&&r.head_note&&<p className="note-line"><b>Your team’s note:</b> {r.head_note}</p>}
                  </div>
                  {r.status==='with_head'&&<form action={decideReport} className={`decide ${presentation.decideCol}`}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="revision" value={r.revision} />
                    <DecisionNote id={`report-note-${r.id}`} storageKey={`report:${r.id}:${r.revision}`} label="Note to the team" placeholder="Note (needed to send back or reject)" />
                    <div className="decide-btns"><Submit ghost danger confirm="Reject this report? The team gets your note and the report is closed." confirmTitle="Reject this report?" confirmLabel="Reject report" name="decision" value="reject" pending="Rejecting…">Reject</Submit><Submit ghost name="decision" value="send_back" pending="Sending back…">Send back</Submit><Submit name="decision" value="accept" icon="check" pending="Accepting…">Accept</Submit></div>
                  </form>}
                </div>}
              </div>;
            })}
          </div>)}
          {(myCount || 0) > REPORTS && <div className={presentation.listFoot}><Pager sp={{...sp,report:undefined}} param="rp" page={rp} size={REPORTS} total={myCount} shown={(myReports || []).length} anchor="reports" /></div>}
        </div> : <div className="empty"><Icon name="doc" size={20} /><p>No reports wait on you.</p></div>}
      </section>}

      {section==='plans' && <section id="plans" className="section">
        <h2 className="sr-only">Campaign plans</h2>
        {requestedCampaign&&!focusedPlan&&<p className="sub">The selected campaign has no approval available within your current access. Its plan may not have reached human review yet.</p>}
        {view.length ? view.map(({ p, c, steps, approved, next, mine }) => {
          const chain: AppRole[] = [...(p.required_roles as AppRole[]), 'super_admin'];
          const banner = c.creatives?.find((x: any) => x.image_path || x.art_status) || c.creatives?.find((x: any) => x.kind === 'banner');
          const drawing = ['queued', 'making'].includes(banner?.art_status);
          const bad = steps.filter(s => s.decision !== 'approve');
          const publishBlock = publicationBlock(c);
          const quality = campaignReviewState(p,c,role);
          const manual = c.channels.includes('google');
          if (p.id !== openPlanId) return <Link key={p.id} href={`/approvals?tab=plans&campaign=${c.id}#campaign-${c.id}`} className={`card ${presentation.planRow}`} aria-expanded={false}>
            <span className="pill acc">{c.occasion}</span><b className={presentation.rowTitle}>{c.name}{p.version > 1 ? ` · v${p.version}` : ''}</b>
            <span className={presentation.rowTeam}>{inr(Number(c.budget_daily))} a day · {c.plan.days} days</span>
            <span className={`pill ${mine ? 'needs' : 'info'}`}>{mine ? 'Needs you' : 'Waiting on others'}</span><Icon name="down" size={16} />
          </Link>;
          return (
            <article key={p.id} id={p.id===focusedPlan?.id?`campaign-${c.id}`:`approval-${p.id}`} className="card plan">
              <div className="plan-art" id={`art-${p.id}`}>
                <div className="art-box">{banner && url(banner.image_path) ? <img src={url(banner.image_path)} alt={`Banner for ${c.name}`} loading="lazy" decoding="async" /> : <div className="empty"><Icon name="spark" size={26} /><p>{drawing ? 'Designing the banner…' : 'No banner image'}</p></div>}
                  {drawing && banner?.image_path && <span className="redoing"><span className="spin" aria-hidden="true" />Making version {(banner.versions?.length || 0) + 2}</span>}</div>
                {banner?.art_error && !drawing && <p className="sm err">{banner.image_path ? 'The last redesign failed: ' : ''}{banner.art_error.slice(0, 160)}</p>}
                {banner?.review_note && !drawing && !banner.art_error && <p className="sm">AI lead: {banner.review_note}</p>}
                {banner && !drawing && !['approved', 'publishing', 'publish_review', 'live'].includes(c.status) && p.status !== 'published' && (
                  <details className="redo"><summary><Icon name="sync" size={14} />Redesign the banner</summary>
                    <form action={redesign}>
                      <input type="hidden" name="source" value="creative" /><input type="hidden" name="id" value={banner.id} /><input type="hidden" name="back" value={`/approvals?tab=plans${pp > 1 ? `&pp=${pp}` : ''}#art-${p.id}`} />
                      <textarea name="note" className="in" rows={2} maxLength={600} placeholder="What to change (optional). Empty tries a new direction." aria-label="What to change" />
                      <Submit small icon="sync" pending="Starting…">Make a new version</Submit>
                    </form>
                  </details>
                )}
              </div>
              <div className="plan-main">
                <header className="report-head"><div className="grow"><span className="pill acc">{c.occasion}</span><h3 className="title">{c.name}{p.version > 1 ? ` · v${p.version}` : ''}</h3></div><Link href="/approvals?tab=plans&campaign=none" className="btn ghost sm-btn" aria-label="Close this plan"><Icon name="up" size={15} /></Link>
                  <span className={`pill ${p.status === 'published' ? 'live' : p.status === 'pending' ? (mine ? 'needs' : 'info') : p.status === 'approved' ? 'good' : p.status === 'changes' ? 'warn' : 'bad'}`}>{p.status === 'published' ? 'Live' : p.status === 'pending' ? (mine ? 'Needs you' : 'Waiting on others') : p.status === 'changes' ? 'Sent back' : p.status === 'approved' ? 'Approved' : p.status === 'rejected' ? 'Rejected' : p.status}</span></header>
                <section className={presentation.planOverview}>
                  
                  {c.plan.report ? <><p><b>Why now:</b> {c.plan.report.why}</p><p><b>Goal:</b> {c.plan.report.goal}</p></>
                    : (c.plan.reasons || []).length > 0 ? <ul>{c.plan.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
                    : <p>Review the artwork, copy and budget below.</p>}
                </section>
                <div className="facts">
                  <div><small>Daily budget</small><b>{inr(Number(c.budget_daily))}</b></div>
                  <div><small>Runs for</small><b>{c.plan.days} days</b></div>
                  <div><small>Total</small><b>{inr(Number(c.budget_daily) * Number(c.plan.days || 0))}</b></div>
                  <div><small>Channels</small><b>{c.channels.join(', ')}</b></div>
                </div>
                {c.plan.ai_review && <p className={presentation.leadView}><b>AI CMO:</b> {c.plan.ai_review}</p>}
                {c.creatives?.length > 0 && <details className={presentation.signoff}><summary>Ad copy</summary><div className="copy">{c.creatives.map((x: any) => <p key={x.id}><span className="pill">{x.language.toUpperCase()}</span> <b>{x.headline}</b> {x.body}</p>)}</div></details>}
                {c.plan.report && <ProposalReport r={c.plan.report} />}
                <details className={presentation.signoff}><summary>Sign-offs</summary><Stepper steps={[{ label: 'AI CMO', state: 'done' }, ...chain.map(r => ({
                  label: ROLE_LABEL[r],
                  state: (r === 'super_admin' ? ['approved', 'published'].includes(p.status) : approved.has(r)) ? 'done' as const
                    : bad.some(s => s.role === r) ? 'bad' as const : next.includes(r) ? 'now' as const : 'todo' as const,
                }))]} /></details>
                {bad.map(s => <p key={s.role} className="flag"><b>{s.decision === 'changes' ? 'Changes requested' : 'Rejected'} by {ROLE_LABEL[s.role]}:</b> {s.note}</p>)}
                {p.status !== 'published' && publishBlock && <p className="flag">{publishBlock}</p>}
                {p.status==='pending'&&!quality.current&&<div className="flag"><p>This plan needs a new quality review before it can be approved.</p>{quality.canRequest?<form action={requestCampaignReview}><input type="hidden" name="id" value={p.id}/><Submit ghost small icon="sync" pending="Queuing review…">Request quality review</Submit><p className="sm">The team will check the current artwork and copy. Earlier approvals stay with the previous version.</p></form>:<p className="sm">A campaign head or Super Admin can request the review when the plan is eligible.</p>}</div>}
                {mine ? (
                  <form action={decideApproval} className="decide">
                    <input type="hidden" name="id" value={p.id} />
                    <DecisionNote id={`plan-note-${p.id}`} storageKey={`plan:${p.id}`} label="Note to the team" placeholder="Note to the team (needed to request changes or reject)" />
                    <div className="decide-btns"> <Submit ghost danger confirm="Reject this campaign plan? It closes without publishing anything." confirmTitle="Reject this plan?" confirmLabel="Reject plan" name="decision" value="reject" pending="Rejecting…">Reject</Submit><Submit ghost name="decision" value="changes" pending="Sending…">Request changes</Submit><Submit name="decision" value="approve" confirm={role==='super_admin' && !manual ? `Publish ${c.name} to Meta with a daily budget of ${inr(Number(c.budget_daily))}? This creates live ads using the reviewed plan.` : undefined} confirmTitle="Publish this campaign?" confirmLabel="Approve and publish" disabled={!quality.current} icon={role === 'super_admin' && !manual ? 'rocket' : 'check'} pending={role === 'super_admin' && !manual ? 'Approving and publishing…' : 'Approving…'}>{role === 'super_admin' ? manual ? 'Approve for manual launch' : 'Approve and publish' : 'Approve plan'}</Submit></div>
                  </form>
                ) : p.status === 'pending' && <p className="sub">Waiting on {next.map(r => ROLE_LABEL[r]).join(', ')}. Nothing for you to do yet.</p>}
              </div>
            </article>
          );
        }) : <div className="empty"><Icon name="check" size={26} /><p>No campaign plans wait for sign-off. <Link href="/campaigns">Start a campaign</Link></p></div>}
        <Pager sp={sp} param="pp" page={pp} size={PLANS} total={planCount} shown={(plans||[]).length} anchor="plans" />
      </section>}

      {section==='designs' && <section id="designs" className="section">
        <h2 className="sr-only">Designs sent for sign-off</h2>
        {designsOff ? <div className="empty"><Icon name="spark" size={20} /><p>Design sign-off turns on once the latest database update is applied.</p></div>
        : waitingDesigns.length || decidedDesigns.length ? <div className={`card ${presentation.list}`}>
          {[{ label: role === 'super_admin' ? 'Waiting on you' : 'Waiting on the Super Admin', rows: waitingDesigns }, { label: 'Decided', rows: decidedDesigns }].filter(g => g.rows.length).map(group => <div key={group.label} role="group" aria-label={group.label}>
            <p className={presentation.day}>{group.label}</p>
            {group.rows.map(d => {
              const open = openDesignId === d.id, word = d.status === 'pending' ? null : DESIGN_WORD[d.status];
              return <div key={d.id} id={`design-${d.id}`} className={open ? presentation.rowOpen : undefined}>
                <Link href={open ? '/approvals?tab=designs&design=none' : `/approvals?tab=designs&design=${d.id}#design-${d.id}`} className={presentation.row} aria-expanded={open}>
                  <span className={presentation.thumb}>{designUrl(d.image_path) && <img src={designUrl(d.image_path)} alt="" loading="lazy" />}</span>
                  <b className={presentation.rowTitle}>{d.title || 'Studio design'}</b>
                  <span className={presentation.rowTeam}>{ROLE_LABEL[d.requested_role]}</span>
                  <span className={`${presentation.rowWhen} ${presentation.designWhen}`}>{when(d.status === 'pending' ? d.created_at : d.decided_at || d.created_at)}</span>
                  {word ? <span className={`pill ${word[1]}`}>{word[0]}</span> : <span className={`pill ${role === 'super_admin' ? 'needs' : ''}`}>{role === 'super_admin' ? 'Needs you' : 'With Super Admin'}</span>}
                  <Icon name={open ? 'up' : 'down'} size={16} />
                </Link>
                {open && <div className={presentation.openBody}>
                  <div className={presentation.reading}>
                    {designUrl(d.image_path) ? <a className={presentation.designArt} href={designUrl(d.image_path)} target="_blank" rel="noreferrer"><img src={designUrl(d.image_path)} alt={d.title || 'Studio design'} /></a> : <p className="sub">The image could not be loaded. Refresh to try again.</p>}
                    {d.request_note && <p className="note-line"><b>Their note:</b> {d.request_note}</p>}
                    <p className="sub">{d.source === 'design' ? 'Studio order' : 'Campaign banner'} · sent by the {ROLE_LABEL[d.requested_role]} {when(d.created_at)}</p>
                    {d.status !== 'pending' && d.decision_note && <p className="note-line"><b>Super Admin’s note:</b> {d.decision_note}</p>}
                  </div>
                  {d.status === 'pending' && (role === 'super_admin' ? <form action={decideDesign} className={`decide ${presentation.decideCol}`}>
                    <input type="hidden" name="id" value={d.id} />
                    <DecisionNote id={`design-note-${d.id}`} storageKey={`design:${d.id}`} label="Note to the team" placeholder="Note (needed to send back or reject)" />
                    <div className="decide-btns"><Submit ghost danger confirm="Reject this design? The team gets your note." confirmTitle="Reject this design?" confirmLabel="Reject design" name="decision" value="rejected" pending="Rejecting…">Reject</Submit><Submit ghost name="decision" value="changes" pending="Sending back…">Send back</Submit><Submit name="decision" value="approved" icon="check" pending="Approving…">Approve</Submit></div>
                  </form> : <p className={`sub ${presentation.decideCol}`}>Waiting for the Super Admin. You will see the decision here.</p>)}
                </div>}
              </div>;
            })}
          </div>)}
        </div> : <div className="empty"><Icon name="spark" size={20} /><p>{role === 'super_admin' ? 'No designs wait on you. Heads send them from a design’s panel in Studio.' : 'Designs you send for approval from Studio show here with the Super Admin’s decision.'}</p></div>}
      </section>}

      {section==='decided' && <section id="decided" className="section">
        <h2 className="section-title">Decided reports</h2>
        {!(doneReports || []).length && <div className="empty"><Icon name="check" size={26}/><p>Reports you accept, send back or reject are listed here.</p></div>}
        <ul className="card rows">{doneReports!.map(r => (
          <li key={r.id}><Avatar name={A[r.author_agent] || r.author_agent} dept={r.department_id} /><div className="grow"><b className="clip">{r.title}</b><span className="sm">{D[r.department_id]}{r.head_note ? ` · ${r.head_note}` : ''}</span><Link href={`/approvals?report=${r.id}#report-${r.id}`}>Read report</Link></div>
            <span className={`pill ${r.status === 'accepted' ? 'good' : r.status.includes('reject') ? 'bad' : 'warn'}`}>{REPORT_WORD[r.status] || r.status.replace(/_/g, ' ')}</span></li>
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
    <details className="proposal">
      <summary>Expected results and evidence</summary>
      <div className="facts impact">
        <div><small>Budget</small><b>{inr(m.budget_total)}</b></div>
        <div><small>Expected sales</small><b>{m.revenue_low != null ? `${inr(m.revenue_low)} to ${inr(m.revenue_high!)}` : 'Not enough data'}</b></div>
        <div><small>Return on ad spend</small><b>{m.roas_basis != null ? `${m.roas_basis.toFixed(1)}x` : '–'}</b></div>
        <div><small>Pieces, about</small><b>{m.units ?? '–'}</b></div>
      </div>
      <p className="sm basis">{m.basis}</p>
      <dl className="prop">
        {r.data_used.length > 0 && <><dt>Based on</dt><dd><ul className="datalist">{r.data_used.map((d, i) => <li key={i}><span className="pill">{d.source}</span>{d.finding}</li>)}</ul></dd></>}
        {r.how.length > 0 && <><dt>How it runs</dt><dd><ol>{r.how.map((h, i) => <li key={i}>{h}</li>)}</ol></dd></>}
        {r.risks.length > 0 && <><dt>Risks</dt><dd><ul>{r.risks.map((h, i) => <li key={i}>{h}</li>)}</ul></dd></>}
        {r.measure && <><dt>How we will judge it</dt><dd>{r.measure}</dd></>}
      </dl>
    </details>
  );
}
