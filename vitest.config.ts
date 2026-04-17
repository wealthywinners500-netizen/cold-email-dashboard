import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: [
      'node_modules',
      '.next',
      'src/seed',
      // Pre-existing B15-6 dry-run script — uses custom `assert` helpers,
      // not vitest. Runnable via tsx directly; not in the Phase 1 suite.
      'src/lib/provisioning/__tests__/saga-dry-run.test.ts',
    ],
  },
});
