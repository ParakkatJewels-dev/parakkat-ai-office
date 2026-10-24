import { requireUser } from '@/lib/auth/session';
import { ROLE_LABEL } from '@/lib/roles';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';

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
  const waiting = (role === 'super_admin' ? 0 : reports || 0) + waitingPlans;
  return (
    <div className="shell">
      <TopBar name={name} role={ROLE_LABEL[role]} waiting={waiting} />
      <Sidebar admin={role === 'super_admin'} waiting={waiting} />
      <main className="main">
        {role === 'viewer' && <p className="flash">Your account has no role yet. Ask the Super Admin to set you up as a department head.</p>}
        {children}
      </main>
    </div>
  );
}
