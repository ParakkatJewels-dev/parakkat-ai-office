import 'server-only';
import { shopifyAutomationAccess } from './shopify';
import { checkPause } from '@/lib/pause';
import { catalogueChange, assertCatalogueSource, matchesCatalogueCopy } from '@/lib/automation/catalogue-action.mjs';

// These operations are validated against 2026-01. Existing sync operations retain their configured version.
export const COPY_READ=`query CatalogueCopy($id: ID!) { product(id: $id) { id title descriptionHtml updatedAt seo { title description } } currentAppInstallation { accessScopes { handle } } }`;
export const COPY_UPDATE=`mutation CatalogueCopyUpdate($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id title descriptionHtml updatedAt seo { title description } } userErrors { field message } } }`;
async function request(query:string,variables:Record<string,unknown>,signal?:AbortSignal) {
  const {domain,token}=await shopifyAutomationAccess();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain))throw new Error('The connected Shopify domain is invalid.');
  const response=await fetch(`https://${domain}/admin/api/2026-01/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables}),signal:signal||AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.errors?.length)throw new Error('Shopify could not complete the catalogue request. Check product-write access.');
  return data.data;
}
export async function prepareCatalogueUpdate(payload:Record<string,any>) {
  await checkPause();
  const change=catalogueChange(payload),data=await request(COPY_READ,{id:change.id});
  if(!data?.currentAppInstallation?.accessScopes?.some((s:{handle:string})=>s.handle==='write_products'))throw new Error('Shopify needs write_products permission before applying catalogue copy. Reconnect the app with that permission.');
  assertCatalogueSource(payload,data.product);
  return {before:data.product,change};
}
export async function applyCatalogueUpdate(payload:Record<string,any>) {
  await checkPause();
  // Re-read immediately before the mutation. Shopify does not provide a compare-and-swap revision
  // for productUpdate, so simultaneous external edits remain a documented provider limitation.
  const prepared=await prepareCatalogueUpdate(payload);
  await checkPause();
  const data=await request(COPY_UPDATE,{product:prepared.change});
  if(data?.productUpdate?.userErrors?.length)throw new Error('Shopify rejected the catalogue update. Review the product and permissions before retrying.');
  if(!matchesCatalogueCopy(data?.productUpdate?.product,prepared.change))throw new Error('Shopify did not confirm the exact catalogue change. Review the product before any retry.');
  return {before:prepared.before,after:data.productUpdate.product};
}
