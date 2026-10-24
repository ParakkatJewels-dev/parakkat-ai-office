import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';
import { setRole, setHead, addCompetitor, runCampaign, nextStep, syncNow, publishAgain } from './actions';

export const maxDuration = 300;
const ROLES: AppRole[] = ['super_admin', 'creative_head', 'ecom_manager', 'perf_marketer', 'viewer'];

export default async function Admin({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { db, role } = await requireUser();
  if (role !== 'super_admin') redirect('/office');
  const sp = await searchParams;
  const [{ data: people }, { data: depts }, { data: rivals }, { data: conns }, { data: runs }, { data: stuck }] = await Promise.all([
    db.from('profiles').select('id, full_name, role').order('created_at'),
    db.from('departments').select('id, name, building, human_head_role, ai_lead_agent').order('building'),
    db.from('competitors').select('id, name, instagram_handle, website').order('name'),
    db.from('connections').select('provider, status, account_ref, last_synced_at, last_error').order('provider'),
    db.from('agent_runs').select('id, occasion, stage, status, error, started_at').order('started_at', { ascending: false }).limit(8),
    db.from('approvals').select('id, campaigns(name)').eq('status', 'approved'),
  ]);
  return (
    <div className="stack">
      {sp.msg && <p className="note card">{sp.msg}</p>}
      {sp.error && <p className="flash">{sp.error}</p>}
      <div className="bento">
        <form action={runCampaign} className="card s6 stack"><h3>Start a campaign</h3>
          <label className="field">Occasion or goal<input name="occasion" required placeholder="Diwali gold edit, wedding season, new kids range…" /></label>
          <button className="btn">Start</button>
          <p className="note">The whole team works on it: Insights and War Room reports go through their AI team leads, then Strategy, Creative House and Quality, and finally the plan comes to the heads for approval.</p></form>
        <div className="card s6 stack"><h3>Connections</h3>
          <ul className="list">{(conns || []).map(c => <li key={c.provider}><div className="grow"><b>{c.provider.replace('_', ' ')}</b><span className="sm">{c.account_ref || ''}{c.last_synced_at ? ` · synced ${new Date(c.last_synced_at).toLocaleString('en-IN')}` : ''}{c.last_error ? ` · ${c.last_error.slice(0, 90)}` : ''}</span></div><span className={`pill ${c.status === 'connected' ? 'good' : c.status === 'error' ? 'bad' : ''}`}>{c.status.replace('_', ' ')}</span></li>)}</ul>
          <form action={syncNow}><button className="btn ghost">Sync now</button></form>
          <p className="note">Keys live in Vercel environment variables, never in the database. See docs/DEPLOY.md.</p></div>
        <div className="card s12"><h3>Agent runs</h3><ul className="list">{(runs || []).map(r => <li key={r.id}><div className="grow"><b>{r.occasion}</b><span className="sm">{r.error || `Stage: ${r.stage}`}</span></div><span className={`pill ${r.status === 'failed' ? 'bad' : ''}`}>{r.status}</span>{r.status !== 'waiting' && <form action={nextStep}><input type="hidden" name="id" value={r.id} /><button className="btn ghost">Run next step</button></form>}</li>)}</ul>
          {(stuck || []).map(a => <form key={a.id} action={publishAgain} className="actions"><input type="hidden" name="id" value={a.id} /><span>{(a.campaigns as any)?.name} is approved but not live.</span><button className="btn">Publish now</button></form>)}</div>
        <div className="card s6"><h3>People and roles</h3><ul className="list">{(people || []).map(p => <li key={p.id}><div className="grow"><b>{p.full_name || p.id.slice(0, 8)}</b></div>
          <form action={setRole} className="actions" style={{ marginTop: 0 }}><input type="hidden" name="id" value={p.id} /><select name="role" defaultValue={p.role} className="in" aria-label="Role">{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select><button className="btn ghost">Save</button></form></li>)}</ul>
          <p className="note">Invite people from Supabase (Authentication, Users, Invite). They appear here after their first sign-in.</p></div>
        <div className="card s6"><h3>Department heads</h3><ul className="list">{(depts || []).map(d => <li key={d.id}><div className="grow"><b>{d.name}</b><span className="sm">{d.building}</span></div>
          <form action={setHead} className="actions" style={{ marginTop: 0 }}><input type="hidden" name="id" value={d.id} /><select name="role" defaultValue={d.human_head_role} className="in" aria-label={`Head of ${d.name}`}>{ROLES.filter(r => r !== 'viewer').map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select><button className="btn ghost">Save</button></form></li>)}</ul></div>
        <div className="card s12"><h3>Competitors</h3>
          <form action={addCompetitor} className="actions"><input className="in" name="name" required placeholder="Name" aria-label="Name" /><input className="in" name="instagram" placeholder="@instagram" aria-label="Instagram handle" /><input className="in" name="website" placeholder="Website" aria-label="Website" /><input className="in" name="fbpage" placeholder="Facebook page id" aria-label="Facebook page id" /><button className="btn">Add</button></form>
          <ul className="list" style={{ marginTop: 10 }}>{(rivals || []).map(c => <li key={c.id}><div className="grow"><b>{c.name}</b><span className="sm">{c.instagram_handle ? '@' + c.instagram_handle : ''} {c.website || ''}</span></div></li>)}</ul></div>
      </div>
    </div>
  );
}
