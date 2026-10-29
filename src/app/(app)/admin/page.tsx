import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';
import { liveRuns, runSteps } from '@/lib/agents/campaign';
import { BUILDINGS } from '@/office/roster.mjs';
import { Icon } from '@/components/Icon';
import { PageHead, Avatar, Stepper, Pager, pageOf, rangeOf, when } from '@/components/ui';
import { Integrations, AIIntegrations } from './Integrations';
import { ModelRouting } from './ModelRouting';
import { HiggsfieldCard } from './HiggsfieldCard';
import { publicationBlock, hasConfirmedPublication } from '@/lib/agents/publish-core.mjs';
import { SyncButton } from './SyncButton';
import { Locked, Submit } from '@/components/forms';
import { OpportunityRefresh } from './OpportunityRefresh';
import { latestSeoJob } from '@/lib/agents/seo-status.mjs';
import { SettingsDraftGuard } from './SettingsDraftGuard';
import { SettingsAnchor } from './SettingsAnchor';
import styles from './Settings.module.css';
import { setRole, setHead, addCompetitor, runCampaign, nextStep, syncNow, togglePause, publishAgain, saveBrandBook, addLesson, retireLesson, findOpportunitiesNow } from './actions';

export const maxDuration = 300;
const ROLES: AppRole[] = ['super_admin', 'creative_head', 'ecom_manager', 'perf_marketer', 'viewer'];
const PROVIDER: Record<string, string> = { shopify: 'Shopify', meta: 'Meta Ads', instagram: 'Instagram', google_ads: 'Google Ads', ga4: 'Google Analytics', triple_whale: 'Triple Whale', openai: 'OpenAI API', chatgpt: 'ChatGPT', gemini: 'Gemini', jev: 'Jev', nim: 'NVIDIA NIM', google_trends: 'Google Trends', keyword_planner: 'Keyword Planner' };
const PEOPLE = 20, LESSONS = 15;
const SOURCE: Record<string, string> = { manual: 'Added by you', results: 'Learned from campaign results', analytics: 'Learned from this month\'s analytics', lead: 'Stopped by the AI team lead', report: 'From a head\'s report decision', plan: 'From a plan decision', image_review: 'From a head\'s review in the Design Studio' };

const AUTOPILOT = [
  { id: 'opportunities', name: 'AI leads: find opportunities', when: 'Hourly, 9am to 8pm. Department leads review fresh signals; the CMO checks their proposals and forwards actionable findings to the heads' },
  { id: 'planner', name: 'AI CMO morning planning', when: 'Daily from 9am. Reads the festival calendar, sales, stock, ads, posts, rivals and searches, and opens up to two campaigns' },
  { id: 'sync', name: 'Data sync', when: 'Every 6 hours. Shopify, Meta, Instagram, Google Ads and Odoo' },
  { id: 'odoo_sales', name: 'Odoo sales continuation', when: 'About every 2 minutes while sales days remain. Continues saved progress without repeating the stock import' },
  { id: 'festivals', name: 'Festival Calendar Keeper', when: 'Daily. Tells the CMO what is coming and when planning should start' },
  { id: 'stock', name: 'Product Picker: stock check', when: 'Hourly, 8am to 10pm. Sold-out best sellers and last pieces of repeat sellers' },
  { id: 'sales', name: 'Sales Analyst: daily pulse', when: 'Every 90 minutes, 8am to 10pm. Yesterday against the two weeks before' },
  { id: 'ads', name: 'Ads Analyst and Budget Guard', when: 'Every 90 minutes, 8am to 10pm. Refreshes recorded campaign evidence and deterministic checks; shows coverage gaps without inferring profit or changing ads' },
  { id: 'rivals', name: 'Competitor Scout', when: 'Every 3 hours, 9am to 9pm. This week\'s competitor moves' },
  { id: 'seo', name: 'SEO Desk weekly check', when: 'Weekly. Google Trends and Keyword Planner, then title and description fixes' },
  { id: 'budget', name: 'Budget Guard: running costs', when: 'Daily. Warns you once a month when AI and API spend nears the budget on Usage and billing' },
  { id: 'library', name: 'Banner Designer: design library', when: 'Every 10 minutes. Reads the Drive folders picked in Design Studio and studies new past designs' },
];

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'settings', group: 'Workspace', description: 'Your settings, in one place', intro: 'Choose what you want to manage. Each section keeps related settings and actions together.' },
  { id: 'team', label: 'People & permissions', icon: 'users', group: 'Workspace', description: 'Access and department heads', intro: 'Manage who can use the office and which roles review each department’s work.' },
  { id: 'brand', label: 'Brand guidance', icon: 'doc', group: 'Workspace', description: 'Voice, standards and context', intro: 'Give every agent a consistent understanding of your brand. Individual agent instructions live in Agent management.' },
  { id: 'ai', label: 'AI providers', icon: 'spark', group: 'Intelligence', description: 'Model routing and provider keys', intro: 'See which model handles each job, then manage its connection and usage.' },
  { id: 'memory', label: 'Learning memory', icon: 'heart', group: 'Intelligence', description: 'Feedback your agents remember', intro: 'Review the lessons agents use, add guidance for a team, or retire advice that no longer applies.' },
  { id: 'competitors', label: 'Competitors', icon: 'eye', group: 'Intelligence', description: 'Your market watchlist', intro: 'Choose the brands the War Room follows for market and competitor research.' },
  { id: 'connections', label: 'Connections', icon: 'plug', group: 'System', description: 'Business accounts and sync', intro: 'Connect your sales, advertising and analytics accounts. Review saved access separately from the latest data sync.' },
  { id: 'operations', label: 'Office controls', icon: 'clock', group: 'System', description: 'Schedules, activity and recovery', intro: 'Control office activity, inspect scheduled work and recover campaigns that need attention.' },
] as const;
type Tab = typeof TABS[number]['id'];

