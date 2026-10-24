import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { ROLE_LABEL } from '@/lib/roles';
import { Tabs } from '@/components/Tabs';
import { signOut } from '@/app/login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, name, role } = await requireUser();
  // what is waiting on me: forwarded reports and plans (row-level security already limits both to my departments)
  const [{ count: reports }, { data: plans }] = await Promise.all([
    db.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'with_head'),
    db.from('approvals').select('id, required_roles, approval_steps(role, decision)').eq('status', 'pending'),
  ]);
  const waitingPlans = (plans || []).filter(a => {
    const signed = new Set((a.approval_steps as { role: string; decision: string }[]).filter(s => s.decision === 'approve').map(s => s.role));
    const headsLeft = (a.required_roles as string[]).filter(r => !signed.has(r));
    return role === 'super_admin' ? headsLeft.length === 0 : headsLeft.includes(role);
  }).length;
  return (
    <>
      <header className="top">
        <Link href="/office" className="brand"><div className="mark" aria-hidden="true">P</div><div><h1>Parakkat</h1><small>AI marketing office · Jewels</small></div></Link>
        <Tabs admin={role === 'super_admin'} waiting={(role === 'super_admin' ? 0 : reports || 0) + waitingPlans} />
        <div className="me">{name} · {ROLE_LABEL[role]}<form action={signOut}><button className="btn ghost" type="submit">Sign out</button></form></div>
      </header>
      {role === 'viewer' && <p className="flash">Your account has no role yet. Ask the Super Admin to set you up as a department head.</p>}
      <main>{children}</main>
    </>
  );
}
