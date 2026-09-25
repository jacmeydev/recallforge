/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Native modules stay outside the bundle.
  serverExternalPackages: ['better-sqlite3', '@open-spaced-repetition/binding', 'yauzl'],
  experimental: {
    // Document uploads (PDF, slides…) go through the proxy; allow up to the 30 MB file limit.
    proxyClientMaxBodySize: '32mb',
  },
};

export default nextConfig;