export default async function Admin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { db, role } = await requireUser();
  if (role !== 'super_admin') redirect('/office');
  const { data: sys, error: systemError } = await db.from('system_state').select('paused').eq('id', 1).maybeSingle();
  const paused = systemError || !sys ? null : !!sys.paused;
  const sp = await searchParams, tab: Tab = TABS.some(t => t.id === sp.tab) ? sp.tab as Tab : sp.reviewRequested ? 'operations' : 'overview';
  const selected = TABS.find(t => t.id === tab)!;
  const href = (t: Tab) => t === 'overview' ? '/admin' : `/admin?tab=${t}`;

  return (
    <div className={`page ${styles.page}`}>
      <SettingsAnchor />
      <PageHead title="Workspace settings" sub="Connections, access and guidance for your AI office.">
        <span className={styles.accessBadge}><Icon name="lock" size={15} />Super admin</span>
      </PageHead>
      <SettingsDraftGuard key={`${tab}:${sp.msg || ''}:${sp.error || ''}`}>
        <div className={styles.layout}>
          <nav className={styles.navigation} aria-label="Settings sections">
            {['Workspace', 'Intelligence', 'System'].map(group => <div className={styles.navGroup} key={group}>
              <p className={styles.navLabel}>{group}</p>
              {TABS.filter(t => t.group === group).map(t => <Link key={t.id} href={href(t.id)} className={styles.navLink} aria-current={t.id === tab ? 'page' : undefined}>
                <Icon name={t.icon} size={18} /><span><b>{t.label}</b><small>{t.description}</small></span>
              </Link>)}
            </div>)}
            <Link href="/usage?tab=limits" className={styles.billingLink}><Icon name="rupee" size={17} />Usage & billing<Icon name="arrow" size={15} /></Link>
          </nav>
          <div className={styles.content}>
            <header className={styles.sectionHead}><div><h2>{selected.label}</h2><p>{selected.intro}</p></div></header>
            {sp.msg && <p className="flash ok" role="status">{sp.msg}</p>}
            {sp.error && <p className="flash" role="alert">{sp.error}</p>}
            {paused === null && <p className="flash" role="alert">Office status is unavailable. Reload before changing office activity.</p>}
            {paused === true && tab !== 'operations' && <div className={styles.notice}><Icon name="pause" size={18} /><span>The office is paused. Scheduled work waits until you resume.</span><Link href="/admin?tab=operations">Office controls<Icon name="arrow" size={14} /></Link></div>}
            {tab === 'overview' && <Overview paused={paused} />}
            {tab === 'connections' && <Connections db={db} />}
            {tab === 'ai' && <AIProviders db={db} />}
            {tab === 'team' && <Team db={db} sp={sp} />}
            {tab === 'brand' && <Brand db={db} />}
            {tab === 'competitors' && <Competitors db={db} sp={sp} />}
            {tab === 'memory' && <Memory db={db} sp={sp} />}
            {tab === 'operations' && <Operations db={db} paused={paused} requestedAt={Number(sp.reviewRequested) || 0} />}
          </div>
        </div>
      </SettingsDraftGuard>
    </div>
  );
}

type Db = Awaited<ReturnType<typeof requireUser>>['db'];

