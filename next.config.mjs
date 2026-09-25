/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    // Document uploads (PDF, slides…) go through the proxy; allow up to the 30 MB file limit.
    proxyClientMaxBodySize: '32mb',
  },
};

export default nextConfig;
