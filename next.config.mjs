/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: 'https', hostname: 'cdn.shopify.com' }, { protocol: 'https', hostname: '*.supabase.co' }] },
};
