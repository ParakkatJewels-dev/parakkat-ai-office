import { getChatGPTStatus } from '@/lib/chatgpt/auth.mjs';
import { listChatGPTModels } from '@/lib/llm/chatgpt.mjs';
import { Icon } from '@/components/Icon';
import { Locked, Submit } from '@/components/forms';
import { chooseChatGPTAccount, disconnectChatGPT, resumeChatGPT, saveChatGPTModels } from './chatgpt-actions';
import styles from './Integrations.module.css';

export async function ChatGPTCard() {
  let status: Awaited<ReturnType<typeof getChatGPTStatus>> | null = null;
  let problem = '';
  try { status = await getChatGPTStatus(); }
  catch { problem = 'The server could not read the ChatGPT connection. Check the protected credential directory and its permissions.'; }
  let models: Awaited<ReturnType<typeof listChatGPTModels>> = [];
  if (status?.enabled && status.connected && status.activeAccountId && !status.usageBlocked) {
    try { models = await listChatGPTModels(status.activeAccountId); }
    catch { problem = 'Could not load this account’s models. Sign in again if access has expired, then reload this page.'; }
  }
  const active = status?.accounts.find(a => a.active);
  const used = process.env.LLM_PROVIDER === 'chatgpt';
  const overrides = !!(process.env.CHATGPT_MANAGER_MODEL || process.env.CHATGPT_WORKER_MODEL);
  return (
    <li id="chatgpt" className={styles.card}>
      <div className="integr-top">
        <span className="tile-ic"><Icon name="spark" size={18} /></span>
        <div className="grow"><b>ChatGPT</b><span className="sm">Agent reasoning through your ChatGPT plan</span></div>
        <span className={`pill ${status?.usageBlocked ? 'warn' : status?.enabled && status.connected ? 'good' : ''}`}>
          {status?.usageBlocked ? 'Usage paused' : status?.enabled && status.connected ? 'Connected' : status?.enabled ? 'Not connected' : 'Self-hosted setup'}
        </span>
      </div>
      <p className="sm">{active ? `${active.label}${active.email ? ` · ${active.email}` : ''}` : 'Connect a ChatGPT account from the server setup command.'}</p>
      {problem && <p className={styles.notice} role="status">{problem}</p>}
      {status?.usageBlocked && <div className={styles.warningBlock}>
        <p role="status">ChatGPT requests are paused because this account reached its plan usage limit. Check ChatGPT usage and limits, then resume when access is available.</p>
        <form action={resumeChatGPT}><input type="hidden" name="account" value={status.activeAccountId || ''} />
          <Submit small pending="Resuming…">Resume ChatGPT requests</Submit>
        </form>
      </div>}
      {status?.enabled && status.connected && !used && <p className="sm">Connected, but agent reasoning is still using {process.env.LLM_PROVIDER || 'openai'}. Set LLM_PROVIDER=chatgpt in the server environment to switch.</p>}
      {status?.enabled && used && <p className="sm">ChatGPT handles planning, final answers, and mandatory head or QC reviews. Verified NIM prepares selected reviewed drafts. Jev classifies; Gemini handles visual work. Quality reviews wait if ChatGPT plan usage is exhausted.</p>}
      {status?.connected && (status.models.manager || status.models.worker) && <div className={styles.modelSummary}>
        <span><small>Manager model</small><b>{status.models.manager || 'Account default'}</b></span>
        <span><small>Worker model</small><b>{status.models.worker || 'Account default'}</b></span>
      </div>}
      {overrides && <p className="sm">Server model overrides are set and take priority over these selections.</p>}

      {status?.enabled && status.accounts.length > 0 && <details className={styles.configure} open={!status.connected}>
        <summary>Account and models<span>Configure reasoning</span></summary>
        <div className={styles.configurationBody}>
      {status?.enabled && status.accounts.length > 0 && <form action={chooseChatGPTAccount} className="integr-pick">
        <label className="field">ChatGPT account<select name="account" className="in" defaultValue={status.activeAccountId || ''} required>
          <option value="" disabled>Choose an account</option>
          {status.accounts.map(a => <option key={a.id} value={a.id} disabled={!a.connected}>{a.label}{a.connected ? '' : ' · sign-in required'}</option>)}
        </select></label>
        <Submit small pending="Switching…">Use account</Submit>
      </form>}

      {status?.activeAccountId && models.length > 0 && <Locked
        key={`${status.activeAccountId}:${status.models.manager}:${status.models.worker}`}
        action={saveChatGPTModels} saved={!!(status.models.manager && status.models.worker)} className="integr-pick" label="Save models" savedNote="Models for this ChatGPT account">
        <input type="hidden" name="account" value={status.activeAccountId} />
        {(['manager', 'worker'] as const).map(tier => <label className="field" key={tier}>{tier === 'manager' ? 'Manager model' : 'Worker model'}
          <select name={tier} className="in" defaultValue={status.models[tier] || models[0].slug}>
            {models.map(m => <option value={m.slug} key={m.slug}>{m.display_name}</option>)}
          </select>
        </label>)}
      </Locked>}
        </div>
      </details>}

      <details className={styles.configure} open={!status?.connected}>
        <summary>{status?.connected ? 'Reconnect ChatGPT' : 'Connect ChatGPT'}<span>Server setup</span></summary>
        <div className={styles.configurationBody}>
        <p className="sm">On the computer running your browser, open the project folder and run:</p>
        <pre><code>CHATGPT_AUTH_ENABLED=true npm run chatgpt -- login</code></pre>
        <p className="sm">Complete “Continue with ChatGPT”, then follow the VPS setup guide to transfer the protected credentials over SSH. The VPS keeps the connection renewed. To reconnect a saved account, add <code>--account ACCOUNT_ID</code>.</p>
        <p className="sm">Setup guide: <code>docs/SELF_HOST.md</code>. Your server must have <code>CHATGPT_AUTH_ENABLED=true</code> and <code>LLM_PROVIDER=chatgpt</code>.</p>
        </div>
      </details>
      <div className="integr-act">
        <a className="btn ghost sm-btn" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">ChatGPT usage and limits</a>
        {status?.enabled && active?.connected && <form action={disconnectChatGPT}>
          <input type="hidden" name="account" value={active.id} />
          <Submit ghost small danger pending="Disconnecting…" confirmTitle="Disconnect ChatGPT?" confirmLabel="Disconnect" confirm="Remove this account’s saved ChatGPT credentials from AI Office and attempt to revoke access. Requests using this account will need it to be reconnected or another account selected.">Disconnect ChatGPT</Submit>
        </form>}
      </div>
      <p className="sm">Usage counts toward the connected account’s ChatGPT plan and any credits enabled there. This app does not estimate those charges as API costs.</p>
    </li>
  );
}
