import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertOdooRead, assertShopifyQuery } from '../src/lib/connectors/readonly.mjs';

test('Odoo calls are limited to reads', () => {
  for (const m of ['search_read', 'read', 'fields_get', 'search_count']) assert.doesNotThrow(() => assertOdooRead('stock.quant', m));
  for (const m of ['create', 'write', 'unlink', 'copy', 'action_confirm', 'button_validate', 'action_apply_inventory', 'message_post', 'toggle_active'])
    assert.throws(() => assertOdooRead('sale.order', m), /not a read/);
});

test('Shopify only gets queries, never mutations', () => {
  assert.doesNotThrow(() => assertShopifyQuery('query($after: String) { products(first: 25, after: $after) { nodes { id } } }'));
  assert.doesNotThrow(() => assertShopifyQuery('{ shop { name } }'));
  assert.doesNotThrow(() => assertShopifyQuery('query { products(query: "title:mutation ring") { nodes { id } } }'));
  for (const q of ['mutation { productUpdate(input: {id: "1"}) { product { id } } }', '  # note\n mutation M { inventorySetQuantities { userErrors { message } } }',
    'query A { shop { name } } mutation B { productDelete(input: {id: "1"}) { deletedProductId } }', 'subscription { x }'])
    assert.throws(() => assertShopifyQuery(q), /Refused/);
});

test('every Odoo and Shopify request in the code goes through the read-only checks', () => {
  const odoo = readFileSync(new URL('../src/lib/connectors/odoo.ts', import.meta.url), 'utf8');
  const shop = readFileSync(new URL('../src/lib/connectors/shopify.ts', import.meta.url), 'utf8');
  assert.match(odoo, /async call<[^]*?\{\s*assertOdooRead\(model, method\);/);
  assert.match(shop, /async function gql<T>[^]*?\{\s*assertShopifyQuery\(query\);/);
  // the only Shopify requests are GraphQL reads through gql() and the token endpoints
  const urls = [...shop.matchAll(/fetch\(`([^`]+)`/g)].map(m => m[1]);
  assert.ok(urls.every(u => u.endsWith('/admin/oauth/access_token') || u.endsWith('/graphql.json')), urls.join(', '));
  assert.doesNotMatch(shop, /\bmutation\b/);
  // the Shopify sign-in only asks for read scopes
  const connect = readFileSync(new URL('../src/lib/connectors/connect.ts', import.meta.url), 'utf8');
  const scopes = /SHOPIFY_SCOPES = '([^']+)'/.exec(connect)[1].split(',');
  assert.ok(scopes.every(s => s.startsWith('read_')), scopes.join(','));
});
