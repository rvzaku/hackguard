import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    env: {
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_123',
    },
    include: ['test/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      // Decision core only (plan §6: >=80% coverage on the decision core);
      // route handlers and env plumbing are covered via the route tests.
      include: [
        'src/lib/triage/**',
        'src/lib/compliance/**',
        'src/lib/scheduler/**',
        'src/lib/audit/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
