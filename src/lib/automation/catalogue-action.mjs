export function catalogueChange(payload) {
  if(!payload||!Number.isSafeInteger(Number(payload.productId))||Number(payload.productId)<=0)throw new Error('Invalid product.');
  const bounded=(key,max)=>{const value=payload[key];if(typeof value!=='string'||!value.trim()||[...value].length>max)throw new Error('Invalid catalogue copy.');return value.trim();};
  const title=bounded('title',255),description=bounded('description',6000),seoTitle=bounded('seoTitle',70),seoDescription=bounded('seoDescription',320);
  if(typeof payload.sourceUpdatedAt!=='string'||!Number.isFinite(Date.parse(payload.sourceUpdatedAt)))throw new Error('A verified source revision is required.');
  const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  return {id:`gid://shopify/Product/${payload.productId}`,title,descriptionHtml:description.split(/\n\s*\n/).map(p=>`<p>${escape(p).replace(/\n/g,'<br>')}</p>`).join(''),seo:{title:seoTitle,description:seoDescription}};
}
export function assertCatalogueSource(payload,current) {
  if(!current||current.id!==`gid://shopify/Product/${payload.productId}`||current.title!==payload.originalTitle||Date.parse(current.updatedAt)!==Date.parse(payload.sourceUpdatedAt))throw new Error('The product changed after this draft. Run catalogue maintenance again before applying it.');
}
export function matchesCatalogueCopy(current,change) {return !!current&&current.id===change.id&&current.title===change.title&&current.descriptionHtml===change.descriptionHtml&&current.seo?.title===change.seo.title&&current.seo?.description===change.seo.description;}
