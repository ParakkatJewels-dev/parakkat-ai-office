import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { byId } from '@/lib/agents/people';
import { Icon } from '@/components/Icon';
import { Locked, Submit } from '@/components/forms';
import { PageHead, Tile, Pager, pageOf, rangeOf, inr, when } from '@/components/ui';
import { saveBilling, saveFixedCost, savePrice } from './actions';

const LOG = 50, DAY = 864e5;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const RANGES = { '7': 'Last 7 days', '30': 'Last 30 days', mtd: 'This month', '90': 'Last 90 days' } as const;
const PROVIDER: Record<string, string> = { openai: 'OpenAI', gemini: 'Google Gemini', jev: 'Jev (TypeSafe AI)', serpapi: 'SerpApi' };
const FEATURE: Record<string, string> = { campaign: 'Campaign runs', seo: 'SEO check', design: 'Design Studio orders' };
const featureName = (f: string) => FEATURE[f] || (f.startsWith('autopilot:') ? `Autopilot: ${f.slice(10)}` : f === 'other' ? 'Other' : f);
type Row = { calls: number; cost_usd: number };
type Report = {
  calls: number; failed: number; cost_usd: number; input_tokens: number; output_tokens: number; images: number;
  by_model: (Row & { provider: string; model: string | null; input_tokens: number; output_tokens: number; units: number })[];
  by_agent: (Row & { agent_id: string; dept: string | null })[]; by_dept: (Row & { dept: string })[]; by_feature: (Row & { feature: string })[];
  by_run: (Row & { run_id: string; kind: string | null; occasion: string | null })[]; by_day: [string, number][];
};

