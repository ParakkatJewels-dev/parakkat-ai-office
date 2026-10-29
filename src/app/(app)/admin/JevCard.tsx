import { Icon } from '@/components/Icon';
import { Locked, Submit } from '@/components/forms';
import { when } from '@/components/ui';
import { getJevStatus } from '@/lib/llm/jev-config';
import { runJevTest, saveJevKey, useJevServerKey } from './jev-actions';
import styles from './Integrations.module.css';

export async function JevCard() {
  let config: Awaited<ReturnType<typeof getJevStatus>> | null = null;
  try { config = await getJevStatus(); } catch { /* Secret storage details never reach the page. */ }
  const verified = config?.status === 'connected' && !!config.checkedAt && !config.error;
  return <li id="jev" className={styles.card}>
    <div className="integr-top">
      <span className="tile-ic"><Icon name="spark" size={18} /></span>
      <div className="grow"><b>Jev classification</b><span className="sm">Focused routing and classification with TypeSafe</span></div>
      <span className={`pill ${config?.error ? 'bad' : verified ? 'good' : ''}`}>{config?.error ? 'Needs attention' : verified ? 'Verified' : config?.configured ? 'Key configured' : 'Not configured'}</span>
    </div>
    {!config && <p className={styles.notice} role="status">The server could not read the Jev configuration. Check the server setup before saving a key.</p>}
    {config?.configured && <p className="sm">Key: •••••••• · {config.source === 'saved' ? 'saved securely in this app' : 'installed server setting'}</p>}
    <p className="sm">Model: {config?.model || 'jev-latest'}. ChatGPT continues to prepare deliverables. Head, QC and human reviews remain required.</p>
    {config?.error && <p className={styles.notice} role="status">{config.error}</p>}
    {config?.checkedAt && <p className="sm">Last classification request: {when(config.checkedAt)}</p>}
    <details className={styles.configure} open={!config?.configured}>
      <summary>{config?.configured ? 'Manage API key' : 'Add Jev API key'}<span>Secure credentials</span></summary>
      <div className={styles.configurationBody}>
        <Locked key={`${config?.source}:${config?.updatedAt || ''}`} action={saveJevKey} saved={!!config?.configured} className="integr-pick" label="Save key" savedNote="The key is never shown again">
          <label className="field">Jev API key<input name="key" type="password" className="in" autoComplete="new-password" required={!config?.configured} maxLength={512} placeholder={config?.configured ? 'Leave empty to keep the current key' : 'Paste your Jev API key'} /></label>
          <p className="sm">Save checks model access without running a classification. A saved key takes priority over the installed server key.</p>
        </Locked>
        {config?.source === 'saved' && <div className="integr-act"><form action={useJevServerKey}>
          <Submit ghost small pending="Restoring server setting…" confirmTitle="Use the installed server key?" confirmLabel="Use server key" confirm="Remove the Jev key saved in AI Office. Jev will use the installed server key if one is configured; otherwise Jev routing is unavailable.">Use installed server key</Submit>
        </form></div>}
      </div>
    </details>
    {config?.configured && <div className={styles.testAction}>
      <div><b>Verify classification</b><p className="sm">Runs one short synthetic example under your text-usage limits. Jev usage charges may apply.</p></div>
      <form action={runJevTest}><Submit ghost small name="classify" value="yes" pending="Running test…" confirmTitle="Run one Jev test?" confirmLabel="Run test" confirm="This sends one synthetic classification to Jev and counts toward your text-usage limits. Jev usage charges may apply.">Run test</Submit></form>
    </div>}
  </li>;
}
