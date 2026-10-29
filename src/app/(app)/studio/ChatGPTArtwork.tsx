'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from './ChatGPTArtwork.module.css';

type Packet = { prompt: string; requestId: string };
type Provider = 'chatgpt' | 'higgsfield';
type ImportedArtwork = { status: 'ready'; imageUrl: string; version: number; provider: Provider };
export type ChatGPTArtworkProps = {
  source: 'design' | 'creative';
  id: string;
  requestId?: string | null;
  title?: string;
  compact?: boolean;
  status?: string;
  initialProvider?: Provider;
  automaticChatGPT?: boolean;
};

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const PROVIDERS = {
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/' },
  higgsfield: { label: 'Higgsfield', url: 'https://higgsfield.ai/ai/image?model=nano-banana-pro' },
} as const;

async function responseError(response: Response) {
  const result = await response.json().catch(() => null);
  return new Error(typeof result?.error === 'string' ? result.error : `The request could not be completed (${response.status}). Try again.`);
}

type GenerationJob = { id: string; state: string; model?: string; error?: string | null; errorCode?: string; warning?: string | null; imageUrl?: string | null };
type GenerationStatus = { connected: boolean; accountName?: string | null; balance: { credits: number | null }; models: Array<{id:string;name:string;credits:number|null;available:boolean;error?:string}>; job: GenerationJob | null; requestId: string };
const ACTIVE_JOBS = new Set(['queued','submitting','submitted','collecting']);