/** What it costs to run the platform: every AI and API call with its estimated cost, the monthly plans, and the budget. */
export default async function Usage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { db, role } = await requireUser();
  if (role !== 'super_admin') redirect('/office');
  const sp = await searchParams, range = (sp.range && sp.range in RANGES ? sp.range : '30') as keyof typeof RANGES;
  const now = new Date(), to = iso(now), monthStart = `${to.slice(0, 8)}01`;
  const from = range === 'mtd' ? monthStart : iso(new Date(now.getTime() - (Number(range) - 1) * DAY));
  const lp = pageOf(sp, 'lp'), [l0, l1] = rangeOf(lp, LOG);
  const [{ data: rep }, { data: month }, { data: settings }, { data: fixed }, { data: prices }, { data: log, count: logCount }, { data: depts }] = await Promise.all([
    db.rpc('usage_report', { p_from: from, p_to: to }),
    db.rpc('usage_report', { p_from: monthStart, p_to: to }),
    db.from('billing_settings').select('usd_inr, monthly_budget_inr, alert_pct').eq('id', 1).maybeSingle(),
    db.from('fixed_costs').select('id, name, monthly_usd, note').eq('active', true).order('name'),
    db.from('usage_prices').select('key, in_per_m, out_per_m, per_unit, note, updated_at').order('key'),
    db.from('api_usage').select('id, at, provider, model, agent_id, feature, input_tokens, output_tokens, units, cost_usd, ok, ms', { count: 'exact' }).gte('at', from).order('at', { ascending: false }).range(l0, l1),
    db.from('departments').select('id, name'),
  ]);
  const R = (rep || {}) as Report, M = (month || {}) as Report;
  const fx = Number(settings?.usd_inr || 88), rs = (usd: number) => inr(Number(usd) * fx), usd = (n: number) => `$${Number(n).toFixed(Number(n) < 1 ? 3 : 2)}`;
  const D = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  const fixedUsd = (fixed || []).reduce((s, f) => s + Number(f.monthly_usd), 0);
  const dim = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate(), dom = now.getUTCDate();
  const mtdUsage = Number(M.cost_usd || 0), projected = (mtdUsage / dom) * dim + fixedUsd;
  const budget = settings?.monthly_budget_inr ? Number(settings.monthly_budget_inr) : null, alertPct = Number(settings?.alert_pct || 80);
  const spentInr = (mtdUsage + fixedUsd * dom / dim) * fx, projInr = projected * fx;
  const over = budget ? projInr > budget : false, warn = budget ? spentInr >= budget * alertPct / 100 : false;
  const days = (R.by_day || []).map(([d, c]) => [d, Number(c)] as const), max = Math.max(1e-9, ...days.map(d => d[1]));
  const qs = (patch: Record<string, string | null>) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries({ range: sp.range, ...patch })) if (v && !(k === 'range' && v === '30')) q.set(k, v); return `/usage${q.size ? `?${q}` : ''}`; };
  const share = (c: number) => R.cost_usd ? `${Math.round((Number(c) / Number(R.cost_usd)) * 100)}%` : '–';

  return (
    <div className="page">
      {sp.msg && <p className="flash ok">{sp.msg}</p>}
      {sp.error && <p className="flash">{sp.error}</p>}
      <PageHead title="Usage and billing" sub={`What it costs to run the AI office: every AI and API call with its estimated cost at list prices, plus your monthly plans. Dollars shown in rupees at ₹${fx} to the dollar.`}>
        <div className="seg" role="group" aria-label="Period">{Object.entries(RANGES).map(([k, l]) => <a key={k} href={qs({ range: k, lp: null })} className={range === k ? 'on' : ''}>{l}</a>)}</div>
      </PageHead>

      {budget && (warn || over) && <p className={`flash ${over ? '' : 'ok'}`}>{over ? `At this pace the month ends near ${inr(projInr)}, over your ${inr(budget)} budget.` : `You have used ${Math.round(spentInr / budget * 100)}% of this month's ${inr(budget)} budget.`}</p>}

      <section className="tiles" aria-label="Summary">
        <Tile icon="rupee" label={`AI and API, ${RANGES[range].toLowerCase()}`} value={rs(R.cost_usd || 0)} sub={`${usd(R.cost_usd || 0)} · ${(R.calls || 0).toLocaleString('en-IN')} calls${R.failed ? `, ${R.failed} failed` : ''}`} />
        <Tile icon="clock" tone="amber" label="This month so far" value={inr(spentInr)} sub={`${rs(mtdUsage)} usage + ${rs(fixedUsd * dom / dim)} of plans`} />
        <Tile icon="trend" tone="blue" label="Month, projected" value={inr(projInr)} sub={budget ? `Budget ${inr(budget)}` : 'Set a budget below'} />
        <Tile icon="spark" tone="violet" label="Tokens and images" value={`${((Number(R.input_tokens || 0) + Number(R.output_tokens || 0)) / 1e6).toFixed(2)}M`} sub={`${Number(R.images || 0)} images made`} />
      </section>

      {budget && <div className="budget"><span className="progress"><i style={{ width: `${Math.min(100, spentInr / budget * 100)}%` }} className={over ? 'bad' : warn ? 'warn' : ''} /><b style={{ left: `${Math.min(100, projInr / budget * 100)}%` }} title="Projected" /></span>
        <span className="sm">{inr(spentInr)} of {inr(budget)} · projected {inr(projInr)}</span></div>}

      <div className="bento">
        <section className="card s8">
          <div className="card-head"><div><h3>Cost by day</h3><p className="sub">AI and API calls, {RANGES[range].toLowerCase()}</p></div><b className="card-num">{rs(R.cost_usd || 0)}</b></div>
          {days.length ? <div className="bars" role="img" aria-label={`Daily cost, highest ${rs(max)}`}>{days.map(([d, c]) => (
            <span key={d} title={`${new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${rs(c)}`}><i style={{ height: `${Math.max(2, (c / max) * 100)}%` }} /></span>
          ))}</div> : <div className="empty"><Icon name="chart" size={26} /><p>No calls logged in this period yet. Logging started with this update.</p></div>}
        </section>

        <section className="card s4">
          <div className="card-head"><div><h3>By provider and model</h3><p className="sub">Where the money goes</p></div></div>
          <table className="tbl"><thead><tr><th>Model</th><th className="r">Calls</th><th className="r">Cost</th></tr></thead><tbody>
            {(R.by_model || []).map(m => <tr key={`${m.provider}:${m.model}`}><td><b>{PROVIDER[m.provider] || m.provider}</b><span className="sm">{m.model}{Number(m.input_tokens) + Number(m.output_tokens) ? ` · ${((Number(m.input_tokens) + Number(m.output_tokens)) / 1e3).toFixed(0)}k tokens` : ''}</span></td><td className="r">{m.calls}</td><td className="r">{rs(m.cost_usd)}</td></tr>)}
            {!(R.by_model || []).length && <tr><td colSpan={3} className="sm">Nothing yet</td></tr>}
          </tbody></table>
        </section>

        <section className="card s4">
          <div className="card-head"><div><h3>By agent</h3><p className="sub">Top 25</p></div></div>
          <table className="tbl"><tbody>{(R.by_agent || []).map(a => <tr key={a.agent_id}><td><b>{byId[a.agent_id]?.name || 'Not tied to an agent'}</b><span className="sm">{a.dept ? D[a.dept] || a.dept : ''}</span></td><td className="r">{a.calls}</td><td className="r">{rs(a.cost_usd)}</td></tr>)}
            {!(R.by_agent || []).length && <tr><td className="sm">Nothing yet</td></tr>}</tbody></table>
        </section>
        <section className="card s4">
          <div className="card-head"><div><h3>By team</h3><p className="sub">Share of the period's cost</p></div></div>
          <table className="tbl"><tbody>{(R.by_dept || []).map(a => <tr key={a.dept}><td><b>{D[a.dept] || (a.dept === 'other' ? 'Other' : a.dept)}</b></td><td className="r">{share(a.cost_usd)}</td><td className="r">{rs(a.cost_usd)}</td></tr>)}
            {!(R.by_dept || []).length && <tr><td className="sm">Nothing yet</td></tr>}</tbody></table>
        </section>
        <section className="card s4">
          <div className="card-head"><div><h3>By job</h3><p className="sub">Campaigns, SEO, designs, autopilot</p></div></div>
          <table className="tbl"><tbody>{(R.by_feature || []).map(a => <tr key={a.feature}><td><b>{featureName(a.feature)}</b></td><td className="r">{a.calls}</td><td className="r">{rs(a.cost_usd)}</td></tr>)}
            {!(R.by_feature || []).length && <tr><td className="sm">Nothing yet</td></tr>}</tbody></table>
        </section>

        <section className="card s12">
          <div className="card-head"><div><h3>By campaign or run</h3><p className="sub">The 15 costliest in this period</p></div></div>
          <table className="tbl"><thead><tr><th>Run</th><th className="r">Calls</th><th className="r">Cost</th></tr></thead><tbody>{(R.by_run || []).map(a => <tr key={a.run_id}><td><b>{a.occasion || 'Run'}</b><span className="sm">{a.kind === 'seo' ? 'SEO check' : a.kind === 'campaign' ? 'Campaign' : a.kind}</span></td><td className="r">{a.calls}</td><td className="r">{rs(a.cost_usd)}</td></tr>)}
            {!(R.by_run || []).length && <tr><td colSpan={3} className="sm">Nothing yet</td></tr>}</tbody></table>
        </section>

        <section className="card s6">
          <div className="card-head"><div><h3>Monthly plans</h3><p className="sub">Fixed costs that do not depend on usage. Check them against your invoices.</p></div><b className="card-num">{rs(fixedUsd)}<small>/month</small></b></div>
          <ul className="rows">{(fixed || []).map(f => (
            <li key={f.id}><Locked key={`${f.monthly_usd}-${f.name}`} action={saveFixedCost} saved className="fixed-row" inline><input type="hidden" name="id" value={f.id} />
              <input name="name" className="in" defaultValue={f.name} aria-label="Plan" /><input name="usd" className="in num" defaultValue={String(f.monthly_usd)} aria-label="Dollars a month" /><input name="note" className="in" defaultValue={f.note || ''} placeholder="Note" aria-label="Note" />
            </Locked></li>
          ))}</ul>
          <form action={saveFixedCost} className="fixed-row add"><input name="name" className="in" placeholder="Add a plan, e.g. Domain" required aria-label="Plan" /><input name="usd" className="in num" placeholder="$ / month" aria-label="Dollars a month" /><input name="note" className="in" placeholder="Note" aria-label="Note" /><Submit ghost small icon="plus" pending="Adding…">Add</Submit></form>
        </section>

        <section className="card s6">
          <div className="card-head"><div><h3>Budget and exchange rate</h3><p className="sub">The Budget Guard warns you once a month when spend reaches the alert level.</p></div></div>
          <Locked key={`${fx}-${budget}-${alertPct}`} action={saveBilling} saved={!!settings} className="stack billing" label="Save">
            <label className="field">Rupees per US dollar<input name="usd_inr" className="in" defaultValue={String(fx)} inputMode="decimal" /></label>
            <label className="field">Monthly budget in rupees<input name="budget" className="in" defaultValue={budget ? String(budget) : ''} placeholder="e.g. 15000" inputMode="numeric" /></label>
            <label className="field">Warn me at (% of budget)<input name="alert" className="in" defaultValue={String(alertPct)} inputMode="numeric" /></label>
          </Locked>
        </section>

        <section className="card s12">
          <div className="card-head"><div><h3>Price list</h3><p className="sub">Estimates use these. Tokens are priced per million; images and calls per unit, in US dollars. A provider:* row covers models without their own row.</p></div></div>
          <table className="tbl prices"><thead><tr><th>Model</th><th>Input / 1M</th><th>Output / 1M</th><th>Per call</th><th>Note</th><th /></tr></thead><tbody>
            {(prices || []).map(p => (
              <tr key={p.key}><td colSpan={6}><Locked key={`${p.key}-${p.updated_at}`} action={savePrice} saved inline className="price-row"><input type="hidden" name="key" value={p.key} />
                <b className="clip">{p.key}</b><input name="in" className="in num" defaultValue={String(p.in_per_m)} aria-label="Input price" /><input name="out" className="in num" defaultValue={String(p.out_per_m)} aria-label="Output price" />
                <input name="unit" className="in num" defaultValue={String(p.per_unit)} aria-label="Price per call" /><input name="note" className="in" defaultValue={p.note || ''} aria-label="Note" />
              </Locked></td></tr>
            ))}
          </tbody></table>
          <form action={savePrice} className="price-row add"><input name="key" className="in" placeholder="openai:gpt-5" required aria-label="Model key" /><input name="in" className="in num" placeholder="In" aria-label="Input price" /><input name="out" className="in num" placeholder="Out" aria-label="Output price" /><input name="unit" className="in num" placeholder="Per call" aria-label="Price per call" /><input name="note" className="in" placeholder="Note" aria-label="Note" /><Submit ghost small icon="plus" pending="Adding…">Add</Submit></form>
        </section>

        <section className="card s12">
          <div className="card-head"><div><h3>Every call</h3><p className="sub">Newest first, {RANGES[range].toLowerCase()}</p></div></div>
          <div className="tbl-wrap"><table className="tbl log"><thead><tr><th>When</th><th>Provider</th><th>Agent</th><th>Job</th><th className="r">Tokens in / out</th><th className="r">Time</th><th className="r">Cost</th></tr></thead><tbody>
            {(log || []).map(l => <tr key={l.id} className={l.ok ? '' : 'bad'}>
              <td>{when(l.at)}</td><td><b>{PROVIDER[l.provider] || l.provider}</b><span className="sm">{l.model}</span></td><td>{l.agent_id ? byId[l.agent_id]?.name || l.agent_id : '–'}</td>
              <td>{l.feature ? featureName(l.feature) : '–'}</td><td className="r">{l.input_tokens || l.output_tokens ? `${l.input_tokens.toLocaleString('en-IN')} / ${l.output_tokens.toLocaleString('en-IN')}` : l.units > 1 ? `${l.units} units` : '–'}</td>
              <td className="r">{l.ms ? `${(l.ms / 1000).toFixed(1)}s` : '–'}</td><td className="r">{l.ok ? rs(l.cost_usd) : <span className="err">failed</span>}</td></tr>)}
            {!(log || []).length && <tr><td colSpan={7} className="sm">No calls logged in this period yet.</td></tr>}
          </tbody></table></div>
          <Pager sp={sp} param="lp" page={lp} size={LOG} total={logCount} shown={(log || []).length} />
        </section>
      </div>
    </div>
  );
}
