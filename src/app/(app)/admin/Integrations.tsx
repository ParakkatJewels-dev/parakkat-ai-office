import { supabaseAdmin } from '@/lib/supabase/admin';
import { APP_KEYS, appReady } from '@/lib/connectors/connect';
import type { Platform } from '@/lib/connectors/vault';
import { Icon } from '@/components/Icon';
import { when } from '@/components/ui';
import { chosen, googleId, googleLabel, metaAdLabel, metaId, pageLabel, type GoogleChoice } from '@/lib/connectors/accounts.mjs';
import { Locked, Submit, GoLink } from '@/components/forms';
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
      // the form locks once accounts are chosen; its key changes with them so it locks again after each save
      const picked = p.id === 'meta' ? chosen(s.ad_account_ids, s.ad_account_id) : chosen(s.customer_ids, s.customer_id);
      const savedKey = JSON.stringify([picked, s.ad_account_id, s.page_id, s.login_customer_id, s.ga4_property_id, c?.updated_at]);
      const note = `${picked.length} account${picked.length === 1 ? '' : 's'} syncing`;
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
            <Locked key={savedKey} action={chooseAccounts} saved={picked.length > 0} className="integr-pick" savedNote={note}><input type="hidden" name="platform" value="meta" />
              <AccountChecks label="Ad accounts to sync" name="ad" picked={chosen(s.ad_account_ids, s.ad_account_id)}
                options={(ch.ads || []).map((a: any) => ({ id: a.id, label: metaAdLabel(a) }))} />
              <label className="field">Launch new campaigns in<select name="launch" defaultValue={s.ad_account_id || ''} className="in"><option value="">First ticked account</option>
                {(ch.ads || []).map((a: any) => <option key={a.id} value={a.id}>{metaAdLabel(a)}</option>)}</select></label>
              <label className="field">Facebook page and Instagram<select name="page" defaultValue={s.page_id || ''} className="in"><option value="">Choose…</option>
                {(ch.pages || []).map((x: any) => <option key={x.id} value={x.id}>{pageLabel(x)}</option>)}</select></label>
            </Locked>
          )}
          {c && p.id === 'google' && (
            <Locked key={savedKey} action={chooseAccounts} saved={picked.length > 0} className="integr-pick" savedNote={note}><input type="hidden" name="platform" value="google" />
              {(ch.customers || []).length ? <>
                <AccountChecks label="Google Ads accounts to sync" name="customer" picked={chosen(s.customer_ids, s.customer_id)}
                  options={(ch.customers as GoogleChoice[]).filter(x => !x.manager).map(x => ({ id: x.id, label: googleLabel(x, ch.customers) }))} />
                <label className="field">Manager account, for accounts not found under one<select name="login" defaultValue={s.login_customer_id || ''} className="in"><option value="">None</option>
                  {(ch.customers as GoogleChoice[]).filter(x => x.manager).map(x => <option key={x.id} value={x.id}>{googleLabel(x, ch.customers)}</option>)}</select></label>
              </> : <>
                <label className="field">Google Ads account ids<input name="customer" className="in" defaultValue={chosen(s.customer_ids, s.customer_id).map(googleId).join(', ')} placeholder="123-456-7890, 234-567-8901" /></label>
                <label className="field">Manager account id<input name="login" className="in" defaultValue={s.login_customer_id ? googleId(s.login_customer_id) : ''} placeholder="Optional" /></label>
              </>}
              {(ch.properties || []).length
                ? <label className="field">Analytics property<select name="ga4" defaultValue={s.ga4_property_id || ''} className="in"><option value="">None</option>
                    {ch.properties.map((x: any) => <option key={x.id} value={x.id}>{x.name} · {x.id}</option>)}</select></label>
                : <label className="field">Analytics property id<input name="ga4" className="in" defaultValue={s.ga4_property_id || ''} placeholder="Optional" /></label>}
              {s.note && <span className="sm err">Google could not list the accounts: {String(s.note).slice(0, 140)}</span>}
            </Locked>
          )}

          <div className="integr-act">
            {!ready ? <span className="sm">Add {APP_KEYS[p.id].filter(k => !process.env[k]).join(', ')} in Vercel to switch this on.</span>
              : p.id === 'shopify'
                ? <form action="/api/connect/shopify" method="get" className="inline"><input name="shop" className="in" required defaultValue={s.shop || process.env.SHOPIFY_STORE_DOMAIN || ''} placeholder="store.myshopify.com" aria-label="Shopify store" />
                    <Submit small pending="Opening Shopify…">{c ? 'Reconnect' : 'Connect'}</Submit></form>
                : <GoLink href={`/api/connect/${p.id}`} going={`Opening ${p.name}…`}>{c ? 'Reconnect' : `Connect ${p.name}`}</GoLink>}
            {c && <form action={disconnect}><input type="hidden" name="platform" value={p.id} /><Submit ghost small pending="Disconnecting…">Disconnect</Submit></form>}
          </div>
        </li>
      );
    })}</ul>
  );
}

/** Tick boxes for the accounts to sync, each with its id so accounts sharing a name can be told apart. */
function AccountChecks({ label, name, options, picked }: { label: string; name: string; options: { id: string; label: string }[]; picked: string[] }) {
  const on = new Set(picked.map(id => metaId(id).replace(/-/g, '')));
  return (
    <fieldset className="field integr-checks"><legend>{label}</legend>
      {options.length ? options.map(o => (
        <label key={o.id} className="check"><input type="checkbox" name={name} value={o.id} defaultChecked={on.has(metaId(o.id))} /><span>{o.label}</span></label>
      )) : <span className="sm">No accounts were found for this sign-in.</span>}
    </fieldset>
  );
}
