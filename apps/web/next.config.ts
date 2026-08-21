import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Scaffold: no custom config yet. Transpile the workspace contracts package
  // so its TS source is compiled by Next directly.
  transpilePackages: ['@hackguard/contracts'],
  webpack: (config) => {
    // The contracts package is authored as ESM TypeScript with explicit
    // './x.js' import specifiers; teach webpack to resolve them to .ts source.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
