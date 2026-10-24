import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';
import { STAGES } from '@/lib/agents/campaign';
import { BUILDINGS } from '@/office/roster.mjs';
import { Icon } from '@/components/Icon';
import { PageHead, Tile, Avatar, Stepper, when } from '@/components/ui';
import { setRole, setHead, addCompetitor, runCampaign, nextStep, syncNow, publishAgain } from './actions';

export const maxDuration = 300;
const ROLES: AppRole[] = ['super_admin', 'creative_head', 'ecom_manager', 'perf_marketer', 'viewer'];
const PROVIDER: Record<string, string> = { shopify: 'Shopify', meta: 'Meta Ads', instagram: 'Instagram', google_ads: 'Google Ads', ga4: 'Google Analytics', triple_whale: 'Triple Whale', openai: 'OpenAI', gemini: 'Gemini', jev: 'Jev' };
const STAGE_LABEL: Record<string, string> = { analyse: 'Analyse', competitors: 'Competitors', plan: 'Plan', create: 'Create', review: 'Review', approval: 'Approval', done: 'Live' };

export default async function Admin({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { db, role } = await requireUser();
  if (role !== 'super_admin') redirect('/office');
  const sp = await searchParams;
  const [{ data: people }, { data: depts }, { data: rivals }, { data: conns }, { data: runs }, { data: stuck }, { data: agents }] = await Promise.all([
    db.from('profiles').select('id, full_name, role').order('created_at'),
    db.from('departments').select('id, name, building, human_head_role, ai_lead_agent').order('building'),
    db.from('competitors').select('id, name, instagram_handle, website').order('name'),
    db.from('connections').select('provider, status, account_ref, last_synced_at, last_error').order('provider'),
    db.from('agent_runs').select('id, occasion, stage, status, error, started_at').order('started_at', { ascending: false }).limit(8),
    db.from('approvals').select('id, campaigns(name)').eq('status', 'approved'),
    db.from('agents').select('id, name'),
  ]);
  const A = Object.fromEntries((agents || []).map(a => [a.id, a.name]));
  const connected = (conns || []).filter(c => c.status === 'connected').length;
  const active = (runs || []).filter(r => r.status !== 'failed' && r.stage !== 'done').length;
  const byBuilding = BUILDINGS.map(b => ({ ...b, depts: (depts || []).filter(d => d.building === b.name) })).filter(b => b.depts.length);

  return (
    <div className="page">
      {sp.msg && <p className="flash ok">{sp.msg}</p>}
      {sp.error && <p className="flash">{sp.error}</p>}
      <PageHead title="Admin" sub="Start campaigns, check the data connections, and decide who heads each department.">
        <form action={syncNow}><button className="btn ghost"><Icon name="sync" size={18} />Sync data now</button></form>
      </PageHead>

      <section className="tiles" aria-label="Summary">
        <Tile icon="plug" label="Connections live" value={`${connected}/${(conns || []).length}`} sub={connected === (conns || []).length ? 'Everything connected' : 'Some still need keys'} />
        <Tile icon="rocket" tone="amber" label="Campaigns in progress" value={active} sub={`${(stuck || []).length} approved, waiting to publish`} />
        <Tile icon="users" tone="blue" label="People" value={(people || []).length} sub={`${(people || []).filter(p => p.role === 'viewer').length} without a role`} />
        <Tile icon="eye" tone="violet" label="Competitors watched" value={(rivals || []).length} sub="By the War Room" />
      </section>

      <nav className="chips" aria-label="Sections"><a href="#campaign">Campaigns</a><a href="#sync">Connections</a><a href="#people">People</a><a href="#heads">Department heads</a><a href="#rivals">Competitors</a></nav>

      <div className="bento">
        <form action={runCampaign} id="campaign" className="card hero s5 launch">
          <span className="tile-ic"><Icon name="rocket" size={22} /></span>
          <h2>Start a campaign</h2>
          <p className="sub">The whole team works on it. Insights and War Room reports go through their AI team leads, then Strategy, Creative House and Quality, and finally the plan comes to the heads for approval.</p>
          <label className="field">Occasion or goal<input name="occasion" required placeholder="Diwali gold edit, wedding season, new kids range…" /></label>
          <button className="btn"><Icon name="rocket" size={18} />Start campaign</button>
        </form>

        <section id="sync" className="card s7">
          <div className="card-head"><div><h3>Connections</h3><p className="sub">Keys live in Vercel environment variables, never in the database.</p></div></div>
          <ul className="conns">{(conns || []).map(c => (
            <li key={c.provider} className={c.status}>
              <div className="conn-top"><b>{PROVIDER[c.provider] || c.provider.replace('_', ' ')}</b><span className={`pill ${c.status === 'connected' ? 'good' : c.status === 'error' ? 'bad' : ''}`}>{c.status.replace('_', ' ')}</span></div>
              <span className="sm clip">{c.account_ref || 'No account linked'}</span>
              <span className="sm">{c.last_error ? <span className="err">{c.last_error.slice(0, 80)}</span> : c.last_synced_at ? `Synced ${when(c.last_synced_at)}` : 'Never synced'}</span>
            </li>
          ))}</ul>
        </section>

        <section className="card s12">
          <div className="card-head"><div><h3>Campaign runs</h3><p className="sub">Push a run forward by hand if it is stuck</p></div></div>
          {(stuck || []).map(a => (
            <form key={a.id} action={publishAgain} className="banner"><input type="hidden" name="id" value={a.id} />
              <Icon name="rocket" size={20} /><span><b>{(a.campaigns as any)?.name}</b> is approved but not live yet.</span><button className="btn">Publish now</button></form>
          ))}
          {(runs || []).length ? <ul className="runs">{runs!.map(r => {
            const at = STAGES.indexOf(r.stage as any);
            return (
              <li key={r.id}>
                <div className="run-name"><b>{r.occasion}</b><span className={`sm ${r.error ? 'err' : ''}`}>{r.error ? r.error.slice(0, 120) : `Started ${when(r.started_at)}`}</span></div>
                <Stepper steps={STAGES.map((s, i) => ({ label: STAGE_LABEL[s], state: i < at || r.stage === 'done' ? 'done' : i === at ? (r.status === 'failed' ? 'bad' : 'now') : 'todo' }))} />
                {r.status !== 'waiting' && r.stage !== 'done'
                  ? <form action={nextStep}><input type="hidden" name="id" value={r.id} /><button className="btn ghost sm-btn"><Icon name="arrow" size={16} />Next step</button></form>
                  : <span className={`pill ${r.stage === 'done' ? 'good' : 'warn'}`}>{r.stage === 'done' ? 'Live' : 'With the heads'}</span>}
              </li>
            );
          })}</ul> : <div className="empty"><Icon name="rocket" size={26} /><p>No runs yet. Start one above.</p></div>}
        </section>

        <section id="people" className="card s6">
          <div className="card-head"><div><h3>People and roles</h3><p className="sub">Invite people from Supabase (Authentication, Users, Invite). They appear here after their first sign-in.</p></div></div>
          <ul className="rows">{(people || []).map(p => (
            <li key={p.id}>
              <Avatar name={p.full_name || '?'} human />
              <div className="grow"><b className="clip">{p.full_name || `User ${p.id.slice(0, 8)}`}</b><span className="sm">{ROLE_LABEL[p.role as AppRole]}</span></div>
              <form action={setRole} className="inline"><input type="hidden" name="id" value={p.id} />
                <select name="role" defaultValue={p.role} className="in" aria-label={`Role for ${p.full_name || 'user'}`}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                <button className="btn ghost sm-btn">Save</button></form>
            </li>
          ))}</ul>
        </section>

        <section id="heads" className="card s6">
          <div className="card-head"><div><h3>Department heads</h3><p className="sub">Each head sees only the departments they lead</p></div></div>
          {byBuilding.map(b => (
            <div key={b.id} className="bgroup">
              <h4 className="eyebrow"><Icon name="building" size={14} />{b.short}</h4>
              <ul className="rows">{b.depts.map(d => (
                <li key={d.id}>
                  <Avatar name={d.name} dept={d.id} size={34} />
                  <div className="grow"><b className="clip">{d.name}</b><span className="sm">{d.ai_lead_agent ? `AI lead: ${A[d.ai_lead_agent] || d.ai_lead_agent}` : 'No AI lead'}</span></div>
                  <form action={setHead} className="inline"><input type="hidden" name="id" value={d.id} />
                    <select name="role" defaultValue={d.human_head_role} className="in" aria-label={`Head of ${d.name}`}>{ROLES.filter(r => r !== 'viewer').map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                    <button className="btn ghost sm-btn">Save</button></form>
                </li>
              ))}</ul>
            </div>
          ))}
        </section>

        <section id="rivals" className="card s12">
          <div className="card-head"><div><h3>Competitors</h3><p className="sub">The War Room checks their Instagram, website and Meta ads</p></div></div>
          <form action={addCompetitor} className="addrow">
            <input className="in" name="name" required placeholder="Name" aria-label="Name" />
            <input className="in" name="instagram" placeholder="@instagram" aria-label="Instagram handle" />
            <input className="in" name="website" placeholder="Website" aria-label="Website" />
            <input className="in" name="fbpage" placeholder="Facebook page id" aria-label="Facebook page id" />
            <button className="btn"><Icon name="plus" size={18} />Add</button>
          </form>
          {(rivals || []).length ? <ul className="rivals">{rivals!.map(c => (
            <li key={c.id}><Avatar name={c.name} size={34} /><div><b>{c.name}</b><span className="sm">{[c.instagram_handle && '@' + c.instagram_handle, c.website].filter(Boolean).join(' · ') || 'No links yet'}</span></div></li>
          ))}</ul> : <p className="sub">No competitors yet.</p>}
        </section>
      </div>
    </div>
  );
}
