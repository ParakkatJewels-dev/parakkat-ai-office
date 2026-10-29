// Business rules shared by the server handlers and focused, provider-free tests.
export const boundedText = (value, limit = 6000) => typeof value === 'string' ? Array.from(value.trim()).slice(0, limit).join('') : '';
export const finiteNumber = value => value == null || value === '' || !['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) ? null : Number(value);
const addDays = (day, count) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 864e5).toISOString().slice(0, 10);
export function closedWindows(now = new Date()) {
  const utcToday = now.toISOString().slice(0, 10);
  const istToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const window = (today, days) => ({ from: addDays(today, -days), to: addDays(today, -1), days });
  return { observedAt: now.toISOString(), shopify: window(utcToday, 1), shopifyWeek: window(utcToday, 7), odoo: window(istToday, 1), odooMonth: window(istToday, 30), ads: window(utcToday, 7) };
}

/** A cursor proves committed days; a row's absence by itself never proves a zero. */
export function odooWindowComplete(state, window) {
  if (!state || typeof state.oldest !== 'string' || typeof state.newest !== 'string' || state.oldest > window.from || state.newest < window.to) return false;
  return !(Array.isArray(state.pending) && state.pending.some(day => day && day.from <= window.to && day.to > window.from));
}

export function missingDays(rows, window) {
  const found = new Set((rows || []).map(row => Array.isArray(row) ? row[0] : row.day));
  const missing = [];
  for (let day = window.from; day <= window.to; day = addDays(day, 1)) if (!found.has(day)) missing.push(day);
  return missing;
}

export function dataQualityFindings({ connections = [], cursors = [], products = [], folders = [], libraryCounts = {}, now = Date.now(), productsComplete = false, foldersComplete = false, expectedProviders = ['shopify', 'odoo', 'meta', 'google_ads'] } = {}) {
  const findings = [];
  const add = (code, severity, detail) => findings.push({ code, severity, detail });
  for (const provider of expectedProviders) {
    const c = connections.find(row => row.provider === provider);
    if (!c) add(`connection:${provider}`, 'unknown', `${provider}: no connection record; availability is unknown.`);
    else if (c.status !== 'connected') add(`connection:${provider}`, 'blocked', `${provider}: recorded connection status is ${boundedText(c.status, 40) || 'unknown'}.`);
    else if (!c.last_synced_at || !Number.isFinite(Date.parse(c.last_synced_at))) add(`freshness:${provider}`, 'unknown', `${provider}: connected, but no successful sync timestamp is recorded.`);
    else if (now - Date.parse(c.last_synced_at) > 8 * 36e5) add(`freshness:${provider}`, 'warning', `${provider}: last recorded successful sync is older than eight hours.`);
  }
  const cursor = name => cursors.find(row => row.name === name)?.state;
  const sales = cursor('odoo_sales');
  if (!sales?.oldest || !sales?.newest) add('odoo:coverage', 'unknown', 'Odoo sales date coverage has not been established. Missing sales rows do not prove zero demand.');
  else {
    if (sales.needs_continuation || sales.pending?.length) add('odoo:backfill', 'warning', `Odoo history is still being backfilled; ${sales.pending?.length || 0} recorded day(s) are pending. Saved coverage starts ${sales.oldest}.`);
    if (sales.coverage && /unavailable|only/i.test(sales.coverage)) add('odoo:models', 'warning', `Odoo coverage: ${boundedText(sales.coverage, 180)}.`);
  }
  if (cursor('shopify_products')?.after) add('shopify:catalogue', 'warning', 'Shopify product discovery has a saved continuation cursor; the current catalogue is incomplete.');
  const library = cursor('design_library');
  if (library?.studyBlock) add('library:block', 'blocked', 'Design study is blocked. Check the Design Studio library status and resume it after fixing the provider or instruction issue.');
  const unfinished = folders.filter(row => row.page_token || !row.scanned_at).length;
  const failed = folders.filter(row => !!row.error).length;
  if (unfinished) add('library:discovery', 'warning', `${unfinished} inspected folder(s) have unfinished discovery${foldersComplete ? '' : '; the folder sample is not exhaustive'}.`);
  if (failed) add('library:folder_errors', 'warning', `${failed} inspected folder(s) have a recorded read error.`);
  if (finiteNumber(libraryCounts.new) > 0) add('library:study_queue', 'warning', `${libraryCounts.new} discovered design(s) are waiting to be studied.`);
  if (finiteNumber(libraryCounts.failed) > 0) add('library:study_failed', 'warning', `${libraryCounts.failed} design(s) have a recorded study failure.`);
  const missingSkus = products.filter(row => !Array.isArray(row.skus) || !row.skus.length).length;
  const unmatched = products.filter(row => row.skus?.length && row.odoo_stock == null).length;
  if (missingSkus) add('products:skus', 'warning', `${missingSkus} of ${products.length} inspected products have no SKU to match to Odoo${productsComplete ? '' : ' (bounded sample)'}.`);
  if (unmatched) add('products:stock_match', 'warning', `${unmatched} of ${products.length} inspected products have no matched Odoo stock; availability is unknown, not zero.`);
  if (!products.length) add('products:empty', 'unknown', 'No product rows were returned. This does not establish that the catalogue or stock is empty.');
  return findings;
}

