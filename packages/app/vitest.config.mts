import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/app',
  test: {
    name: '@tradecraft/app',
    watch: false,
    globals: true,
    environment: 'node',
    // The app specs play whole games through the Composition Root (property
    // walks, Scripted Full Games, calibration); one property can take several
    // seconds alone and longer when the workspace runs every suite in parallel,
    // so the 5 s default timed them out under load.
    testTimeout: 60_000,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
