// Building blocks shared by the Dashboard, Approvals and Admin pages.
import { Icon, type IconName } from './Icon';
import { DEPT_COLOR } from '@/office/engine.mjs';
import { pageNumbers } from './pagination-core.mjs';

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
export const when = (d: string | null | undefined) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

type Params = Record<string, string | string[] | undefined>;
/** The page a list is on, from its own search param (lists on one screen page separately). */
export const pageOf = (sp: Params, param = 'page') => Math.max(1, Math.min(10000, parseInt(String(sp[param] ?? '1'), 10) || 1));
/** The inclusive row range Supabase's .range() takes for that page. */
export const rangeOf = (page: number, size: number) => [(page - 1) * size, page * size - 1] as const;

/**
 * Previous and next links under a long list. Pass total when the list was counted, or hasMore when it was read
 * one row past the page (cheaper on big tables like the event log). Other search params are kept.
 */
export function Pager({ sp, param = 'page', page, size, total, hasMore, anchor, shown }: {
  sp: Params; param?: string; page: number; size: number; total?: number | null; hasMore?: boolean; anchor?: string; shown: number;
}) {
  const pages = total != null ? Math.max(1, Math.ceil(total / size)) : null;
  const more = pages != null ? page < pages : !!hasMore;
  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v != null && k !== param && k !== 'msg' && k !== 'error') for (const item of Array.isArray(v) ? v : [v]) q.append(k, item);
    if (n > 1) q.set(param, String(n));
    const s = q.toString();
    return `?${s}${anchor ? `#${anchor}` : ''}`;
  };
  const from = shown ? (page - 1) * size + 1 : 0, to = (page - 1) * size + shown;
  return (
    <nav className="pager" aria-label={`${anchor || param} pages`}>
      <span className="sm">{shown ? `${from.toLocaleString('en-IN')}–${to.toLocaleString('en-IN')}` : 'None'}{total != null ? ` of ${total.toLocaleString('en-IN')}` : ''}</span>
      <div className="pager-btns">
        {page > 1 ? <a className="btn ghost sm-btn" href={href(page - 1)} rel="prev">Previous</a> : <span className="btn ghost sm-btn" aria-disabled="true">Previous</span>}
        {pages != null && pageNumbers(Math.min(page,pages),pages).map((number,index)=>number==='ellipsis'?<span className="pagination-ellipsis" key={`gap-${index}`} aria-hidden="true">…</span>:<a className={`pager-page ${number===page?'is-current':''}`} key={number} href={href(number)} aria-label={`Page ${number}`} aria-current={number===page?'page':undefined}>{number}</a>)}
        {pages != null && page > pages && <span className="sm">This page is empty. Choose an earlier page.</span>}
        {more ? <a className="btn ghost sm-btn" href={href(page + 1)} rel="next">Next</a> : <span className="btn ghost sm-btn" aria-disabled="true">Next</span>}
      </div>
    </nav>
  );
}
