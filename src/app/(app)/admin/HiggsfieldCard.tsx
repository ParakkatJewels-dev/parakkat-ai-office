import { getHiggsfieldStatus } from '@/lib/higgsfield/auth.mjs';
import { Icon } from '@/components/Icon';
import styles from './Integrations.module.css';

/** The status is local and sanitized; opening Settings never reads credits or generates an image. */
export async function HiggsfieldCard() {
  const status = await getHiggsfieldStatus().catch(() => null);
  return <li id="higgsfield" className={styles.card}>
    <div className="integr-top"><span className="tile-ic"><Icon name="spark" size={18} /></span>
      <div className="grow"><b>Higgsfield</b><span className="sm">Automatic artwork in AI Office</span></div>
      <span className={`pill ${status?.connected ? 'good' : ''}`}>{!status ? 'Status unavailable' : status.connected ? 'Connected' : 'Not connected'}</span>
    </div>
    {status?.connected && <p className="sm">{status.accountName || status.accountId || 'Higgsfield account connected'}{status.workspaceName ? ` · ${status.workspaceName}` : ''}</p>}
    <p className="sm">Generate with GPT Image 2.5 or Nano Banana Pro using your Higgsfield credits. Finished images return to Studio and chat for human review.</p>
    <p className="sm">Studio checks the estimated credit cost and your balance before generation. Connecting does not generate images, upgrade your plan, or retry earlier requests.</p>
    {(!status || status.error) && <p className={styles.notice} role="status">{status?.error || 'The saved connection status could not be read. Try again shortly.'}</p>}
    <div className="integr-act">
      <form action="/api/higgsfield/connect" method="post"><button className="btn sm-btn" type="submit">{status?.connected ? 'Reconnect Higgsfield' : 'Connect Higgsfield'}</button></form>
      {status?.connected && <form action="/api/higgsfield/disconnect" method="post"><button className="btn ghost sm-btn" type="submit">Disconnect Higgsfield</button></form>}
      <a href="/studio" className="btn ghost sm-btn">Open Studio</a>
    </div>
  </li>;
}
