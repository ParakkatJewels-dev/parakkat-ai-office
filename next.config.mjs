/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Keep production builds predictable when sharing a VPS with other applications.
  experimental: { cpus: 1, serverActions: { bodySizeLimit: '6mb' } },
  images: { remotePatterns: [{ protocol: 'https', hostname: 'cdn.shopify.com' }, { protocol: 'https', hostname: '*.supabase.co' }] },
};
