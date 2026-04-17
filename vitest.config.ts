import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // Next.js's tsconfig sets jsx: "preserve" for the Next compiler. Vitest
  // runs on its own bundler (rolldown under vitest v4), so we need a real
  // JSX transform. The React plugin handles this regardless of rolldown/esbuild.
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
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
