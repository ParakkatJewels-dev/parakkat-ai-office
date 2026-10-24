import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { BUILDINGS } from '@/office/roster.mjs';
import { scorecards, myDepartments, ago, type Card } from '@/lib/agents/scorecard';
import { Icon } from '@/components/Icon';
import { PageHead, Tile, Avatar, inr } from '@/components/ui';

const STATE = { now: ['Working now', 'good'], today: ['Active today', 'acc'], quiet: ['Quiet', ''] } as const;

export default async function Agents() {
  const { db, role } = await requireUser();
  const depts = await myDepartments(db, role);
  const { data: agents } = await db.from('agents').select('id, name, role_desc, department_id, is_lead').in('department_id', depts.map(d => d.id)).order('is_lead', { ascending: false });
  const list = agents || [];
  const { cards, totals } = await scorecards(db, list.map(a => a.id));
  const all = Object.values(cards) as Card[];
  const sum = (f: (c: Card) => number) => all.reduce((s, c) => s + f(c), 0);
  const groups = BUILDINGS.map(b => ({ ...b, depts: depts.filter(d => d.building === b.name).map(d => ({ ...d, agents: list.filter(a => a.department_id === d.id) })).filter(d => d.agents.length) })).filter(b => b.depts.length);

  return (
    <div className="page">
      <PageHead title="Agent reports" sub={`What each AI staff member is doing, what they have finished in the last 30 days, and what it led to.${role === 'super_admin' ? '' : ' You see the departments you head.'}`} />
      <section className="tiles" aria-label="Summary">
        <Tile icon="users" label="Active today" value={`${all.filter(c => c.state !== 'quiet').length}/${all.length}`} sub={`${all.filter(c => c.state === 'now').length} working right now`} />
        <Tile icon="doc" tone="blue" label="Reports that reached a head" value={sum(c => c.forwarded)} sub={`${sum(c => c.accepted)} accepted`} />
        <Tile icon="rocket" tone="amber" label="Live campaigns worked on" value={totals.live} sub={totals.spend ? `${inr(totals.spend)} spent on them` : 'By the agents below'} />
        <Tile icon="rupee" tone="violet" label="Revenue from those campaigns" value={inr(totals.revenue)} sub={totals.spend ? `${(totals.revenue / totals.spend).toFixed(1)}x return, Meta results` : 'Meta results, last 30 days'} />
      </section>
      <nav className="chips" aria-label="Buildings">{groups.map(b => <a key={b.id} href={`#b-${b.id}`}>{b.short} <b>{b.depts.reduce((s, d) => s + d.agents.length, 0)}</b></a>)}</nav>

      {groups.map(b => (
        <section key={b.id} id={`b-${b.id}`} className="section">
          <h2 className="section-title">{b.short}</h2>
          {b.depts.map(d => (
            <div key={d.id} className="card dept">
              <div className="card-head"><div><h3>{d.name}</h3><p className="sub">{d.agents.length} AI staff</p></div></div>
              <ul className="agent-grid">{d.agents.map(a => {
                const c = cards[a.id], [label, tone] = STATE[c.state];
                return (
                  <li key={a.id}><Link href={`/agents/${a.id}`} className="agent-card">
                    <div className="agent-top"><Avatar name={a.name} dept={d.id} size={40} /><div className="grow"><b className="clip">{a.name}</b><span className="sm clip">{a.is_lead ? 'AI team lead · ' : ''}{a.role_desc}</span></div><span className={`pill ${tone}`}><i className={`live-dot ${c.state}`} />{label}</span></div>
                    <p className="agent-now">{c.last ? <>{c.last.text}<time> · {ago(c.last.at)}</time></> : <span className="sm">Nothing in the last 30 days.</span>}</p>
                    <div className="agent-stats">
                      <span><b>{c.actions}</b>actions</span>
                      <span><b>{c.forwarded}</b>reports to heads</span>
                      <span><b>{c.forwarded ? `${Math.round((c.accepted / c.forwarded) * 100)}%` : '–'}</b>accepted</span>
                      <span><b>{c.designs || c.runs}</b>{c.designs ? 'designs' : 'campaigns'}</span>
                    </div>
                  </Link></li>
                );
              })}</ul>
            </div>
          ))}
        </section>
      ))}
      {!groups.length && <div className="empty"><Icon name="users" size={26} /><p>You do not head any department yet. Ask the Super Admin to set you up.</p></div>}
    </div>
  );
}
