import {Icon} from '@/components/Icon';
import {Locked,Submit} from '@/components/forms';
import {when} from '@/components/ui';
import {getNimStatus} from '@/lib/llm/nim-config';
import {saveNimKeyAction,testNimAction,useNimServerKey} from './nim-actions';
import styles from './Integrations.module.css';

export async function NimCard(){
  let config:Awaited<ReturnType<typeof getNimStatus>>|null=null;
  try{config=await getNimStatus();}catch{/* Secret storage details stay on the server. */}
  const verified=config?.status==='connected';
  return <li id="nim" className={styles.card}>
    <div className="integr-top"><span className="tile-ic"><Icon name="spark" size={18}/></span>
      <div className="grow"><b>NVIDIA NIM</b><span className="sm">Internal drafts with head or QC review</span></div>
      <span className={`pill ${config?.error?'bad':verified?'good':''}`}>{config?.error?'Needs attention':verified?'Text ready':config?.configured?'Test needed':'Not configured'}</span>
    </div>
    {!config&&<p className={styles.notice} role="status">The server could not read the NVIDIA NIM configuration.</p>}
    {config?.configured&&<p className="sm">Key: •••••••• · {config.source==='saved'?'saved privately in AI Office':'installed server setting'}</p>}
    <p className="sm">Model: {config?.model||'nvidia/nemotron-3.5-lightning-30b-a3b'}. NIM prepares selected internal drafts only when ChatGPT can perform the required head or QC review. All requests count toward AI Office text limits; NVIDIA charges may apply.</p>
    {config?.error&&<p className={styles.notice} role="status">{config.error}</p>}
    {config?.checkedAt&&<p className="sm">Last verified: {when(config.checkedAt)}</p>}
    <details className={styles.configure} open={!config?.configured}><summary>{config?.configured?'Manage API key':'Add NVIDIA NIM API key'}<span>Secure credentials</span></summary>
      <div className={styles.configurationBody}>
        <Locked key={`${config?.source}:${config?.updatedAt||''}`} action={saveNimKeyAction} saved={!!config?.configured} className="integr-pick" label="Save key" savedNote="The key is never shown again">
          <label className="field">NVIDIA NIM API key<input name="key" type="password" className="in" autoComplete="new-password" required={!config?.configured} maxLength={512} placeholder={config?.configured?'Leave empty to keep the current key':'Paste your NVIDIA NIM API key'}/></label>
          <p className="sm">Saving stores the key on this VPS. A separate test verifies access before eligible text work starts.</p>
        </Locked>
        {config?.source==='saved'&&<form action={useNimServerKey}><Submit ghost small pending="Restoring server setting…" confirmTitle="Use installed server key?" confirmLabel="Use server key" confirm="Remove the NVIDIA NIM key saved in AI Office. The installed server key will be used if present.">Use installed server key</Submit></form>}
      </div>
    </details>
    {config?.configured&&<div className={styles.testAction}><div><b>Verify NIM text</b><p className="sm">Sends one small synthetic prompt to NVIDIA under your AI Office text limits. NVIDIA usage charges may apply.</p></div>
      <form action={testNimAction}><Submit ghost small name="test" value="yes" pending="Testing…" confirmTitle="Run one NVIDIA NIM test?" confirmLabel="Run test" confirm="This sends one synthetic prompt to NVIDIA and counts toward AI Office text limits. NVIDIA usage charges may apply.">Run test</Submit></form>
    </div>}
  </li>;
}