/** Inventory suggestions are arithmetic over a complete, explicitly mapped source window. */
export function inventoryPlan({ sales = [], stock = [], rules = {}, window, salesComplete = false, stockComplete = false, stockFresh = false } = {}) {
  const configured = Array.isArray(rules.locations) ? rules.locations.filter(r => r && boundedText(r.branch, 200) && boundedText(r.warehouse, 200)) : [];
  // Many-to-one mappings require a different allocation model; never double-count one warehouse.
  const ambiguous = configured.some(row => configured.filter(other => other.branch === row.branch || other.warehouse === row.warehouse).length > 1);
  const locations = ambiguous ? [] : configured;
  const reviewDays = finiteNumber(rules.reviewDays) ?? 7;
  const warnings = [];
  if (ambiguous) warnings.push('Branch/warehouse mappings are ambiguous; each mapped branch and warehouse must appear only once before quantities can be calculated.');
  if (!locations.length) warnings.push('Branch-to-warehouse mapping and lead-time/minimum-stock rules are not configured.');
  if (!salesComplete) warnings.push('The sales window is incomplete or its completeness cannot be verified; quantity recommendations are withheld.');
  if (!stockComplete) warnings.push('The selected stock rows are incomplete; quantity recommendations are withheld.');
  if (!stockFresh) warnings.push('A recent successful Odoo stock sync is not established; quantity recommendations are withheld.');
  const demand = new Map(), holdings = new Map();
  for (const row of sales) {
    const units = finiteNumber(row.units);
    if (!row.sku || !row.branch || units == null || row.day < window.from || row.day > window.to) continue;
    const key = JSON.stringify([row.sku, row.branch]);
    const previous = demand.get(key) || { sku: row.sku, branch: row.branch, product: boundedText(row.product, 200) || row.sku, units: 0 };
    previous.units += units; demand.set(key, previous);
  }
  for (const row of stock) {
    const qty = finiteNumber(row.qty), reserved = finiteNumber(row.reserved);
    if (!row.sku || !row.warehouse || qty == null || reserved == null) continue;
    const key = JSON.stringify([row.sku, row.warehouse]);
    holdings.set(key, (holdings.get(key) || 0) + Math.max(0, qty - reserved));
  }
  const risks = [], proposals = [];
  for (const entry of [...demand.values()].filter(row => row.units > 0).sort((a, b) => b.units - a.units)) {
    const location = locations.find(row => row.branch === entry.branch);
    const available = location ? holdings.get(JSON.stringify([entry.sku, location.warehouse])) ?? null : null;
    // A missing warehouse/SKU row is unknown, even after a successful query.
    const daysCover = available == null || !salesComplete || !stockComplete || !stockFresh ? null : available / (entry.units / window.days);
    const allRecordedStock = stock.filter(row => row.sku === entry.sku && finiteNumber(row.qty) != null && finiteNumber(row.reserved) != null);
    const allWarehouseFree = allRecordedStock.length && stockComplete ? allRecordedStock.reduce((total, row) => total + Math.max(0, Number(row.qty) - Number(row.reserved)), 0) : null;
    const item = { ...entry, warehouse: location?.warehouse || null, available, allWarehouseFree, daysCover };
    if (available == null || daysCover == null || daysCover < 14) risks.push(item);
    const lead = finiteNumber(location?.leadDays), minimum = finiteNumber(location?.minStock);
    if (!location || lead == null || lead < 0 || lead > 180 || minimum == null || minimum < 0 || reviewDays < 1 || reviewDays > 90 || available == null || !salesComplete || !stockComplete || !stockFresh) continue;
    const target = Math.max(Math.ceil(minimum), Math.ceil(entry.units / window.days * (lead + reviewDays)));
    const need = Math.max(0, target - Math.floor(available));
    if (!need) continue;
    const donors = [];
    for (const source of locations.filter(row => row.warehouse !== location.warehouse)) {
      const free = holdings.get(JSON.stringify([entry.sku, source.warehouse]));
      const sourceDemand = demand.get(JSON.stringify([entry.sku, source.branch]));
      const sourceMinimum = finiteNumber(source.minStock), sourceLead = finiteNumber(source.leadDays);
      // We cannot infer that a donor with no sales row has zero demand.
      if (free == null || !sourceDemand || sourceMinimum == null || sourceMinimum < 0 || sourceLead == null || sourceLead < 0 || sourceLead > 180) continue;
      const protectedQty = Math.max(Math.ceil(sourceMinimum), Math.ceil(Math.max(0, sourceDemand.units) / window.days * (sourceLead + reviewDays)));
      const surplus = Math.max(0, Math.floor(free) - protectedQty);
      if (surplus) donors.push({ branch: source.branch, warehouse: source.warehouse, surplus });
    }
    donors.sort((a, b) => b.surplus - a.surplus);
    let remaining = need;
    const transfers = [];
    for (const donor of donors) {
      const quantity = Math.min(remaining, donor.surplus);
      if (quantity > 0) { transfers.push({ ...donor, quantity }); remaining -= quantity; holdings.set(JSON.stringify([entry.sku, donor.warehouse]), holdings.get(JSON.stringify([entry.sku, donor.warehouse])) - quantity); }
      if (!remaining) break;
    }
    proposals.push({ ...item, target, needed: need, transfers, reorder: remaining, leadDays: lead, reviewDays });
  }
  if (locations.some(row => finiteNumber(row.leadDays) == null || finiteNumber(row.minStock) == null)) warnings.push('Some mapped locations are missing valid lead-time or minimum-stock rules.');
  return { risks: risks.slice(0, 30), proposals: proposals.slice(0, 20), warnings };
}

