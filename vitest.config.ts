import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['@cachet/source'],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/rp/server/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    testTimeout: 15000,
  },
});
