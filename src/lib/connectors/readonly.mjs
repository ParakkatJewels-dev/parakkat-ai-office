// Odoo and Shopify are read only for this app: nothing it runs may create, change or delete anything in either.
// Every call to them passes through these checks, so a write cannot slip in by mistake, whatever the code around it does.

/** The only Odoo methods the app may call. Everything else (create, write, unlink, action_*, button_*...) is refused. */
export const ODOO_READ = new Set(['search_read', 'read', 'search', 'search_count', 'fields_get', 'name_search']);
export function assertOdooRead(model, method) {
  if (!ODOO_READ.has(method)) throw new Error(`Refused: ${model}.${method} is not a read. The app only reads from Odoo.`);
}

/** Shopify's Admin API is GraphQL; only queries are let through, never a mutation (or a subscription). */
export function assertShopifyQuery(query) {
  // drop comments and strings first, so neither can hide or fake the operation type
  const code = String(query).replace(/"""[\s\S]*?"""/g, '""').replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/#[^\n]*/g, '');
  if (/\b(mutation|subscription)\b/i.test(code)) throw new Error('Refused: Shopify mutations are not allowed. The app only reads from Shopify.');
  if (!/^\s*(query\b|\{)/.test(code)) throw new Error('Refused: only Shopify queries are allowed.');
}