/** Read credits only on demand; poll only an explicitly opened active generation. */
export function HiggsfieldGeneration({ source, id, requestId, title, initialGenerating = false, disabled = false, onActive, onPending }: {
  source: 'design' | 'creative'; id: string; requestId?: string | null; title?: string; initialGenerating?: boolean; disabled?: boolean; onActive: (active: boolean) => void; onPending?: (pending: boolean) => void;
}) {
  const router = useRouter(), labelId = useId();
  const [data, setData] = useState<GenerationStatus | null>(null), [model, setModel] = useState('gpt_image_2_5');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false), base = `/api/studio/artwork/${source}/${encodeURIComponent(id)}/generation`;
  const active = data ? !!data.job && ACTIVE_JOBS.has(data.job.state) : initialGenerating;
  const choice = data?.models.find(item => item.id === model);
  const balance = data?.balance.credits, cost = choice?.credits;
  const exhausted = typeof balance === 'number' && balance <= 0;
  const sufficient = typeof balance === 'number' && Number.isFinite(balance) && balance > 0 && typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && balance >= cost;
  const needsNewRequest = !!data?.job && ['uncertain','failed','cancelled','completed','succeeded','ready'].includes(data.job.state);
  const canGenerate = !!data?.connected && !!choice?.available && sufficient && !active && !needsNewRequest && !busy && !disabled;

  async function load() {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); onPending?.(true); setError('');
    try {
      const response = await fetch(base, { cache: 'no-store' });
      if (!response.ok) throw await responseError(response);
      const next: GenerationStatus = await response.json();
      if (!Array.isArray(next.models) || !next.balance || !next.requestId) throw new Error('Generation status is incomplete. Refresh the status to try again.');
      if (requestId && next.requestId !== requestId) throw new Error('This artwork request changed. Refresh Studio before generating.');
      if (next.job?.model && ['gpt_image_2_5','nano_banana_pro'].includes(next.job.model)) setModel(next.job.model);
      setData(next); onActive(!!next.job && ACTIVE_JOBS.has(next.job.state));
      if (next.job?.imageUrl || (initialGenerating && next.job && !ACTIVE_JOBS.has(next.job.state))) router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Generation status could not be loaded.'); }
    finally { inFlight.current = false; setBusy(false); onPending?.(false); }
  }

  useEffect(() => {
    if (!data?.job || !ACTIVE_JOBS.has(data.job.state)) return;
    const timer = setTimeout(() => { void load(); }, 5000);
    return () => clearTimeout(timer);
  }, [data]); // a fresh status schedules the next active-job check

  async function generate() {
    if (!canGenerate || inFlight.current || !data) return;
    inFlight.current = true; setBusy(true); onPending?.(true); setError('');
    try {
      const response = await fetch(base, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ requestId: data.requestId, model }) });
      if (!response.ok) throw await responseError(response);
      const result: { job: GenerationJob } = await response.json();
      if (!result.job?.id || !result.job.state) throw new Error('The generation response was incomplete. Refresh its status before trying again.');
      if (result.job.model && ['gpt_image_2_5','nano_banana_pro'].includes(result.job.model)) setModel(result.job.model);
      setData({ ...data, job: result.job }); onActive(ACTIVE_JOBS.has(result.job.state)); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Generation could not start. Refresh its status before trying again.'); }
    finally { inFlight.current = false; setBusy(false); onPending?.(false); }
  }

  return <div className={styles.automatic} aria-busy={busy}>
    <p>Generate and save the image inside AI Office using your connected Higgsfield account and its credits.</p>
    {!data && <button type="button" className="btn sm-btn" disabled={busy || disabled} onClick={() => void load()}>{busy ? 'Checking Higgsfield…' : initialGenerating ? 'Check generation progress' : 'Check connection and credits'}</button>}
    {data && <>
      <div className={styles.generationFacts}><span>{data.connected ? data.accountName || 'Higgsfield connected' : 'Higgsfield not connected'}</span><b>Balance: {typeof balance === 'number' ? `${balance} credits` : 'Unavailable'}</b></div>
      {!data.connected ? <><p>A Super Admin can connect Higgsfield in Settings. Connecting does not start generation.</p><a className="btn ghost sm-btn" href="/admin?tab=connections#higgsfield">Higgsfield connection settings</a></> : <>
        <label className={styles.model} htmlFor={`${labelId}-model`}>Image model<select id={`${labelId}-model`} value={model} disabled={busy || active || !!data.job} onChange={event => { if (!data.job) setModel(event.target.value); }}>
          <option value="gpt_image_2_5">GPT Image 2.5</option><option value="nano_banana_pro">Nano Banana Pro</option>
        </select></label>
        <p>Estimated cost: {typeof cost === 'number' ? `${cost} Higgsfield credits` : 'Unavailable'} · 2K</p>
        {data.job && !active && !data.job.imageUrl && <p>This request keeps its saved model. Prepare a new artwork revision to change models.</p>}
        {choice && !choice.available && <p role="status">{choice.error || 'This model is unavailable for this account.'}</p>}
        {exhausted && <p role="status">Your Higgsfield credit balance is zero. Generation is paused until credits are available.</p>}
        {!exhausted && typeof balance === 'number' && typeof cost === 'number' && balance < cost && <p role="status">This image needs {cost} credits; the available balance is {balance}. Generation is paused.</p>}
        {!active && !needsNewRequest && <button type="button" className="btn sm-btn" disabled={!canGenerate} onClick={() => void generate()}>{busy ? 'Starting generation…' : 'Generate in AI Office'}</button>}
      </>}
      {active && <p className={styles.notice} role="status">{data.job?.state === 'collecting' ? 'Saving the finished image…' : 'Higgsfield generation is in progress. The image will be saved here for human review.'}</p>}
      {data.job?.error && <p className={styles.error} role="alert">{data.job.error}</p>}
      {data.job?.warning && <p className={styles.notice} role="status">{data.job.warning}</p>}
      {data.job?.state === 'uncertain' && <p>Submission could not be confirmed. Check the Higgsfield account before preparing a new request; another generation could use more credits.</p>}
      {data.job?.state === 'failed' && <p>This generation failed. Prepare a new artwork request to try again.</p>}
      {data.job?.imageUrl && <><img className={styles.preview} src={data.job.imageUrl} alt={title || 'Higgsfield artwork awaiting human review'} /><p role="status">Saved from Higgsfield. Human review is required before approval.</p></>}
      <button type="button" className="btn ghost sm-btn" disabled={busy || disabled} onClick={() => void load()}>{busy ? 'Checking…' : 'Refresh generation status'}</button>
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}

