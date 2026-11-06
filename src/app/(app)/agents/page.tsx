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
  const leadsOnly = sp.leads === '1', size = 15;
  const names = Object.fromEntries(depts.map(d => [d.id, d.name]));
  const filtered = list.filter(a => (!department || a.department_id === department) && (!leadsOnly || a.is_lead)
    && (!query || [a.name, a.role_desc, names[a.department_id]].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const page = Math.min(pageOf(sp), Math.max(1, Math.ceil(filtered.length / size)));
  const visible = filtered.slice((page - 1) * size, page * size);

  return (
    <AgentActivityProvider history={Object.fromEntries(all.map(card => [card.id,card.last?.at||null]))} observedAt={new Date().toISOString()}><div className={`page ${styles.page}`}>
      <PageHead title="Agents" sub={`Your AI team: who is working, what they sent and how it went.${role === 'super_admin' ? '' : ' You see the teams you head.'}`}>
        <form className={styles.filters} role="search" action="/agents">
          <label className={styles.search}><span className="sr-only">Search agents</span><input type="search" name="q" defaultValue={query} placeholder="Name, role or team…" /></label>
          <label><span className="sr-only">Department</span><select name="dept" defaultValue={department}><option value="">All teams</option>{depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label><span className="sr-only">Role</span><select name="leads" defaultValue={leadsOnly ? '1' : ''}><option value="">All agents</option><option value="1">Team leads</option></select></label>
          <button className="btn ghost" type="submit"><Icon name="search" size={15}/>Search</button>
          {(query || department || leadsOnly) && <Link href="/agents" className="btn ghost">Clear</Link>}
        </form>
      </PageHead>
      <nav className="tabs" aria-label="Agents"><Link href="/agents" className="on" aria-current="page"><Icon name="users" size={16}/>Directory</Link><Link href="/agents/manage"><Icon name="edit" size={16}/>Instructions</Link></nav>
      <section className="tiles" aria-label="Summary">
        <AgentActivitySummary />
        <Tile icon="doc" tone="blue" label="Reports forwarded" value={sum(c => c.forwarded)} sub={`${sum(c => c.accepted)} accepted`} />
        <Tile icon="rocket" tone="amber" label="Live campaigns" value={totals.live} />
        <Tile icon="rupee" tone="violet" label="Campaign revenue" value={inr(totals.revenue)} sub={totals.spend ? `${(totals.revenue / totals.spend).toFixed(1)}x return` : undefined} />
      </section>
      <section className={`card ${styles.table}`} aria-label="Team directory">
        {visible.length ? <div className={styles.scroll}><table>
          <thead><tr><th>Agent</th><th>Team</th><th>Role</th><th>Latest activity <span className={styles.window}>· last 30 days</span></th><th className={styles.when}>When</th></tr></thead>
          <tbody>{visible.map(a => {
            const c = cards[a.id] as Card | undefined;
            return <tr key={a.id}>
              <td><span className={styles.who}><Avatar name={a.name} dept={a.department_id} size={24}/><Link href={`/agents/${a.id}`} className={styles.name}>{a.name}</Link><AgentActivityBadge id={a.id}/></span></td>
              <td><span className={styles.clip}>{names[a.department_id]}</span></td>
              <td>{a.is_lead ? <span className="pill acc">Team lead</span> : <span className="pill">Specialist</span>}</td>
              <td><span className={styles.clip} title={c?.last?.text}>{c?.last ? c.last.text : <span className={styles.quiet}>No activity in 30 days</span>}</span></td>
              <td className={styles.when}>{c?.last ? <time dateTime={c.last.at}>{ago(c.last.at)}</time> : '–'}</td>
            </tr>;
          })}</tbody>
        </table></div> : <div className="empty"><Icon name="users" size={20}/><b>{list.length ? 'No matching agents' : 'No departments assigned'}</b><p>{list.length ? 'Try another name or clear your filters.' : 'Ask the Super Admin to assign you as a department head.'}</p>{list.length > 0 && <Link href="/agents" className="btn ghost sm-btn">Clear filters</Link>}</div>}
        <div className={styles.foot}><Pager sp={sp} page={page} size={size} total={filtered.length} shown={visible.length}/></div>
      </section>
    </div></AgentActivityProvider>
  );
}
