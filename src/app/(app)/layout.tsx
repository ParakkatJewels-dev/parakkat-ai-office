import { requireUser } from '@/lib/auth/session';
import { ROLE_LABEL } from '@/lib/roles';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { WorkspaceFrame } from '@/components/WorkspaceFrame';
import { Icon } from '@/components/Icon';
import { Submit } from '@/components/forms';
import { when } from '@/components/ui';
import { SyncBar } from '@/components/SyncBar';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { togglePause } from './admin/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, name, role } = await requireUser();
  // what is waiting on me: forwarded reports and plans (row-level security already limits both to my departments)
  const [{ count: reports }, { data: plans }, { data: heads }, { data: sys }] = await Promise.all([
    db.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'with_head'),
    db.from('approvals').select('id, required_roles, approval_steps(role, decision)').eq('status', 'pending').limit(500),
    db.from('departments').select('id, human_head_role').in('id', ['seo', 'creative']),
    db.from('system_state').select('paused, paused_at, reason').eq('id', 1).maybeSingle(),
  ]);
  // only the server can read the sync lease; only the Super Admin starts syncs, so only they see the bar
  const syncing = role === 'super_admin'
    ? await supabaseAdmin().from('job_locks').select('until').eq('name', 'sync').maybeSingle().then(r => !!r.data && Date.parse(r.data.until) > Date.now(), () => false)
    : false;
  const leads = (d: string) => role === 'super_admin' || (heads || []).some(h => h.id === d && h.human_head_role === role);
  const waitingPlans = (plans || []).filter(a => {
    const signed = new Set((a.approval_steps as { role: string; decision: string }[]).filter(s => s.decision === 'approve').map(s => s.role));
    const headsLeft = (a.required_roles as string[]).filter(r => !signed.has(r));
    return role === 'super_admin' ? headsLeft.length === 0 : headsLeft.includes(role);
  }).length;
  const waiting = (role === 'super_admin' ? 0 : reports || 0) + waitingPlans;
  return (
    <WorkspaceFrame>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <TopBar name={name} role={ROLE_LABEL[role]} waiting={waiting} admin={role === 'super_admin'} seo={leads('seo')} studio={role !== 'viewer'} />
      <Sidebar admin={role === 'super_admin'} waiting={waiting} seo={leads('seo')} studio={role !== 'viewer'} />
      <main className="main" id="main-content" tabIndex={-1}>
        {role === 'viewer' && <p className="flash" role="status">Your account has no role yet. Ask the Super Admin to set you up as a department head.</p>}
        {sys?.paused && (
          <div className="banner paused" role="status">
            <Icon name="pause" size={20} />
            <span><b>{sys.reason === 'budget' ? 'Monthly budget reached: the agents are paused' : 'The agents are paused'}</b>{sys.paused_at ? ` since ${when(sys.paused_at)}` : ''}. No AI or API calls, no syncs and nothing published until the Super Admin resumes them.</span>
            {role === 'super_admin' && <form action={togglePause}><input type="hidden" name="pause" value="0" /><Submit small icon="play" pending="Resuming…">Resume</Submit></form>}
          </div>
        )}
        {role === 'super_admin' && <SyncBar running={syncing} />}
        {children}
      </main>
    </WorkspaceFrame>
  );
}