function Overview({ paused }: { paused: boolean | null }) {
  return <>
    <section className={styles.officeStatus} aria-label="Office status">
      <div className={styles.statusIcon}><Icon name="building" size={25} /></div>
      <div className={styles.statusCopy}><h3>Your AI office</h3><p>{paused === null ? 'Status could not be loaded.' : paused ? 'Scheduled activity is paused.' : 'Scheduled work is enabled. Existing usage limits and approvals apply.'}</p><span className="sm">Parakkat HQ · Indian Standard Time (UTC+5:30)</span></div>
      <span className={`pill ${paused === null || paused ? 'warn' : 'good'}`}>{paused === null ? 'Unavailable' : paused ? 'Paused' : 'Running'}</span>
      <Link href="/admin?tab=operations" className="btn ghost sm-btn">Office controls<Icon name="arrow" size={14} /></Link>
    </section>
    <div className={styles.quickGrid}>
      {TABS.filter(t => !['overview', 'operations'].includes(t.id)).map(t => <Link href={`/admin?tab=${t.id}`} className={styles.quickCard} key={t.id}>
        <span className={styles.cardIcon}><Icon name={t.icon} size={21} /></span><div><h3>{t.label}</h3><p>{t.description}</p></div><Icon name="arrow" size={17} />
      </Link>)}
    </div>
    <section className={styles.related}><div><h3>Looking for agent instructions or spending limits?</h3><p>Use these workspaces to manage the team’s responsibilities and resource limits.</p></div><div className={styles.relatedLinks}><Link href="/agents/manage">Agent management<Icon name="arrow" size={15} /></Link><Link href="/usage?tab=limits">Usage limits<Icon name="arrow" size={15} /></Link></div></section>
  </>;
}

