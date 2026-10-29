import { Icon } from '@/components/Icon';
import { Locked, Submit } from '@/components/forms';
import { when } from '@/components/ui';
import { getGeminiStatus } from '@/lib/llm/gemini-config';
import { getImageBudgetStatus, type ImageBudgetStatus } from '@/lib/ai-budget';
import { generateGeminiTest, saveGeminiKey, useGeminiServerKey } from './gemini-actions';
import styles from './Integrations.module.css';
import { isChatGPTHandoff } from '@/lib/artwork-mode.mjs';

export async function GeminiCard() {
  if (isChatGPTHandoff()) return <li id="gemini" className={styles.card}>
    <div className="integr-top">
      <span className="tile-ic"><Icon name="spark" size={18} /></span>
      <div className="grow"><b>Artwork through Higgsfield</b><span className="sm">Generate in AI Office, then review</span></div>
      <span className="pill">Gemini image API disabled</span>
    </div>
    <p className="sm">Connect Higgsfield to generate artwork in Studio with subscription credits. AI Office prepares the product photos and design references, saves the finished image, and keeps it ready for review. ChatGPT remains a manual import option.</p>
    <p className="sm">The Gemini image API is disabled. Higgsfield credits and model availability apply. All artwork requires human review before approval.</p>
    <a href="/studio" className="btn ghost sm-btn">Open Design Studio</a>
  </li>;
  const [configuration, budget] = await Promise.allSettled([getGeminiStatus(), getImageBudgetStatus()]);
  const config = configuration.status === 'fulfilled' ? configuration.value : null;
  const imageBudget:ImageBudgetStatus|null = budget.status === 'fulfilled' ? budget.value : null;
  const verified = config?.status === 'connected' && !!config.checkedAt && !config.error;
  return (
    <li id="gemini" className={styles.card}>
      <div className="integr-top">
        <span className="tile-ic"><Icon name="spark" size={18} /></span>
        <div className="grow"><b>Gemini images</b><span className="sm">Studio artwork and visual checks, generated on the server</span></div>
        <span className={`pill ${config?.error ? 'bad' : verified ? 'good' : ''}`}>
          {config?.error ? 'Needs attention' : verified ? 'Images verified' : config?.configured ? 'Key configured' : 'Not configured'}
        </span>
      </div>
      {!config && <p className={styles.notice} role="status">The server could not read the Gemini configuration. Check the server setup before saving a key.</p>}
      {config?.configured && <p className="sm">Key: •••••••• · {config.source === 'saved' ? 'saved securely in this app' : 'installed server setting'}</p>}
      <p className="sm">Image model: {config?.imageModel || 'gemini-3-pro-image'} · {config?.imageSize || '2K'}. Your ChatGPT connection continues to handle agent reasoning.</p>
      <p className={imageBudget?.blocked || !imageBudget ? styles.notice : 'sm'}>{imageBudget?imageBudget.enabled?`Image attempts: ${imageBudget.daily}/${imageBudget.dailyLimit} in 24 hours · ${imageBudget.weekly}/${imageBudget.weeklyLimit} in 7 days. App caps are enabled.`:`Image attempts: ${imageBudget.daily} in 24 hours · ${imageBudget.weekly} in 7 days. Monitoring only; no app cap. Provider quotas still apply.`:'Image usage accounting is unavailable; generation waits until it can be recorded.'}</p>
      <p className="sm">Selected design references are read temporarily as visual examples. Source images are not retained in AI Office storage. Every attempt is counted, including failed or uncertain requests.</p>
      {config?.error && <p className={styles.notice} role="status">{config.error}</p>}
      {config?.checkedAt && <p className="sm">Last image request: {when(config.checkedAt)}</p>}
      <details className={styles.configure} open={!config?.configured}>
        <summary>{config?.configured ? 'Manage API key' : 'Add Gemini API key'}<span>Secure credentials</span></summary>
        <div className={styles.configurationBody}>
      <Locked key={`${config?.source}:${config?.updatedAt || ''}`} action={saveGeminiKey} saved={!!config?.configured}
        className="integr-pick" label="Save key" savedNote="The key is never shown again">
        <label className="field">Gemini API key<input name="key" type="password" className="in" autoComplete="new-password"
          required={!config?.configured} maxLength={512} placeholder={config?.configured ? 'Leave empty to keep the current key' : 'Paste your Gemini API key'} /></label>
        <p className="sm">Save checks model access without generating an image. A saved key takes priority over the installed server key.</p>
      </Locked>
      {config?.source === 'saved' && <div className="integr-act"><form action={useGeminiServerKey}>
        <Submit ghost small pending="Restoring server setting…" confirmTitle="Use the installed server key?" confirmLabel="Use server key" confirm="Remove the key saved in AI Office. Image generation will use the installed server key if one is configured; otherwise it will wait for a new key.">Use installed server key</Submit>
      </form></div>}
        </div>
      </details>
      {config?.configured && <div className={styles.testAction}>
        <div><b>Verify image generation</b><p className="sm">Creates one test image to check quota. Gemini usage charges may apply.</p></div>
        <form action={generateGeminiTest}><Submit ghost small name="generate" value="yes" pending="Generating test…" confirmTitle="Generate a test image?" confirmLabel="Generate test" confirm="This creates one simple image using your configured Gemini model and records the attempt. Gemini usage charges may apply.">Generate test</Submit></form>
      </div>}
    </li>
  );
}
