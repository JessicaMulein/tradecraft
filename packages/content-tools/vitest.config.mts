import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/content-tools',
  // Resolve workspace packages to their TypeScript source (the `@tradecraft/source`
  // export condition from each package.json), matching tsconfig's
  // `customConditions`, so tests run against current source rather than a stale
  // or in-flight `dist` build.
  resolve: {
    conditions: ['@tradecraft/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@tradecraft/source'],
    },
  },
  test: {
    name: '@tradecraft/content-tools',
    watch: false,
    globals: true,
    environment: 'node',
    // Transform the workspace packages from source rather than loading their
    // (possibly stale or in-flight) `dist` builds through node's resolver.
    server: {
      deps: {
        inline: [/@tradecraft\//],
      },
    },
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
