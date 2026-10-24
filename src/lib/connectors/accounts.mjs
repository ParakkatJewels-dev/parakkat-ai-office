// Which ad accounts a platform syncs, and how each one is shown so two accounts with the same name can be told apart.

/** Google Ads ids as Google shows them: 9319022443 → 931-902-2443. */
export const googleId = id => { const d = String(id || '').replace(/\D/g, ''); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d; };
/** Meta ad account ids without the act_ prefix. */
export const metaId = id => String(id || '').replace(/^act_/, '');

/** The chosen accounts: the list when there is one, else the single id saved before lists existed. Ids may be comma separated. */
export function chosen(list, single) {
  const all = (Array.isArray(list) && list.length ? list : [single]).flatMap(v => String(v ?? '').split(','));
  return [...new Set(all.map(v => v.trim()).filter(Boolean))];
}

/** The Google Ads accounts to sync, each with the manager account to go through: the one it was found under, else the one chosen. */
export function googleTargets(ids, customers = [], login) {
  return ids.map(raw => {
    const id = String(raw).replace(/-/g, ''), c = customers.find(x => x.id === id);
    return { id, login: (c?.via || login || '').replace(/-/g, '') || undefined };
  });
}

/** Labels for the pickers: the name, then the id, then what kind of account it is. */
export function googleLabel(c, customers = []) {
  const via = c.via && customers.find(x => x.id === c.via);
  return [c.name && c.name !== c.id ? c.name : null, googleId(c.id), c.manager ? 'manager' : null, via ? `via ${via.name || googleId(via.id)} (${googleId(via.id)})` : null].filter(Boolean).join(' · ');
}
export const metaAdLabel = a => [a.name && a.name !== a.id ? a.name : null, metaId(a.id)].filter(Boolean).join(' · ');
export const pageLabel = p => [p.name, p.id, p.ig_name ? `@${p.ig_name}` : 'no Instagram linked'].filter(Boolean).join(' · ');