export function catalogueIssues(products) {
  return products.map(product => ({ productId: String(product.id), title: boundedText(product.title, 200), issues: [
    !boundedText(product.title) && 'Missing title', !product.image_url && 'Missing product image',
    (finiteNumber(product.price) == null || finiteNumber(product.price) <= 0) && 'Price needs verification',
    !boundedText(product.product_type) && 'Missing product category',
    (!Array.isArray(product.skus) || !product.skus.length) && 'Missing SKU mapping',
    product.odoo_stock == null && 'No matched Odoo stock',
  ].filter(Boolean) })).filter(row => row.issues.length);
}

/** Model suggestions never choose IDs, destinations, or executable tool names. */
export function validatedCatalogueDrafts(value, products) {
  const allowed = new Map(products.map(product => [String(product.id), product]));
  const seen = new Set(), drafts = [];
  for (const item of Array.isArray(value?.drafts) ? value.drafts : []) {
    const id = String(item?.productId ?? '');
    const source = allowed.get(id);
    if (!source || seen.has(id)) continue;
    const title = boundedText(item.title, 180), description = boundedText(item.description, 4000), seoTitle = boundedText(item.seoTitle, 70), seoDescription = boundedText(item.seoDescription, 160);
    if (!title || !description || !seoTitle || !seoDescription) continue;
    seen.add(id);
    drafts.push({ productId: id, title, description, seoTitle, seoDescription, malayalam: boundedText(item.malayalam, 2000), originalTitle: boundedText(source.title, 250), sourceUpdatedAt: source.updated_at || null });
    if (drafts.length === 3) break;
  }
  return drafts;
}

export function validatedReply(value, channel = 'manual') {
  const reply = boundedText(value?.reply, 4000);
  if (!reply) throw new Error('The customer draft did not contain a reply.');
  if (channel === 'instagram' && new TextEncoder().encode(reply).byteLength > 1000) throw Object.assign(new Error('The Instagram reply exceeds the 1,000-byte limit. Request a shorter reply.'), { code: 'reply_too_long' });
  const category = ['product', 'availability', 'order', 'appointment', 'complaint', 'other'].includes(value.category) ? value.category : 'other';
  return { reply, category, needsHuman: ['availability', 'order', 'appointment', 'complaint'].includes(category) || value.needsHuman !== false, questions: (Array.isArray(value.questions) ? value.questions : []).map(q => boundedText(q, 250)).filter(Boolean).slice(0, 4) };
}

export function validatedFollowUp(value) {
  const summary = boundedText(value?.summary, 800), markdown = boundedText(value?.markdown, 16000);
  if (!summary || !markdown || typeof value?.blocked !== 'boolean') throw new Error('The assigned agent did not return a complete deliverable.');
  const missing = (Array.isArray(value.missing) ? value.missing : []).map(item => boundedText(item, 350)).filter(Boolean).slice(0, 8);
  if (value.blocked && !missing.length) missing.push('The assigned agent needs additional information or an execution tool before this task can be completed.');
  return { summary, markdown, blocked: value.blocked, missing };
}

export function aggregateAds(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.platform, row.account_id || '', row.campaign_id||'', row.ad_id,row.currency||'']);
    const value = groups.get(key) || { platform: boundedText(row.platform, 40), accountId: boundedText(row.account_id, 100), adId: String(row.ad_id), campaignId: boundedText(row.campaign_id, 120), campaign: boundedText(row.campaign_name, 180), ad: boundedText(row.ad_name, 180),currency:boundedText(row.currency,10), spend: 0, revenue: 0, clicks: 0, purchases: 0 };
    value.spend += finiteNumber(row.spend) || 0;
    value.revenue = value.revenue===null||row.conversion_definition!=='purchase'||finiteNumber(row.revenue)===null?null:value.revenue+finiteNumber(row.revenue);
    value.clicks += finiteNumber(row.clicks) || 0;
    value.purchases=value.purchases===null||row.conversion_definition!=='purchase'||finiteNumber(row.purchases)===null?null:value.purchases+finiteNumber(row.purchases);
    groups.set(key, value);
  }
  return [...groups.values()].sort((a, b) => b.spend - a.spend).map(row => ({ ...row, roas: row.spend > 0 && row.revenue!==null ? row.revenue / row.spend : null }));
}
