import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { liveRuns, runSteps } from '@/lib/agents/campaign';
import { publicationBlock, hasConfirmedPublication } from '@/lib/agents/publish-core.mjs';
import { Icon } from '@/components/Icon';
import { Submit } from '@/components/forms';
import { PageHead, Stepper, when } from '@/components/ui';
import { runCampaign, nextStep, publishAgain } from '../admin/actions';
import Automations from '../automations/Automations';
import styles from './Campaigns.module.css';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // publishing to Meta happens in the publish action

/** Campaigns in one place: start one, follow each through the team, and see what runs on a schedule. */
export default async function Campaigns({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { db, role } = await requireUser();
  const sp = await searchParams, admin = role === 'super_admin';
  const [{ data: runs, error: runsError }, { data: ready }, { data: sys }] = await Promise.all([
    db.from('agent_runs').select('id, occasion, stage, status, error, started_at, state').eq('kind', 'campaign').order('started_at', { ascending: false }).limit(12),
    admin ? db.from('approvals').select('id, campaigns(name,status,channels,external_ids)').eq('status', 'approved').limit(50) : Promise.resolve({ data: [] as { id: string; campaigns: unknown }[] }),
    db.from('system_state').select('paused').eq('id', 1).maybeSingle(),
  ]);
  const live = await liveRuns(db, (runs || []).map(r => r.id));
  const paused = !!sys?.paused;
  const waiting = (ready || []).map(a => {
    const c = a.campaigns as { name?: string; status?: string; channels?: string[]; external_ids?: Record<string, string> } | null;
    const finish = hasConfirmedPublication(c, a.id) && ['publishing', 'live'].includes(c?.status || '');
    const block = publicationBlock(c);
    const launch = c?.status === 'approved' && !block && !c?.external_ids?.meta;
    return { id: a.id, c, finish, block, launch };
  }).filter(w => w.finish || w.launch || w.block);
  return (
    <div className={`page ${styles.page}`}>
      {sp.error && <p className="flash" role="alert">{sp.error}</p>}
      {sp.msg && <p className="flash ok" role="status">{sp.msg}</p>}
      <PageHead title="Campaigns" sub="Start a campaign and follow it: the team plans it, the AI CMO checks it, each head signs it off in their Inbox, and the last sign-off publishes it after asking you. Nothing is published or spent before that.">
        <Link href="/approvals?tab=plans" className="btn ghost"><Icon name="inbox" size={16} />Plans to sign off</Link>
      </PageHead>

      <div>
        {admin ? <section className={`card ${styles.start}`} aria-labelledby="start-title">
          <div className="card-head"><h2 id="start-title">Start a campaign</h2></div>
          <form action={runCampaign} className={styles.form}>
            <label className="field" htmlFor="occasion"><span className="sr-only">Occasion or goal</span><input id="occasion" name="occasion" required maxLength={200} placeholder="Occasion or goal, e.g. Diwali gold edit" /></label>
            <div className={styles.formFoot}><p>{paused ? 'The office is paused.' : 'Nothing goes live until it’s signed off.'}</p><Submit icon="rocket" pending="Starting the team…" disabled={paused}>Start campaign</Submit></div>
          </form>
        </section> : <section className={`card ${styles.start}`}>
          <div className="card-head"><h2>Ask for a campaign</h2></div><p className="sub">The Super Admin starts campaigns. Ask the team to plan one in Tasks.</p>
          <Link href="/tasks" className="btn ghost">Go to Tasks<Icon name="arrow" size={15} /></Link>
        </section>}
      </div>

      {waiting.length > 0 && <section className="section" aria-labelledby="ready-title">
        <h2 id="ready-title" className="section-title">Ready to publish</h2>
        {waiting.map(w => <form key={w.id} action={publishAgain} className="banner"><input type="hidden" name="id" value={w.id} />
          <Icon name="rocket" size={20} /><span><b>{w.c?.name}</b> · {w.finish ? 'Meta confirmed the launch. Save its status to finish; this creates no new ads.' : w.block || 'Signed off and ready to publish.'}</span>
          {(w.launch || w.finish) && <Submit confirm={w.launch ? `Publish ${w.c?.name || 'this campaign'} to Meta now? This creates live ads with the approved budget.` : undefined} confirmTitle="Publish this campaign?" confirmLabel="Publish now" pending={w.finish ? 'Saving…' : 'Publishing…'}>{w.finish ? 'Finish saving' : 'Publish now'}</Submit>}
        </form>)}
      </section>}

      <section className="card" aria-labelledby="runs-title">
        <div className="card-head"><h2 id="runs-title">Recent campaigns</h2></div>
        {runsError ? <div className="empty"><Icon name="rocket" size={26} /><p>Campaigns couldn’t load. Refresh to try again.</p></div>
          : (runs || []).length ? <ul className="runs">{runs!.map(r => {
            const v = runSteps(r, live.has(r.id)), state = r.state as { origin?: { why?: string }; retry?: { at: string; n: number } } | null;
            return <li key={r.id}>
              <div className="run-name"><b>{r.occasion || 'Campaign'}</b>{state?.origin && <span className="pill info" title={state.origin.why}>Suggested by the AI CMO</span>}
                <span className={`sm ${r.error ? 'err' : ''}`}>{r.error ? `${state?.retry?.at && r.status === 'running' ? `Trying again at ${when(state.retry.at)}: ` : ''}${r.error.slice(0, 140)}` : state?.origin?.why || `Started ${when(r.started_at)}`}</span></div>
              <Stepper steps={v.steps} />
              {admin && ['running', 'failed'].includes(r.status) && r.stage !== 'done'
                ? <form action={nextStep}><input type="hidden" name="id" value={r.id} />{r.status === 'failed' && <input type="hidden" name="retry" value="1" />}<Submit ghost small icon="arrow" pending="Working…">{r.status === 'failed' ? 'Try again' : 'Next step'}</Submit></form>
                : <span className={`pill ${v.pill[1]}`}>{v.pill[0]}</span>}
            </li>;
          })}</ul> : <div className="empty"><Icon name="rocket" size={26} /><p>No campaigns yet.{admin ? ' Start one above.' : ''}</p></div>}
      </section>

      <section className="section" aria-labelledby="schedules-title">
        <h2 id="schedules-title" className="section-title">Schedules and rules</h2>
        <Automations isAdmin={admin} only="recurring" />
      </section>
    </div>
  );
}
