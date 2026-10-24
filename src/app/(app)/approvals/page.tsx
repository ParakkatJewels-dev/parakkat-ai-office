import { requireUser } from '@/lib/auth/session';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';
import { decideReport, decideApproval } from './actions';

export const maxDuration = 300; // publishing to Meta happens in the approve action

type Step = { role: AppRole; decision: string; note: string | null };

export default async function Approvals({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { db, role } = await requireUser();
  const sp = await searchParams;
  // Row-level security: heads only get their own departments' forwarded reports and the plans that touch them.
  const [{ data: reports }, { data: plans }, { data: agents }, { data: depts }] = await Promise.all([
    db.from('reports').select('id, department_id, author_agent, lead_agent, title, body, status, lead_note, head_note, revision, updated_at').order('updated_at', { ascending: false }).limit(40),
    db.from('approvals').select('id, status, version, required_roles, created_at, approval_steps(role, decision, note), campaigns(id, name, occasion, plan, budget_daily, channels, creatives(id, kind, language, headline, body, image_path))').order('created_at', { ascending: false }).limit(20),
    db.from('agents').select('id, name'), db.from('departments').select('id, name'),
  ]);
  const A = Object.fromEntries((agents || []).map(a => [a.id, a.name])), D = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  const paths = (plans || []).flatMap(p => ((p.campaigns as any)?.creatives || []).map((c: any) => c.image_path).filter(Boolean));
  const signed = paths.length ? (await db.storage.from('creatives').createSignedUrls(paths, 3600)).data || [] : [];
  const url = (p: string) => signed.find(s => s.path === p)?.signedUrl ?? undefined;

  const myReports = (reports || []).filter(r => r.status === 'with_head');
  const doneReports = (reports || []).filter(r => r.status !== 'with_head').slice(0, 8);
  return (
    <div className="stack">
      {sp.error && <p className="flash">{sp.error}</p>}
      <div><h2 style={{ fontSize: 28 }}>Approvals</h2>
        <p className="note">Reports reach you only after your department&apos;s AI team lead has checked them. Plans go from the AI CMO to the heads they touch, then to the Super Admin, who alone can publish.</p></div>

      <h3 className="eyebrow">Reports waiting on you</h3>
      {myReports.length ? myReports.map(r => (
        <article key={r.id} className="card">
          <span className="pill acc">{D[r.department_id]} report</span>
          <h3 style={{ textTransform: 'none', letterSpacing: '.01em', fontSize: 18, margin: '8px 0 4px' }}>{r.title}</h3>
          <p className="note" style={{ marginTop: 0 }}>From {A[r.author_agent]}, checked by {A[r.lead_agent!]} (AI team lead){r.revision > 1 ? `, revision ${r.revision}` : ''}. {r.lead_note}</p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{r.body}</p>
          <form action={decideReport} className="actions">
            <input type="hidden" name="id" value={r.id} />
            <button className="btn" name="decision" value="accept">Accept</button>
            <button className="btn ghost" name="decision" value="send_back">Send back</button>
            <button className="btn ghost" name="decision" value="reject">Reject</button>
            <textarea className="in" name="note" placeholder="Note for the team lead (needed to send back or reject)" aria-label="Note" />
          </form>
        </article>
      )) : <div className="empty">No reports waiting on you.</div>}

      <h3 className="eyebrow" style={{ marginTop: 10 }}>Campaign plans</h3>
      {(plans || []).length ? (plans || []).map(p => {
        const c = p.campaigns as any, steps = p.approval_steps as Step[], approved = new Set(steps.filter(s => s.decision === 'approve').map(s => s.role));
        const headsLeft = (p.required_roles as AppRole[]).filter(r => !approved.has(r));
        const next: AppRole[] = p.status !== 'pending' ? [] : headsLeft.length ? headsLeft : ['super_admin'];
        const mine = next.includes(role) && (role !== 'super_admin' || headsLeft.length === 0);
        const chain: AppRole[] = [...(p.required_roles as AppRole[]), 'super_admin'];
        const banner = c.creatives?.find((x: any) => x.image_path);
        return (
          <article key={p.id} className="card" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,360px) minmax(0,1fr)', gap: 20 }}>
            <div>{banner && url(banner.image_path) ? <img src={url(banner.image_path)} alt={`Banner for ${c.name}`} style={{ width: '100%', borderRadius: 14 }} /> : <div className="empty">No banner image</div>}</div>
            <div style={{ minWidth: 0 }}>
              <span className="pill acc">{c.occasion}</span>
              <h3 style={{ textTransform: 'none', letterSpacing: '.01em', fontSize: 20, margin: '8px 0 4px' }}>{c.name}{p.version > 1 ? ` · v${p.version}` : ''}</h3>
              <p className="note" style={{ marginTop: 0 }}>Up to ₹{Number(c.budget_daily).toLocaleString('en-IN')} a day for {c.plan.days} days on {c.channels.join(' and ')}. {c.plan.split}</p>
              <ul>{(c.plan.reasons || []).map((r: string) => <li key={r}>{r}</li>)}</ul>
              {c.plan.ai_review && <p className="note">AI CMO: {c.plan.ai_review}</p>}
              {c.creatives?.map((x: any) => <p key={x.id} style={{ margin: '6px 0' }}><span className="pill">{x.language.toUpperCase()}</span> <b>{x.headline}</b> {x.body}</p>)}
              <div className="chain"><span className="done">✓ AI CMO</span>{chain.map(r => {
                const st = r === 'super_admin' ? (['approved', 'published'].includes(p.status) ? 'done' : next.includes(r) ? 'now' : '') : approved.has(r) ? 'done' : next.includes(r) ? 'now' : '';
                return <span key={r} className={st}>{st === 'done' ? '✓' : st === 'now' ? '●' : '○'} {ROLE_LABEL[r]}</span>;
              })}</div>
              {steps.filter(s => s.decision !== 'approve').map(s => <p key={s.role} className="note"><span className="pill bad">{s.decision === 'changes' ? 'Changes requested' : 'Rejected'}</span> {ROLE_LABEL[s.role]}: {s.note}</p>)}
              {p.status === 'published' && <p><span className="pill good">Live</span></p>}
              {mine ? (
                <form action={decideApproval} className="actions">
                  <input type="hidden" name="id" value={p.id} />
                  <button className="btn" name="decision" value="approve">{role === 'super_admin' ? 'Approve and publish' : 'Approve'}</button>
                  <button className="btn ghost" name="decision" value="changes">Request changes</button>
                  <button className="btn ghost" name="decision" value="reject">Reject</button>
                  <textarea className="in" name="note" placeholder="Note for the team (needed to request changes or reject)" aria-label="Note" />
                </form>
              ) : p.status === 'pending' && <p className="note">Waiting on {next.map(r => ROLE_LABEL[r]).join(', ')}.</p>}
            </div>
          </article>
        );
      }) : <div className="empty">No plans yet.</div>}

      {doneReports.length > 0 && <>
        <h3 className="eyebrow" style={{ marginTop: 10 }}>Recent report decisions</h3>
        <ul className="list card">{doneReports.map(r => <li key={r.id}><div className="grow"><b>{r.title}</b><span className="sm">{D[r.department_id]} · {r.status.replace('_', ' ')}{r.head_note ? ` · ${r.head_note}` : ''}</span></div></li>)}</ul>
      </>}
    </div>
  );
}
