import path from 'node:path';

import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Load the repo-root .env so ONE file configures the whole stack in local
// dev (web BFF + scoring sidecar + docker-compose all read the same vars).
// apps/web/.env is still honored by Next itself; root wins only where the
// app-level file is absent.
loadEnvConfig(path.resolve(process.cwd(), '..', '..'), undefined, { silent: true });

const nextConfig: NextConfig = {
  // Transpile the workspace contracts package so its TS source is compiled
  // by Next directly.
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
