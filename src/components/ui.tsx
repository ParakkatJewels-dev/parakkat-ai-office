// Building blocks shared by the Dashboard, Approvals and Admin pages.
import { Icon, type IconName } from './Icon';
import { DEPT_COLOR } from '@/office/engine.mjs';

export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function Tile({ icon, label, value, sub, tone = 'teal' }: { icon: IconName; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'teal' | 'blue' | 'amber' | 'rose' | 'violet' }) {
  return (
    <div className={`tile tone-${tone}`}>
      <span className="tile-ic"><Icon name={icon} size={20} /></span>
      <div className="tile-body"><span className="tile-label">{label}</span><b className="tile-value">{value}</b>{sub && <span className="tile-sub">{sub}</span>}</div>
    </div>
  );
}

/** Circle with initials, coloured by department; humans in champagne. */
export function Avatar({ name, dept, human, size = 38 }: { name: string; dept?: string | null; human?: boolean; size?: number }) {
  const words = name.replace(/\bAI\b/g, '').trim().split(/\s+/).filter(Boolean);
  const ini = (words.length > 1 ? words.map(w => w[0]).join('') : words[0] || '?').slice(0, 2).toUpperCase();
  const bg = human ? '#d8c3a5' : (dept && (DEPT_COLOR as Record<string, string>)[dept]) || '#3b4b45';
  return <span className="avatar-sm" style={{ width: size, height: size, background: bg, color: human ? '#1c1c1c' : '#fff', fontSize: size * .34 }} aria-hidden="true">{ini}</span>;
}

/** Horizontal steps with a line between them: done, current, or still to come. */
export function Stepper({ steps }: { steps: { label: string; state: 'done' | 'now' | 'todo' | 'bad' }[] }) {
  return (
    <ol className="stepper">
      {steps.map(s => <li key={s.label} className={s.state}><i>{s.state === 'done' ? '✓' : s.state === 'bad' ? '!' : ''}</i><span>{s.label}</span></li>)}
    </ol>
  );
}

export const inr = (n: number) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`;
export const when = (d: string | null | undefined) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
