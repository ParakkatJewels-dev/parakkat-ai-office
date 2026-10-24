import { supabaseAdmin } from '@/lib/supabase/admin';
import { APP_KEYS, appReady } from '@/lib/connectors/connect';
import type { Platform } from '@/lib/connectors/vault';
import { Icon } from '@/components/Icon';
import { when } from '@/components/ui';
import { chooseAccounts, disconnect } from './actions';

const PLATFORMS: { id: Platform; name: string; what: string; envKeys: string[] }[] = [
  { id: 'meta', name: 'Meta', what: 'Ads, Facebook page and Instagram', envKeys: ['META_ACCESS_TOKEN'] },
  { id: 'google', name: 'Google', what: 'Google Ads, Keyword Planner and Analytics', envKeys: ['GOOGLE_OAUTH_REFRESH_TOKEN'] },
  { id: 'shopify', name: 'Shopify', what: 'Products, stock and orders', envKeys: ['SHOPIFY_ADMIN_TOKEN', 'SHOPIFY_STORE_DOMAIN'] },
];
const DAY = 864e5;

/** Connect buttons for each platform. Reads only the chosen accounts and expiry dates, never the tokens. */
export async function Integrations() {
  const { data } = await supabaseAdmin().from('platform_credentials').select('provider, settings, expires_at, updated_at');
  const saved = Object.fromEntries((data || []).map(r => [r.provider, r]));
  return (
    <ul className="integr">{PLATFORMS.map(p => {
      const c = saved[p.id] as { settings: Record<string, any>; expires_at: string | null; updated_at: string } | undefined;
      const ready = appReady(p.id), viaEnv = !c && p.envKeys.some(k => process.env[k]);
      const left = c?.expires_at ? Math.round((Date.parse(c.expires_at) - Date.now()) / DAY) : null;
      const s = c?.settings || {}, ch = s.choices || {};
      return (
        <li key={p.id}>
          <div className="integr-top">
            <span className="tile-ic"><Icon name="plug" size={18} /></span>
            <div className="grow"><b>{p.name}</b><span className="sm">{p.what}</span></div>
            {c ? <span className={`pill ${left !== null && left < 10 ? 'warn' : 'good'}`}>{left !== null && left < 10 ? (left <= 0 ? 'Expired' : `Expires in ${left} days`) : 'Connected'}</span>
              : viaEnv ? <span className="pill acc">Vercel keys</span> : <span className="pill">Not connected</span>}
          </div>
          {c && <span className="sm">Connected {when(c.updated_at)}{left !== null && left >= 10 ? ` · renew within ${left} days` : ''}{p.id === 'shopify' && s.shop ? ` · ${s.shop}` : ''}</span>}

          {c && p.id === 'meta' && (
            <form action={chooseAccounts} className="integr-pick"><input type="hidden" name="platform" value="meta" />
              <label className="field">Ad account<select name="ad" defaultValue={s.ad_account_id || ''} className="in"><option value="">Choose…</option>
                {(ch.ads || []).map((a: any) => <option key={a.id} value={a.id}>{a.name} ({a.id.replace('act_', '')})</option>)}</select></label>
              <label className="field">Facebook page and Instagram<select name="page" defaultValue={s.page_id || ''} className="in"><option value="">Choose…</option>
                {(ch.pages || []).map((x: any) => <option key={x.id} value={x.id}>{x.name}{x.ig_name ? ` · @${x.ig_name}` : ' · no Instagram linked'}</option>)}</select></label>
              <button className="btn ghost sm-btn">Save</button>
            </form>
          )}
          {c && p.id === 'google' && (
            <form action={chooseAccounts} className="integr-pick"><input type="hidden" name="platform" value="google" />
              {(ch.customers || []).length ? <>
                <label className="field">Google Ads account<select name="customer" defaultValue={s.customer_id || ''} className="in"><option value="">Choose…</option>
                  {ch.customers.filter((x: any) => !x.manager).map((x: any) => <option key={x.id} value={x.id}>{x.name} ({x.id})</option>)}</select></label>
                <label className="field">Through manager account<select name="login" defaultValue={s.login_customer_id || ''} className="in"><option value="">None</option>
                  {ch.customers.filter((x: any) => x.manager).map((x: any) => <option key={x.id} value={x.id}>{x.name} ({x.id})</option>)}</select></label>
              </> : <>
                <label className="field">Google Ads account id<input name="customer" className="in" defaultValue={s.customer_id || ''} placeholder="123-456-7890" /></label>
                <label className="field">Manager account id<input name="login" className="in" defaultValue={s.login_customer_id || ''} placeholder="Optional" /></label>
              </>}
              {(ch.properties || []).length
                ? <label className="field">Analytics property<select name="ga4" defaultValue={s.ga4_property_id || ''} className="in"><option value="">None</option>
                    {ch.properties.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                : <label className="field">Analytics property id<input name="ga4" className="in" defaultValue={s.ga4_property_id || ''} placeholder="Optional" /></label>}
              {s.note && <span className="sm err">Google could not list the accounts: {String(s.note).slice(0, 140)}</span>}
              <button className="btn ghost sm-btn">Save</button>
            </form>
          )}

          <div className="integr-act">
            {!ready ? <span className="sm">Add {APP_KEYS[p.id].filter(k => !process.env[k]).join(', ')} in Vercel to switch this on.</span>
              : p.id === 'shopify'
                ? <form action="/api/connect/shopify" method="get" className="inline"><input name="shop" className="in" required defaultValue={s.shop || process.env.SHOPIFY_STORE_DOMAIN || ''} placeholder="store.myshopify.com" aria-label="Shopify store" />
                    <button className="btn sm-btn">{c ? 'Reconnect' : 'Connect'}</button></form>
                : <a className="btn sm-btn" href={`/api/connect/${p.id}`}>{c ? 'Reconnect' : `Connect ${p.name}`}</a>}
            {c && <form action={disconnect}><input type="hidden" name="platform" value={p.id} /><button className="btn ghost sm-btn">Disconnect</button></form>}
          </div>
        </li>
      );
    })}</ul>
  );
}