async function Operations({ db, paused, requestedAt }: { db: Db; paused: boolean | null; requestedAt: number }) {
  const [{ data: runs, error: runsError }, { data: stuck, error: approvalsError }, { data: jobs, error: jobsError }, { data: reviews, error: reviewsError }, { data: seoRun }] = await Promise.all([
    db.from('agent_runs').select('id, occasion, stage, status, error, started_at, state').eq('kind', 'campaign').order('started_at', { ascending: false }).limit(8),
    db.from('approvals').select('id, campaigns(name,status,channels,external_ids)').eq('status', 'approved').limit(50),
    db.from('autopilot_jobs').select('name, last_run_at, last_result'),
    db.from('agent_runs').select('id, status, stage, state, error, started_at, finished_at').eq('kind', 'opportunity').order('started_at', { ascending: false }).limit(3),
    db.from('agent_runs').select('status, stage, state, error, started_at').eq('kind', 'seo').order('started_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const live = await liveRuns(db, (runs || []).map(r => r.id));
  const J = Object.fromEntries((jobs || []).map(j => [j.name, j]));
  const seoStatus = latestSeoJob(J.seo, seoRun);
  if (seoStatus) J.seo = { ...seoStatus, name: 'seo' };
  const reviewIds = (reviews || []).map(r => r.id);
  const { data: opportunityReports } = reviewIds.length ? await db.from('reports').select('id, run_id, title, body, status, author_agent, agents!reports_author_agent_fkey(name)').in('run_id', reviewIds).order('created_at', { ascending: false }).limit(6) : { data: [] };
  const requestPending = requestedAt > 0 && requestedAt <= Date.now() && Date.now() - requestedAt < 30_000 && requestedAt > Date.parse(reviews?.[0]?.started_at || '1970-01-01');
  const reviewActive = requestPending || (reviews || []).some(r => r.status === 'running' && Date.parse(r.started_at) > Date.now() - 210_000);
  return <>
    <section className={styles.officeStatus} aria-label="Office activity controls">
      <div className={styles.statusIcon}><Icon name={paused ? 'pause' : 'play'} size={24} /></div>
      <div className={styles.statusCopy}><h3>{paused === null ? 'Office status unavailable' : paused ? 'The office is paused' : 'The office is running'}</h3><p>Pausing stops new scheduled steps, AI requests, syncs and publishing until you resume. Work already in progress may finish.</p></div>
      {paused !== null && <form action={togglePause}><input type="hidden" name="pause" value={paused ? '0' : '1'} /><Submit ghost icon={paused ? 'play' : 'pause'} confirm={paused ? 'Resume office activity? Scheduled work and provider requests can run again within your saved limits.' : 'Pause the entire AI office? New scheduled steps, AI requests, syncs and publishing will wait until you resume. Work already in progress may finish.'} confirmTitle={paused ? 'Resume the office' : 'Pause all agents'} confirmLabel={paused ? 'Resume office' : 'Pause office'} pending={paused ? 'Resuming…' : 'Pausing…'}>{paused ? 'Resume office' : 'Pause all agents'}</Submit></form>}
    </section>
    {(runsError || approvalsError || jobsError || reviewsError) && <p className="flash" role="alert">Some office activity could not be loaded. Reload before retrying work.</p>}
    <div className={styles.stack}>
      <section className="card s12" id="opportunities">
        <OpportunityRefresh active={reviewActive} />
        <div className="card-head"><div><h2>New opportunities</h2><p className="sub">Department leads review new signals from 9am–8pm IST. The CMO checks their evidence before proposals reach you.</p></div>
          <form action={findOpportunitiesNow}><Submit ghost icon="spark" pending="Requesting review…" disabled={paused !== false || reviewActive}>{reviewActive ? 'Leads are reviewing…' : 'Find opportunities now'}</Submit></form>
        </div>
        {paused && <p className="note-line">Agents are paused. Resume them to continue opportunity reviews.</p>}
        {(reviews || []).length ? <ul className="rows">{reviews!.map(r => {
          const stale = r.status === 'running' && Date.parse(r.started_at) <= Date.now() - 210_000;
          const status = stale ? 'Interrupted' : r.status === 'running' ? 'Reviewing' : r.status === 'done' ? 'Reviewed' : 'Needs attention';
          return <li key={r.id}><div className="grow"><div className="conn-top"><b>Lead opportunity review</b><span className={`pill ${r.status === 'done' ? 'good' : 'warn'}`}>{status}</span></div><span className="sm">{when(r.started_at)}</span><details className={styles.details} open={stale || r.status === 'failed'}><summary>Review summary</summary><p>{stale ? 'This review did not finish. Completed findings are saved; start another review to continue.' : r.state?.summary || (r.status === 'running' ? 'The leads are comparing current sales, stock, ads and search signals.' : r.status === 'failed' ? 'The review could not finish. Completed findings are saved.' : 'Review complete.')}</p></details></div></li>;
        })}</ul> : <p className="sub">The next scheduled review will appear here, or ask the leads to start now.</p>}
        {(opportunityReports || []).length > 0 && <ul className="rows">{opportunityReports!.map(r => <li key={r.id}><div className="grow"><div className="conn-top"><b>{r.title}</b><span className="pill">{r.status === 'with_head' ? 'Awaiting your review' : r.status.replaceAll('_', ' ')}</span></div><Link className="sm" href={`/agents/${r.author_agent}`}>{(r.agents as any)?.name || r.author_agent}</Link><details className="report-body"><summary>Evidence and next step</summary><p>{r.body}</p></details></div></li>)}</ul>}
        <Link href="/approvals?tab=reports" className="btn ghost sm-btn">Review the team’s proposals<Icon name="arrow" size={14} /></Link>
      </section>
      <section className="card" id="campaign"><div className="card-head"><div><h3>Start a campaign</h3><p className="sub">A new brief for your marketing team</p></div><Icon name="rocket" size={22} /></div>
      <form action={runCampaign} className={styles.stack}>
        <p className="sub">Give the team a goal. Specialists prepare the plan, quality reviewers check it, and human heads approve before launch.</p>
        <label className="field">Occasion or goal<input name="occasion" required placeholder="Diwali gold edit, wedding season, new kids range…" /></label>
        <div className={styles.formFooter}><Submit icon="rocket" pending="Starting the team…" disabled={paused !== false}>Start campaign</Submit></div>
      </form>
      </section>

      <section className="card s8 wide-md">
        <div className="card-head"><div><h3>Recent campaign runs</h3><p className="sub">Latest eight runs. Retry only after correcting the reported issue.</p></div><Link href="/automations" className="btn ghost sm-btn">Task board<Icon name="arrow" size={14} /></Link></div>
        {(stuck || []).map(a => {
          const c = a.campaigns as any;
          const finish = hasConfirmedPublication(c, a.id) && ['publishing', 'live'].includes(c?.status);
          const block = publicationBlock(c);
          const launch = c?.status === 'approved' && !block && !c?.external_ids?.meta;
          return <form key={a.id} action={publishAgain} className="banner"><input type="hidden" name="id" value={a.id} />
            <Icon name="rocket" size={20} /><span><b>{c?.name}</b> · {finish ? 'Meta confirmed the launch. Finish saving its status; this creates no new ads.' : block || (launch ? 'Approved and ready to publish.' : 'Existing publication records need review before another launch.')}</span>
            {(launch || finish) && <Submit confirm={launch ? `Publish ${c?.name || 'this campaign'} to Meta now? This creates live ads with the approved budget.` : undefined} confirmTitle="Publish campaign" confirmLabel="Publish now" pending={finish ? 'Saving…' : 'Publishing…'}>{finish ? 'Finish saving' : 'Publish now'}</Submit>}</form>;
        })}
        {(runs || []).length ? <ul className="runs">{runs!.map(r => {
          const v = runSteps(r, live.has(r.id));
          return (
            <li key={r.id}>
              <div className="run-name"><b>{r.occasion}</b>{(r.state as any)?.origin && <span className="pill acc" title={(r.state as any).origin.why}>Opened by the AI CMO</span>}
                <span className={`sm ${r.error ? 'err' : ''}`}>{r.error ? `${(r.state as any)?.retry?.at && r.status === 'running' ? `Trying again at ${when((r.state as any).retry.at)} (try ${(r.state as any).retry.n}): ` : ''}${r.error.slice(0, 120)}` : (r.state as any)?.origin?.why || `Started ${when(r.started_at)}`}</span></div>
              <Stepper steps={v.steps} />
              {['running','failed'].includes(r.status) && r.stage !== 'done'
                ? <form action={nextStep}><input type="hidden" name="id" value={r.id} />{r.status==='failed'&&<input type="hidden" name="retry" value="1"/>}<Submit ghost small icon="arrow" pending="Working…">{r.status==='failed'?'Retry after fixing inputs':'Next step'}</Submit></form>
                : <span className={`pill ${v.pill[1]}`}>{v.pill[0]}</span>}
            </li>
          );
        })}</ul> : <div className="empty"><Icon name="rocket" size={26} /><p>{runsError ? 'Campaign activity is unavailable.' : 'No campaign runs yet. Start with a brief above, or review the team’s scheduled work below.'}</p></div>}
      </section>

      <section className="card s12">
        <div className="card-head"><div><h3>Scheduled activity</h3><p className="sub">Times are in IST. Open a schedule to see its cadence and latest result. Campaigns still require approval.</p></div></div>
        <ul className={styles.schedules}>{AUTOPILOT.map(a => {
          const j = J[a.id], bad = j?.last_result?.startsWith('failed');
          return (
            <li key={a.id}><details open={bad}><summary><div><b>{a.name}</b><span className="sm">{j?.last_run_at ? `Last run ${when(j.last_run_at)}` : jobsError ? 'Status unavailable' : 'Not run yet'}</span></div><span className={`pill ${bad ? 'bad' : ''}`}>{bad ? 'Needs attention' : j?.last_result === 'running' ? 'Running' : 'Details'}</span><Icon name="down" size={15} /></summary><p>{a.when}</p>{j?.last_result && <p className={bad ? 'err' : 'sm'}>{j.last_result}</p>}</details>
            </li>
          );
        })}</ul>
      </section>
    </div>
  </>;
}

async function Connections({ db }: { db: Db }) {
  const { data: conns, error } = await db.from('connections').select('provider, status, account_ref, last_synced_at, last_error').order('provider');
  const connections = (conns || []).filter(c => !['gemini', 'chatgpt', 'openai', 'jev', 'nim'].includes(c.provider));
  const issues = connections.filter(c => c.status === 'error' || c.last_error);
  return <>
    <section className={styles.notice} id="sync"><Icon name="sync" size={21} /><div className={styles.statusCopy}><b>Keep the team’s data current</b><p>Refresh connected business accounts. Progress appears in the workspace sync bar.</p></div><form action={syncNow}><SyncButton /></form></section>
    {error && <p className="flash" role="alert">Connection checks could not be loaded. Saved account controls are available below.</p>}
    {issues.length > 0 && <div className={styles.notice}><Icon name="bell" size={19} /><span><b>{issues.length} service {issues.length === 1 ? 'check needs' : 'checks need'} attention.</b> A saved connection does not guarantee a successful sync.</span><a href="#connection-health">View checks<Icon name="arrow" size={14} /></a></div>}
    <Integrations />
    <ul className="integr"><HiggsfieldCard /></ul>
    <section className="card" id="connection-health"><div className="card-head"><div><h3>Service checks</h3><p className="sub">Latest recorded sync and access results. Open a service for details.</p></div><span className="pill">{error ? 'Unavailable' : `${connections.length} services`}</span></div>
      <ul className={styles.serviceList}>{connections.map(c => <li key={c.provider}><details open={c.status === 'error' || !!c.last_error}>
        <summary><div><b>{PROVIDER[c.provider] || c.provider.replaceAll('_', ' ')}</b><span className="sm">{c.last_synced_at ? `Last sync ${when(c.last_synced_at)}` : 'No successful sync recorded'}</span></div><span className={`pill ${c.last_error || c.status === 'error' ? 'bad' : c.status === 'connected' ? 'good' : ''}`}>{c.last_error ? 'Needs attention' : c.status.replaceAll('_', ' ')}</span><Icon name="down" size={15} /></summary>
        <p className="sm">{c.account_ref || 'No account linked'}</p>{c.last_error && <p className="err" role="status">{c.last_error}</p>}
      </details></li>)}</ul>
      {!error && !connections.length && <p className="sub">No service checks yet. Connect a platform to get started.</p>}
    </section>
    <Link href="/admin?tab=ai" className={styles.inlineLink}>Manage ChatGPT and image generation<Icon name="arrow" size={15} /></Link>
  </>;
}

async function AIProviders({ db }: { db: Db }) {
  const { data: services, error } = await db.from('connections').select('provider, status, last_error, last_synced_at').in('provider', ['openai', 'jev']).order('provider');
  return <>
    <ModelRouting />
    <div className={styles.notice}><Icon name="rupee" size={18} /><span>Monitor usage, reduce repeated work, and set optional daily and weekly caps.</span><Link href="/usage?tab=limits">Usage limits<Icon name="arrow" size={14} /></Link></div>
    <AIIntegrations />
    <ul className="integr"><HiggsfieldCard /></ul>
    {error && <p className="flash" role="alert">Additional AI service checks could not be loaded.</p>}
    {!!services?.length && <details className={`card ${styles.addPanel}`} open={services.some(s => s.last_error || s.status === 'error')}><summary><Icon name="plug" size={18} /><b>Additional AI service checks</b><span className="sm">Installed providers</span><Icon name="down" size={15} /></summary><p className="sub">Recorded checks for other installed services. The cards above show the current ChatGPT and Gemini configuration.</p><ul className={styles.serviceList}>{services.map(s => <li key={s.provider}><div className={styles.serviceRow}><b>{PROVIDER[s.provider] || s.provider}</b><span className={`pill ${s.last_error || s.status === 'error' ? 'bad' : s.status === 'connected' ? 'good' : ''}`}>{s.last_error ? 'Needs attention' : s.status.replaceAll('_', ' ')}</span></div>{s.last_error && <p className="sm err">{s.last_error}</p>}{s.last_synced_at && <p className="sm">Last checked {when(s.last_synced_at)}</p>}</li>)}</ul></details>}
  </>;
}

async function Team({ db, sp }: { db: Db; sp: Record<string, string | undefined> }) {
  const pe = pageOf(sp, 'pe'), [pe0, pe1] = rangeOf(pe, PEOPLE);
  const [{ data: people, count, error: peopleError }, { data: depts, error: departmentsError }, { data: agents }] = await Promise.all([
    db.from('profiles').select('id, full_name, role', { count: 'exact' }).order('created_at').range(pe0, pe1),
    db.from('departments').select('id, name, building, human_head_role, ai_lead_agent').order('building'),
    db.from('agents').select('id, name'),
  ]);
  const A = Object.fromEntries((agents || []).map(a => [a.id, a.name]));
  const byBuilding = BUILDINGS.map(b => ({ ...b, depts: (depts || []).filter(d => d.building === b.name) })).filter(b => b.depts.length);
  return (
    <div className={styles.stack}>
      <section className="card">
        <div className="card-head"><div><h3>People and roles</h3><p className="sub">Manage access for people who have signed in to this workspace.</p></div><span className="pill">{peopleError ? 'Unavailable' : `${count || 0} people`}</span></div>
        <details className={styles.details}><summary>How to invite someone</summary><p>In your Supabase project, open Authentication → Users → Invite. They appear here after their first sign-in.</p></details>
        {peopleError && <p className="flash" role="alert">People could not be loaded. Reload before changing access.</p>}
        <ul className="rows">{(people || []).map(p => (
          <li key={p.id}>
            <Avatar name={p.full_name || '?'} human />
            <div className="grow"><b className="clip">{p.full_name || `User ${p.id.slice(0, 8)}`}</b><span className="sm">{ROLE_LABEL[p.role as AppRole]}</span></div>
            <Locked key={p.role} action={setRole} saved inline className="inline"><input type="hidden" name="id" value={p.id} />
              <select name="role" defaultValue={p.role} className="in" aria-label={`Role for ${p.full_name || 'user'}`}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            </Locked>
          </li>
        ))}</ul>
        <Pager sp={sp} param="pe" page={pe} size={PEOPLE} total={count} shown={(people || []).length} />
        {!peopleError && !people?.length && <p className="sub">No people on this page.</p>}
      </section>

      <section className="card">
        <div className="card-head"><div><h3>Department heads</h3><p className="sub">Each head sees only the departments they lead</p></div></div>
        {departmentsError && <p className="flash" role="alert">Department assignments could not be loaded. Reload to try again.</p>}
        {byBuilding.map(b => (
          <details key={b.id} className={styles.departmentGroup}>
            <summary><Icon name="building" size={17} /><b>{b.short}</b><span className="sm">{b.depts.length} departments</span><Icon name="down" size={15} /></summary>
            <ul className="rows">{b.depts.map(d => (
              <li key={d.id}>
                <Avatar name={d.name} dept={d.id} size={34} />
                <div className="grow"><b className="clip">{d.name}</b><span className="sm">{d.ai_lead_agent ? `AI lead: ${A[d.ai_lead_agent] || d.ai_lead_agent}` : 'No AI lead'}</span></div>
                <Locked key={d.human_head_role} action={setHead} saved inline className="inline"><input type="hidden" name="id" value={d.id} />
                  <select name="role" defaultValue={d.human_head_role} className="in" aria-label={`Head of ${d.name}`}>{ROLES.filter(r => r !== 'viewer').map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                </Locked>
              </li>
            ))}</ul>
          </details>
        ))}
      </section>
    </div>
  );
}

async function Competitors({ db, sp }: { db: Db; sp: Record<string, string | undefined> }) {
  const cp = pageOf(sp, 'cp'), [start, end] = rangeOf(cp, 15);
  const { data: rivals, count, error } = await db.from('competitors').select('id, name, instagram_handle, website', { count: 'exact' }).order('name').range(start, end);
  return <>
    <details className={`card ${styles.addPanel}`}><summary><Icon name="plus" size={19} /><b>Add a competitor</b><span className="sm">Name and public profiles</span><Icon name="down" size={16} /></summary>
      <form action={addCompetitor} className={styles.formGrid}>
        <label className="field">Competitor name<input name="name" required placeholder="Business name" /></label>
        <label className="field">Instagram handle<input name="instagram" placeholder="@brandname" /></label>
        <label className="field">Website<input name="website" placeholder="https://example.com" /></label>
        <label className="field">Facebook page ID<input name="fbpage" placeholder="Optional" /></label>
        <div className={styles.formFooter}><Submit icon="plus" pending="Adding…">Add competitor</Submit></div>
      </form>
    </details>
    <section className="card"><div className="card-head"><div><h3>Your watchlist</h3><p className="sub">Public Instagram, website and Meta ad activity for the War Room to review.</p></div><span className="pill">{error ? 'Unavailable' : `${count || 0} competitors`}</span></div>
      {error && <p className="flash" role="alert">The watchlist could not be loaded. Reload to try again.</p>}
      {(rivals || []).length ? <ul className={styles.watchlist}>{rivals!.map(c => <li key={c.id}><Avatar name={c.name} size={38} /><div><b>{c.name}</b><span className="sm">{[c.instagram_handle && '@' + c.instagram_handle, c.website].filter(Boolean).join(' · ') || 'No public profiles added'}</span></div></li>)}</ul> : !error && <div className="empty"><Icon name="eye" size={25} /><p>Your watchlist is empty. Add a competitor above to give the War Room a place to start.</p></div>}
      <Pager sp={sp} param="cp" page={cp} size={15} total={count} shown={(rivals || []).length} />
    </section>
  </>;
}

async function Brand({ db }: { db: Db }) {
  const { data: book, error } = await db.from('brand_book').select('voice, always, never, notes, updated_at').eq('id', 1).maybeSingle();
  const saved = !!(book?.voice || book?.always || book?.never || book?.notes);
  if (error) return <p className="flash" role="alert">Brand guidance could not be loaded. Reload before editing so existing guidance is preserved.</p>;
  return <>
    <section className="card"><div className="card-head"><div><h3>The Parakkat brand book</h3><p className="sub">Shared guidance for every agent, applied from their next job.</p></div><span className={`pill ${saved ? 'good' : ''}`}>{saved ? 'Configured' : 'Ready to set up'}</span></div>
      <Locked key={book?.updated_at || 'new'} action={saveBrandBook} saved={saved} className={styles.brandForm} label="Save brand guidance" savedNote={book?.updated_at ? `Last saved ${when(book.updated_at)}` : 'Saved'}>
        <div className={styles.formGrid}>
          <label className="field">Brand voice<span className="sm">How your brand should sound.</span><textarea name="voice" rows={5} defaultValue={book?.voice || ''} placeholder="Describe your tone, audience and language preferences." /></label>
          <label className="field">Always include<span className="sm">Standards every piece of work should follow.</span><textarea name="always" rows={5} defaultValue={book?.always || ''} placeholder="Approved brand details, required checks and presentation standards." /></label>
          <label className="field">Avoid<span className="sm">Claims, language or approaches to leave out.</span><textarea name="never" rows={5} defaultValue={book?.never || ''} placeholder="Unapproved claims, restricted offers or language that does not fit." /></label>
          <label className="field">Business context<span className="sm">The background that helps agents make better decisions.</span><textarea name="notes" rows={5} defaultValue={book?.notes || ''} placeholder="Your customers, key seasons, products and business priorities." /></label>
        </div>
      </Locked>
    </section>
    <div className={styles.notice}><Icon name="users" size={19} /><span>Need to change one agent’s responsibilities or instructions?</span><Link href="/agents/manage">Agent management<Icon name="arrow" size={15} /></Link></div>
  </>;
}

async function Memory({ db, sp }: { db: Db; sp: Record<string, string | undefined> }) {
  const lp = pageOf(sp, 'lp'), [lp0, lp1] = rangeOf(lp, LESSONS);
  let lessonsQuery = db.from('lessons').select('id, department_id, source, decision, lesson, created_at', { count: 'exact' }).eq('active', true).order('created_at', { ascending: false });
  if (sp.dept) lessonsQuery = lessonsQuery.eq('department_id', sp.dept);
  const [{ data: depts, error: departmentsError }, { data: lessons, count, error }] = await Promise.all([
    db.from('departments').select('id, name').order('building'),
    lessonsQuery.range(lp0, lp1),
  ]);
  const DN = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  return <>
    <div className={styles.notice}><Icon name="doc" size={19} /><span>Brand voice and shared standards now have their own section.</span><Link href="/admin?tab=brand">Brand guidance<Icon name="arrow" size={15} /></Link></div>
    <details className={`card ${styles.addPanel}`}><summary><Icon name="plus" size={19} /><b>Add a lesson</b><span className="sm">Guidance for one team or everyone</span><Icon name="down" size={16} /></summary>
      <form action={addLesson} className={styles.stack}>
        <label className="field">Applies to<select name="dept" defaultValue="board" disabled={!!departmentsError}>{(depts || []).map(d => <option key={d.id} value={d.id}>{d.id === 'board' ? 'Every team' : d.name}</option>)}</select></label>
        <label className="field">Lesson<textarea name="lesson" rows={3} required placeholder="Describe what the team should remember and when it applies." /></label>
        {departmentsError && <p className="err" role="alert">Teams could not be loaded. Reload before adding a lesson.</p>}
        <div className={styles.formFooter}><Submit icon="plus" disabled={!!departmentsError} pending="Adding…">Add lesson</Submit></div>
      </form>
    </details>
    <section className="card"><div className="card-head"><div><h3>Active lessons</h3><p className="sub">From human feedback and recorded results. Retiring a lesson preserves its history.</p></div><span className="pill">{error ? 'Unavailable' : `${count || 0} lessons`}</span></div>
      <form className={styles.filterRow} action="/admin" method="get" data-settings-filter="true"><input type="hidden" name="tab" value="memory" /><label className="field">Team<select name="dept" defaultValue={sp.dept || ''}><option value="">All teams</option>{(depts || []).map(d => <option value={d.id} key={d.id}>{d.id === 'board' ? 'Every team' : d.name}</option>)}</select></label><button className="btn ghost" type="submit">Apply filter</button>{sp.dept && <Link href="/admin?tab=memory" className={styles.inlineLink}>Clear filter</Link>}</form>
      {error && <p className="flash" role="alert">Lessons could not be loaded. Reload to try again.</p>}
      {(lessons || []).length ? <ul className={`rows lessons ${styles.lessons}`}>{lessons!.map(l => <li key={l.id}>
        <div className="grow"><span className={`pill ${['accepted', 'approve', 'worked'].includes(l.decision || '') ? 'good' : l.source === 'manual' || l.decision === 'data' ? 'acc' : 'warn'}`}>{l.department_id === 'board' ? 'Every team' : DN[l.department_id] || l.department_id}</span><p>{l.lesson}</p><span className="sm">{SOURCE[l.source] || `From a ${l.source} decision`} · {when(l.created_at)}</span></div>
        <form action={retireLesson}><input type="hidden" name="id" value={l.id} /><Submit ghost small confirm="Retire this lesson? Agents will stop using it as active guidance. Its history will be preserved." confirmTitle="Retire lesson" confirmLabel="Retire lesson" pending="Retiring…">Retire</Submit></form>
      </li>)}</ul> : !error && <div className="empty"><Icon name="heart" size={24} /><p>{sp.dept ? 'No active lessons for this team. Try another team or clear the filter.' : 'No active lessons yet. Add guidance above, or review lessons as the team receives feedback.'}</p></div>}
      <Pager sp={sp} param="lp" page={lp} size={LESSONS} total={count} shown={(lessons || []).length} />
    </section>
  </>;
}
