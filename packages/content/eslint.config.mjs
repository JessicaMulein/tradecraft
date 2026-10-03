import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vitest.config.{js,ts,mjs,mts}',
          ],
          // `yaml` is a declared runtime dependency of this package (task 2.1)
          // that the pack loader (task 2.4) will import to read pack files. It
          // is pinned now so the dependency and its allowed import boundary
          // are in place before the loader lands; until then no source file
          // imports it, so the unused-dependency check is told to ignore it
          // rather than drop the pinned entry.
          ignoredDependencies: ['yaml'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
