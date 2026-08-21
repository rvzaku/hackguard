import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Scaffold: no custom config yet. Transpile the workspace contracts package
  // so its TS source is compiled by Next directly.
  transpilePackages: ['@hackguard/contracts'],
};

export default nextConfig;
