import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { liveRuns, runSteps } from '@/lib/agents/campaign';
import { publicationBlock, hasConfirmedPublication } from '@/lib/agents/publish-core.mjs';
import { Icon } from '@/components/Icon';
import { Submit } from '@/components/forms';
import { PageHead, when } from '@/components/ui';
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
        {admin ? <form action={runCampaign} className={styles.start} aria-label="Start a campaign">
          <label className="sr-only" htmlFor="occasion">Occasion or goal</label>
          <input id="occasion" name="occasion" required maxLength={200} placeholder={paused ? 'The office is paused' : 'Start a campaign: occasion or goal'} disabled={paused} />
          <Submit icon="rocket" pending="Starting…" disabled={paused}>Start</Submit>
        </form> : <Link href="/tasks" className="btn ghost">Ask the team in Tasks</Link>}
        <Link href="/approvals?tab=plans" className="btn ghost"><Icon name="inbox" size={16} />Plans to sign off</Link>
      </PageHead>

      {waiting.length > 0 && <section className={styles.ready} aria-label="Ready to publish">
        {waiting.map(w => <form key={w.id} action={publishAgain} className="banner"><input type="hidden" name="id" value={w.id} />
          <Icon name="rocket" size={18} /><span><b>{w.c?.name}</b> · {w.finish ? 'Meta confirmed the launch. Save its status to finish; this creates no new ads.' : w.block || 'Signed off and ready to publish.'}</span>
          {(w.launch || w.finish) && <Submit small confirm={w.launch ? `Publish ${w.c?.name || 'this campaign'} to Meta now? This creates live ads with the approved budget.` : undefined} confirmTitle="Publish this campaign?" confirmLabel="Publish now" pending={w.finish ? 'Saving…' : 'Publishing…'}>{w.finish ? 'Finish saving' : 'Publish now'}</Submit>}
        </form>)}
      </section>}

      <section className={`card ${styles.table}`} aria-label="Recent campaigns">
        {runsError ? <div className="empty"><Icon name="rocket" size={20} /><p>Campaigns couldn’t load. Refresh to try again.</p></div>
          : (runs || []).length ? <div className={styles.scroll}><table>
            <thead><tr><th>Campaign</th><th>Step</th><th>Status</th><th>Issue</th><th aria-label="Action" /></tr></thead>
            <tbody>{runs!.map(r => {
              const v = runSteps(r, live.has(r.id)), state = r.state as { origin?: { why?: string }; retry?: { at: string; n: number } } | null;
              const at = v.steps.findIndex(step => step.state === 'now' || step.state === 'bad'), stage = at >= 0 ? v.steps[at] : v.steps[v.steps.length - 1];
              const issue = r.error ? `${state?.retry?.at && r.status === 'running' ? `Trying again at ${when(state.retry.at)}: ` : ''}${r.error}` : '';
              return <tr key={r.id}>
                <td><b className={styles.name}>{r.occasion || 'Campaign'}</b><small className={styles.meta}>{state?.origin ? 'Suggested by the AI CMO' : `Started ${when(r.started_at)}`}</small></td>
                <td><span className={styles.dots} aria-hidden="true">{v.steps.map(step => <i key={step.label} data-state={step.state} />)}</span><span className={styles.stage}>{stage?.label}</span></td>
                <td><span className={`pill ${v.pill[1]}`}>{v.pill[0]}</span></td>
                <td><span className={styles.issue} title={issue || undefined}>{issue || (state?.origin?.why ?? '–')}</span></td>
                <td className={styles.act}>{admin && ['running', 'failed'].includes(r.status) && r.stage !== 'done' && <form action={nextStep}><input type="hidden" name="id" value={r.id} />{r.status === 'failed' && <input type="hidden" name="retry" value="1" />}<Submit ghost small pending="Working…">{r.status === 'failed' ? 'Try again' : 'Next step'}</Submit></form>}</td>
              </tr>;
            })}</tbody>
          </table></div> : <div className="empty"><Icon name="rocket" size={20} /><p>No campaigns yet.{admin ? ' Start one above.' : ''}</p></div>}
      </section>

      <details className={`card ${styles.more}`}>
        <summary>Schedules and stock rules</summary>
        <Automations isAdmin={admin} only="recurring" />
      </details>
    </div>
  );
}