/** Automatic Higgsfield generation with a manual website/import fallback. */
export function ChatGPTArtwork({ source, id, requestId, title, compact = false, status, initialProvider = 'higgsfield', automaticChatGPT = false }: ChatGPTArtworkProps) {
  const router = useRouter(), labelId = useId();
  const [chosenProvider, setProvider] = useState<Provider>(status === 'generating' ? 'higgsfield' : initialProvider);
  const provider = status === 'generating' ? 'higgsfield' : chosenProvider;
  const [generationActive, setGenerationActive] = useState(false);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [busy, setBusy] = useState<'brief' | 'pack' | 'import' | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [imported, setImported] = useState<ImportedArtwork | null>(null);
  const inFlight = useRef(false);
  const base = `/api/studio/artwork/${source}/${encodeURIComponent(id)}`;
  const selected = PROVIDERS[provider];
  const activeGeneration = generationActive || status === 'generating';

  function chooseProvider(next: Provider) {
    if (inFlight.current || activeGeneration || generationBusy || next === provider) return;
    setProvider(next); setPacket(null); setFile(null); setManualCopy(false); setNotice(''); setError('');
  }

  async function loadPacket() {
    if (packet) return packet;
    const response = await fetch(`${base}/packet?provider=${provider}`, { cache: 'no-store' });
    if (!response.ok) throw await responseError(response);
    const result = await response.json();
    if (typeof result.prompt !== 'string' || !result.prompt.trim() || typeof result.requestId !== 'string' || !result.requestId) throw new Error('The artwork brief is incomplete. Refresh the page and try again.');
    if (requestId && result.requestId !== requestId) throw new Error('This artwork request has changed. Refresh the page before creating or importing its image.');
    const next = { prompt: result.prompt, requestId: result.requestId };
    setPacket(next);
    return next;
  }

  async function run(action: 'brief' | 'pack' | 'import', work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(action); setError(''); setNotice('');
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The request could not be completed. Try again.'); }
    finally { inFlight.current = false; setBusy(null); }
  }

  function copyBrief() {
    void run('brief', async () => {
      const next = await loadPacket();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          navigator.clipboard.writeText(next.prompt),
          new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Clipboard permission did not respond.')), 2000); }),
        ]);
        setManualCopy(false);
        setNotice(`Brief copied. Attach the reference images with it in ${selected.label}.`);
      } catch {
        setManualCopy(true);
        setNotice(`The brief is ready below. Select and copy it to ${selected.label}.`);
      } finally { if (timer !== undefined) clearTimeout(timer); }
    });
  }

  function downloadPack() {
    void run('pack', async () => {
      await loadPacket();
      const response = await fetch(`${base}/pack?provider=${provider}`, { cache: 'no-store' });
      if (!response.ok) throw await responseError(response);
      const blob = await response.blob();
      if (!blob.size) throw new Error('The reference pack was empty. Try downloading it again.');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `parakkat-artwork-${id}.zip`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice(`Reference pack downloaded. Unzip it and attach the product photos and style references in ${selected.label}.`);
    });
  }

  function importArtwork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run('import', async () => {
      if (!file) throw new Error(`Choose the finished image from ${selected.label}.`);
      if (!IMAGE_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
      if (file.size === 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Choose an image larger than 0 bytes and no larger than 20 MiB.');
      const currentRequest = requestId || (await loadPacket()).requestId;
      const form = new FormData(); form.set('requestId', currentRequest); form.set('file', file); form.set('provider', provider);
      const response = await fetch(`${base}/import`, { method: 'POST', body: form });
      if (!response.ok) throw await responseError(response);
      const result = await response.json();
      if (result.status !== 'ready' || typeof result.imageUrl !== 'string' || !result.imageUrl) throw new Error('The upload response was incomplete. Refresh the page to check whether the image was imported before retrying.');
      setImported({ ...result, provider }); setFile(null);
      router.refresh();
    });
  }

  if (automaticChatGPT) return <ChatGPTAutomaticArtwork key={`${source}:${id}:${requestId}`} source={source} id={id} requestId={requestId} title={title} compact={compact} status={status} />;

  if (imported) return <section className={styles.handoff} aria-label={`Imported ${PROVIDERS[imported.provider].label} artwork`}>
    <strong>{PROVIDERS[imported.provider].label} artwork imported · v{imported.version}</strong>
    <img className={styles.preview} src={imported.imageUrl} alt={title || 'Imported artwork awaiting human review'} />
    <p role="status">Ready for human review. Check the product, wording and brand details before approving it.</p>
    <a href={`/studio#d-${id}`} className="btn ghost sm-btn">Review in Studio</a>
  </section>;

  return <section className={`${styles.handoff} ${compact ? styles.compact : ''}`} aria-labelledby={`${labelId}-title`} aria-busy={busy !== null}>
    <strong id={`${labelId}-title`}>{provider === 'higgsfield' ? 'Higgsfield artwork' : 'ChatGPT manual import'}</strong>
    <fieldset className={styles.providers} disabled={busy !== null || activeGeneration || generationBusy}>
      <legend>Generate with</legend>
      <div>{(Object.keys(PROVIDERS) as Provider[]).map(choice => <label key={choice} className={provider === choice ? styles.selectedProvider : ''}>
        <input type="radio" name={`${labelId}-provider`} value={choice} checked={provider === choice} onChange={() => chooseProvider(choice)} />
        <span>{PROVIDERS[choice].label}<small>{choice === 'higgsfield' ? 'Generate in AI Office' : 'Manual import'}</small></span>
      </label>)}</div>
    </fieldset>
    {provider === 'higgsfield' && <HiggsfieldGeneration source={source} id={id} requestId={requestId} title={title} initialGenerating={status === 'generating'} disabled={busy !== null} onActive={setGenerationActive} onPending={setGenerationBusy} />}
    {provider === 'chatgpt' && <p>ChatGPT is a manual import option here; its connected account does not support automatic image generation in AI Office.</p>}
    {!activeGeneration && !generationBusy && <details className={styles.manual} open={provider === 'chatgpt'}><summary>{provider === 'higgsfield' ? 'Manual Higgsfield fallback' : 'Create in ChatGPT and import'}</summary>
    <p>Create the image in {selected.label}, then import it here. Your {selected.label} plan and model limits apply.</p><ol className={styles.steps}>
      <li><b>Get the brief and references</b>
        <div className={styles.actions}>
          <button type="button" className="btn ghost sm-btn" disabled={busy !== null} onClick={copyBrief}>{busy === 'brief' ? 'Preparing brief…' : 'Copy brief'}</button>
          <button type="button" className="btn ghost sm-btn" disabled={busy !== null} onClick={downloadPack}>{busy === 'pack' ? 'Preparing pack…' : 'Download reference pack'}</button>
        </div>
      </li>
      <li><b>Generate in {selected.label}</b><p>Unzip the pack, attach its product photos and style references, paste the brief, and {provider === 'higgsfield' ? 'use Nano Banana Pro with Unlimited enabled. Confirm the generate button says Unlimited before generating. Availability depends on the model and resolution.' : 'ask ChatGPT to create the image.'}</p>
        <a className="btn ghost sm-btn" href={selected.url} target="_blank" rel="noreferrer">Open {selected.label} <span aria-hidden="true">↗</span></a>
      </li>
      <li><b>Import the finished image</b><form className={styles.upload} onSubmit={importArtwork}>
        <label htmlFor={`${labelId}-file`}>PNG, JPEG or WebP · up to 20 MiB</label>
        <input key={provider} id={`${labelId}-file`} type="file" accept="image/png,image/jpeg,image/webp" required disabled={busy !== null} onChange={event => { setFile(event.target.files?.[0] || null); setError(''); setNotice(''); }} />
        <button className="btn sm-btn" type="submit" disabled={!file || busy !== null}>{busy === 'import' ? 'Importing image…' : 'Import for review'}</button>
      </form></li>
    </ol>
    {packet && <details className={styles.brief} open={manualCopy}><summary>View or manually copy the brief</summary><textarea aria-label={`${selected.label} artwork brief`} readOnly value={packet.prompt} rows={8} onFocus={event => event.currentTarget.select()} /></details>}
    </details>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.review}>Generated or imported images need a person to review the product, text and brand details before approval.</p>
  </section>;
}

