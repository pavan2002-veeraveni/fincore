/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@fincore/contracts'],
  poweredByHeader: false,
};

export default nextConfig;
