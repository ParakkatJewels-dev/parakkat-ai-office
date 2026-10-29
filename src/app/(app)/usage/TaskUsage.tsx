import type { SupabaseClient } from '@supabase/supabase-js';
import { Pager, pageOf, when } from '@/components/ui';
import styles from './TaskUsage.module.css';

const KINDS={all:'All tasks',campaign:'Campaigns',conversation:'Conversations',head_task:'Head tasks'} as const;
const STATUS={all:'All statuses',completed:'Completed',active:'Active or awaiting review',failed:'Failed or cancelled'} as const;
const TASK_STATUS:Record<string,string>={completed:'Completed',running:'Running',queued:'Queued',waiting:'Awaiting approval',review:'Human review',blocked:'Blocked',failed:'Failed',cancelled:'Cancelled'};
type Totals={calls:number;failed_calls:number;input_tokens:number;output_tokens:number;unknown_calls:number;estimated_tokens:number;reused:number};
type TaskRow=Totals&{task_kind:Exclude<keyof typeof KINDS,'all'>;task_id:string;task_status:string|null;first_at:string;last_at:string;pending_calls:number;cache_reused:number;inflight_reused:number;deterministic_reused:number;checkpoint_reused:number};
type Report={rows:TaskRow[];total:number;page:number;pageSize:number;totals:Totals;trackingStartedAt:string|null};
const n=(value:number)=>Number(value||0).toLocaleString('en-IN');

/** Admin route passes its authenticated client; this component never uses service-role reads. */
export default async function TaskUsage({db,sp,from,to}:{db:SupabaseClient;sp:Record<string,string|undefined>;from:string;to:string}) {
  const kind=sp.taskKind&&Object.hasOwn(KINDS,sp.taskKind)?sp.taskKind:'all';
  const status=sp.taskStatus&&Object.hasOwn(STATUS,sp.taskStatus)?sp.taskStatus:'all';
  const size=sp.ts==='50'?50:20,page=pageOf(sp,'tp');
  const end=new Date(`${to}T00:00:00Z`);end.setUTCDate(end.getUTCDate()+1);
  let report:Report|null=null;
  try {
    const response=await db.rpc('task_usage_report',{p_from:`${from}T00:00:00Z`,p_to:end.toISOString(),p_kind:kind,p_status:status,p_page:page,p_page_size:size});
    if(!response.error&&response.data&&Array.isArray(response.data.rows))report=response.data as Report;
  } catch { /* Keep the usage page available if task reporting is unavailable. */ }
  const totals=report?.totals;
  return <section className="card s12" aria-labelledby="task-usage-title">
    <div className="card-head"><div><h3 id="task-usage-title">Usage by task</h3><p className="sub">Compare model attempts and recorded tokens for each task in the selected period.</p></div></div>
    <p className={styles.notice}>Input and output are provider-reported tokens. Unknown usage is shown separately with its conservative estimate; it is not measured consumption. Reused results add no model attempt here. Task names, prompts and conversation content are private and are not included.</p>
    <form method="get" action="/usage" className={styles.filters}>
      <input type="hidden" name="tab" value="tasks"/>{sp.range&&<input type="hidden" name="range" value={sp.range}/>}
      <label>Task type<select className="in" name="taskKind" defaultValue={kind}>{Object.entries(KINDS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Task status<select className="in" name="taskStatus" defaultValue={status}>{Object.entries(STATUS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Per page<select className="in" name="ts" defaultValue={String(size)}><option value="20">20 tasks</option><option value="50">50 tasks</option></select></label>
      <button type="submit" className="btn">Apply filters</button>
    </form>
    {!report||!totals?<p className="flash" role="alert">Per-task usage could not be loaded. Try again shortly. Existing usage limits and call history remain available.</p>:<>
      <div className={styles.summary} aria-label="Task usage summary">
        <div className={styles.metric}><span>Recorded model attempts</span><strong>{n(totals.calls)}</strong><small>{n(totals.failed_calls)} failed · {n(report.total)} tasks</small></div>
        <div className={styles.metric}><span>Measured tokens</span><strong>{n(Number(totals.input_tokens)+Number(totals.output_tokens))}</strong><small>{n(totals.input_tokens)} input · {n(totals.output_tokens)} output</small></div>
        <div className={styles.metric}><span>Unknown usage</span><strong>{n(totals.unknown_calls)} attempts</strong><small>{n(totals.estimated_tokens)} estimated tokens, separate from measured usage</small></div>
        <div className={styles.metric}><span>Reused results</span><strong>{n(totals.reused)}</strong><small>Cache, shared work, saved checkpoints or deterministic answers</small></div>
      </div>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Per-task usage"><table className={`tbl ${styles.table}`}><thead><tr><th scope="col">Task</th><th scope="col">Current status</th><th scope="col" className="r">Calls</th><th scope="col" className="r">Input</th><th scope="col" className="r">Output</th><th scope="col">Unknown usage</th><th scope="col">Reused</th><th scope="col">Latest usage</th></tr></thead><tbody>
        {report.rows.map(row=><tr key={`${row.task_kind}:${row.task_id}`}>
          <th scope="row"><b>{row.task_kind==='head_task'?'Head task':row.task_kind==='conversation'?'Conversation':'Campaign'}</b><span className={styles.identity} title={row.task_id} aria-label={`Task ID ${row.task_id}`}>#{row.task_id.slice(0,8)}</span></th>
          <td><span className={`pill ${row.task_status==='completed'?'good':row.task_status==='failed'||row.task_status==='cancelled'?'bad':'warn'}`}>{TASK_STATUS[row.task_status||'']||'Unavailable'}</span></td>
          <td className="r">{n(row.calls)}{row.failed_calls>0&&<span className={styles.secondary}>{n(row.failed_calls)} failed</span>}{row.pending_calls>0&&<span className={styles.secondary}>{n(row.pending_calls)} unsettled</span>}</td>
          <td className="r">{n(row.input_tokens)}</td><td className="r">{n(row.output_tokens)}</td>
          <td>{row.unknown_calls>0?<>{n(row.unknown_calls)} attempts<span className={styles.secondary}>{n(row.estimated_tokens)} estimated tokens</span></>:'None recorded'}</td>
          <td>{row.reused>0?<details className={styles.reuse}><summary>{n(row.reused)} results</summary><p>Cached: {n(row.cache_reused)}<br/>Shared in-flight: {n(row.inflight_reused)}<br/>Deterministic: {n(row.deterministic_reused)}<br/>Saved checkpoints: {n(row.checkpoint_reused)}</p></details>:'0'}</td>
          <td>{when(row.last_at)}</td>
        </tr>)}
        {!report.rows.length&&<tr><td colSpan={8} className={styles.empty}><strong>No tracked tasks match these filters</strong><p>Task-level tracking begins with this release. Earlier calls cannot reliably be linked to individual conversation or head tasks. Try another period or status, or review Call history for earlier usage.</p></td></tr>}
      </tbody></table></div>
      <Pager sp={{...sp,tab:'tasks',taskKind:kind,taskStatus:status,ts:String(size)}} param="tp" page={report.page} size={size} total={report.total} shown={report.rows.length}/>
      <p className={styles.notice}>Only text-model attempts and reuse events recorded in this period are included. Task status is current; totals for a task spanning several periods may differ. Images and connector/API calls remain in Call history. Unknown estimates can differ from the allowance meter while settlement is pending.</p>
    </>}
  </section>;
}
