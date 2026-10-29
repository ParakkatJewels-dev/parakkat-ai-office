import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { scorecards, myDepartments, ago, type Card } from '@/lib/agents/scorecard';
import { Icon } from '@/components/Icon';
import { PageHead, Tile, Avatar, Pager, pageOf, inr } from '@/components/ui';
import styles from './Agents.module.css';
import { AgentActivityProvider, AgentActivitySummary, AgentActivityBadge } from '@/components/AgentActivity';

export default async function Agents({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, role } = await requireUser();
  const depts = await myDepartments(db, role);
  const { data: agents } = await db.from('agents').select('id, name, role_desc, department_id, is_lead').in('department_id', depts.map(d => d.id)).order('is_lead', { ascending: false }).order('name');
  const list = agents || [];
  const { cards, totals } = await scorecards(db, list.map(a => a.id));
  const all = Object.values(cards) as Card[];
  const sum = (f: (c: Card) => number) => all.reduce((s, c) => s + f(c), 0);
  const query = (sp.q || '').trim().slice(0, 100), department = depts.some(d => d.id === sp.dept) ? sp.dept! : '';
  const leadsOnly = sp.leads === '1', size = 12;
  const names = Object.fromEntries(depts.map(d => [d.id, d.name]));
  const filtered = list.filter(a => (!department || a.department_id === department) && (!leadsOnly || a.is_lead)
    && (!query || [a.name, a.role_desc, names[a.department_id]].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const page = Math.min(pageOf(sp), Math.max(1, Math.ceil(filtered.length / size)));
  const visible = filtered.slice((page - 1) * size, page * size);

  return (
    <AgentActivityProvider history={Object.fromEntries(all.map(card => [card.id,card.last?.at||null]))} observedAt={new Date().toISOString()}><div className={`page ${styles.page}`}>
      <PageHead title="Agent reports" sub={`Activity, reports and results across your AI team.${role === 'super_admin' ? '' : ' You see the departments you head.'}`}><Link href="/agents/manage" className="btn ghost"><Icon name="edit" size={17}/>Agent management</Link></PageHead>
      <section className="tiles" aria-label="Summary">
        <AgentActivitySummary />
        <Tile icon="doc" tone="blue" label="Reports forwarded" value={sum(c => c.forwarded)} sub={`${sum(c => c.accepted)} accepted`} />
        <Tile icon="rocket" tone="amber" label="Live campaigns" value={totals.live} sub={totals.spend ? `${inr(totals.spend)} spent on them` : 'By the agents below'} />
        <Tile icon="rupee" tone="violet" label="Campaign revenue" value={inr(totals.revenue)} sub={totals.spend ? `${(totals.revenue / totals.spend).toFixed(1)}x return, Meta results` : 'Meta results, last 30 days'} />
      </section>
      <section className={`card ${styles.filterBar}`} aria-label="Find an agent">
        <form className={styles.filters} role="search" action="/agents">
          <label className={`field ${styles.search}`}>Search agents<input type="search" name="q" defaultValue={query} placeholder="Name, role or department…" /></label>
          <label className="field">Department<select name="dept" defaultValue={department}><option value="">All departments</option>{depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label className="field">Role<select name="leads" defaultValue={leadsOnly ? '1' : ''}><option value="">All agents</option><option value="1">Team leads</option></select></label>
          <button className="btn" type="submit"><Icon name="search" size={16}/>Apply filters</button>
          {(query || department || leadsOnly) && <Link href="/agents" className="btn ghost">Clear</Link>}
        </form>
      </section>
      <section className={styles.directory} aria-label="Agent reports">
        <div className={styles.directoryHeading}><div><h2 className="section-title">Team directory</h2><p className="sub">{filtered.length} agent{filtered.length === 1 ? '' : 's'}{query || department || leadsOnly ? ' match your filters' : ' in your departments'} · Open a workspace to talk or review work.</p></div><span className="pill">Last 30 days</span></div>
        {visible.length ? <ul className={styles.grid}>{visible.map(a => {
          const c = cards[a.id];
          return <li key={a.id}><Link href={`/agents/${a.id}`} className={styles.agentCard}>
            <div className={styles.identity}>
              <div className={styles.agentTop}><Avatar name={a.name} dept={a.department_id} size={36}/><div className={styles.agentName}><b>{a.name}</b><span>{names[a.department_id]}</span></div><AgentActivityBadge id={a.id}/></div>
              <p className={styles.role}>{a.role_desc}</p>
              <div className={styles.agentMeta}>{a.is_lead ? <span className="pill acc">Team lead</span> : <span className="pill">Specialist</span>}<span>Open workspace <Icon name="arrow" size={14}/></span></div>
            </div>
            <div className={styles.latest}><span className={styles.metaLabel}>Latest activity</span><p>{c.last ? c.last.text : 'No activity in the last 30 days.'}</p>{c.last && <time dateTime={c.last.at}>{ago(c.last.at)}</time>}</div>
            <dl className={styles.metrics}><div><dt>Actions</dt><dd>{c.actions}</dd></div><div><dt>Reports</dt><dd>{c.forwarded}</dd></div><div><dt>Accepted</dt><dd>{c.forwarded ? `${Math.round((c.accepted / c.forwarded) * 100)}%` : '–'}</dd></div><div><dt>{c.designs ? 'Designs' : 'Campaigns'}</dt><dd>{c.designs || c.runs}</dd></div></dl>
          </Link></li>;
        })}</ul> : <div className="empty"><Icon name="users" size={28}/><b>{list.length ? 'No matching agents' : 'No departments assigned'}</b><p>{list.length ? 'Try another name or clear your filters.' : 'Ask the Super Admin to assign you as a department head.'}</p>{list.length > 0 && <Link href="/agents" className="btn ghost sm-btn">Clear filters</Link>}</div>}
        <Pager sp={sp} page={page} size={size} total={filtered.length} shown={visible.length}/>
      </section>
    </div></AgentActivityProvider>
  );
}