type ChatGPTJob = {id:string;state:'queued'|'preparing'|'generating'|'succeeded'|'blocked'|'uncertain'|'cancelled';error?:string|null;imageUrl?:string|null};
type ChatGPTStatus = {enabled:boolean;requestId:string;job:ChatGPTJob|null};
const CHATGPT_ACTIVE = new Set(['queued','preparing','generating']);

/** Status reads never queue work. The separate worker generates only after an explicit request. */
export function ChatGPTAutomaticArtwork({source,id,requestId,title,compact=false,status}:ChatGPTArtworkProps) {
  const router=useRouter(),labelId=useId();
  const [data,setData]=useState<ChatGPTStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(false),inFlight=useRef(false),controller=useRef<AbortController|null>(null),requestEpoch=useRef(0);
  const base=`/api/studio/artwork/${source}/${encodeURIComponent(id)}/chatgpt-generation`;
  const refresh=router.refresh;
  const read=useCallback(async()=>{
    if(inFlight.current||!mounted.current)return;
    inFlight.current=true;setBusy(true);setError('');
    const epoch=requestEpoch.current,abort=new AbortController();controller.current=abort;
    try {
      const response=await fetch(base,{cache:'no-store',signal:abort.signal});
      if(!response.ok)throw await responseError(response);
      const next:ChatGPTStatus=await response.json();
      if(typeof next.enabled!=='boolean'||!next.requestId||!('job' in next))throw new Error('Generation status is incomplete. Refresh to try again.');
      if(requestId&&next.requestId!==requestId)throw new Error('This artwork request changed. Refresh Studio before generating.');
      if(!mounted.current||epoch!==requestEpoch.current)return;
      setData(next);
      if(next.job?.state==='succeeded'||(status==='generating'&&next.job&&!CHATGPT_ACTIVE.has(next.job.state)))refresh();
    } catch(cause) {if(mounted.current&&epoch===requestEpoch.current&&!abort.signal.aborted)setError(cause instanceof Error?cause.message:'Generation status could not be loaded.');}
    finally {if(epoch===requestEpoch.current){inFlight.current=false;if(mounted.current)setBusy(false);}}
  },[base,requestId,status,refresh]);
  useEffect(()=>{
    mounted.current=true;requestEpoch.current++;inFlight.current=false;setData(null);void read();
    return()=>{mounted.current=false;requestEpoch.current++;controller.current?.abort();inFlight.current=false;};
  },[read]);
  const active=!!data?.job&&CHATGPT_ACTIVE.has(data.job.state);
  useEffect(()=>{
    if(!active||busy)return;
    const timer=setTimeout(()=>{void read();},5000);return()=>clearTimeout(timer);
  },[active,busy,data?.job?.state,read]);
  const otherActive=status==='generating'&&!!data&&!data.job;
  const locked=!!data?.job&&['uncertain','cancelled','succeeded'].includes(data.job.state);
  const canStart=!!data?.enabled&&!busy&&!active&&!locked&&!otherActive;
  async function start() {
    if(!canStart||inFlight.current||!data)return;
    inFlight.current=true;setBusy(true);setError('');
    const epoch=requestEpoch.current,abort=new AbortController();controller.current=abort;
    try {
      const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:data.requestId}),signal:abort.signal});
      if(!response.ok)throw await responseError(response);
      const next:{job:ChatGPTJob}=await response.json();
      if(!next.job?.id||!next.job.state)throw new Error('The queue response was incomplete. Refresh status before trying again.');
      if(!mounted.current||epoch!==requestEpoch.current)return;
      setData({...data,job:next.job});refresh();
    }catch(cause){if(mounted.current&&epoch===requestEpoch.current&&!abort.signal.aborted)setError(cause instanceof Error?cause.message:'The image could not be queued.');}
    finally{if(epoch===requestEpoch.current){inFlight.current=false;if(mounted.current)setBusy(false);}}
  }
  const progress=data?.job?.state==='queued'?'Queued for ChatGPT image generation. The worker checks the queue every 15 minutes.':data?.job?.state==='preparing'?'Preparing the saved brief and reference images…':'ChatGPT is generating the image. It will be saved here for human review.';
  return <section className={`${styles.handoff} ${compact?styles.compact:''}`} aria-labelledby={`${labelId}-title`} aria-busy={busy}>
    <strong id={`${labelId}-title`}>ChatGPT image generation</strong>
    <p>Images are generated automatically using your ChatGPT plan and saved in AI Office for human review. Your plan’s usage limits apply.</p>
    {active&&<p className={styles.notice} role="status">{progress}</p>}
    {otherActive&&<p role="status">This request already has a generation in progress. Open its existing provider controls below.</p>}
    {data&&!data.enabled&&<p role="status">The ChatGPT image worker is not enabled. Your artwork remains available.</p>}
    {data?.job?.error&&<p className={styles.error} role="alert">{data.job.error}</p>}
    {data?.job?.state==='uncertain'&&<p>The previous generation could not be confirmed. Its saved files need to be checked before another image is requested.</p>}
    {data?.job?.state==='cancelled'&&<p>This request is no longer active. Prepare a new revision in Studio.</p>}
    {data?.job?.state==='succeeded'&&<><p role="status">Saved from ChatGPT. Human review is required before approval.</p>{data.job.imageUrl&&<img className={styles.preview} src={data.job.imageUrl} alt={title||'ChatGPT artwork awaiting human review'} />}</>}
    {canStart&&<button type="button" className="btn sm-btn" onClick={()=>void start()}>{data?.job?.state==='blocked'?'Retry ChatGPT preparation':'Generate with ChatGPT'}</button>}
    <button type="button" className="btn ghost sm-btn" disabled={busy} onClick={()=>void read()}>{busy?'Checking generation…':'Refresh generation status'}</button>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {!active&&!locked&&<details className={styles.manual}><summary>Manual import and other provider options</summary><ChatGPTArtwork source={source} id={id} requestId={requestId} title={title} compact status={otherActive?status:undefined} initialProvider="chatgpt" /></details>}
    <p className={styles.review}>Review the product, wording and brand details in Studio before approval.</p>
  </section>;
}
