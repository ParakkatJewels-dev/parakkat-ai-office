export function shopifyPhotoUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && url.hostname === 'cdn.shopify.com' && url.pathname.startsWith('/s/files/') ? url.href : null;
  } catch { return null; }
}
