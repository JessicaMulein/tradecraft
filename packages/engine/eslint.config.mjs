import baseConfig from '../../eslint.config.mjs';

// The clock, Day-Boundary Hooks, Phase Step and the resolvers they drive must
// stay pure: deterministic in their inputs and the PRNG, with no real-world
// time, filesystem, network or environment access (Requirements 5.2, 5.6;
// design "Purity"). This override forbids the non-deterministic surfaces in the
// library sources of those directories. Spec files are excluded: tests
// legitimately read the content pack from disk and build worlds.
const PURE_SIM_DIRS = [
  'src/lib/clock/**/*.ts',
  'src/lib/hostile/**/*.ts',
  'src/lib/action/**/*.ts',
  'src/lib/recruit/**/*.ts',
];

// Node built-ins that reach the filesystem, network, clock, OS, environment or
// a non-deterministic RNG. Pure sim code uses the engine's own PRNG
// (`../prng/prng.js`) instead of `crypto`, so forbidding `crypto` is correct.
const FORBIDDEN_NODE_BUILTINS = [
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'net',
  'node:net',
  'http',
  'node:http',
  'https',
  'node:https',
  'os',
  'node:os',
  'crypto',
  'node:crypto',
  'child_process',
  'node:child_process',
  'dns',
  'node:dns',
];

export default [
  ...baseConfig,
  {
    files: PURE_SIM_DIRS,
    ignores: ['**/*.spec.ts'],
    rules: {
      // Real-world, non-deterministic globals. `no-restricted-globals` reports
      // runtime references to these identifiers (e.g. `new Date()`,
      // `Date.now()`, `process.env`), but not a type-only use of `Date`, which
      // the sim is free to use in annotations.
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'Pure sim code must not read wall-clock time. Use the game clock (GameTime) instead.',
        },
        {
          name: 'process',
          message:
            'Pure sim code must not read the environment or process state.',
        },
        {
          name: 'performance',
          message: 'Pure sim code must not read wall-clock time.',
        },
      ],
      // `Math.random` is a method, not a global, so it needs its own rule.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Pure sim code must draw randomness from the engine PRNG, not Math.random.',
        },
      ],
      // Filesystem, network, clock, OS, environment and crypto built-ins.
      'no-restricted-imports': [
        'error',
        {
          paths: FORBIDDEN_NODE_BUILTINS.map((name) => ({
            name,
            message:
              'Pure sim code must not touch the filesystem, network, OS or crypto. Use injected inputs and the engine PRNG.',
          })),
        },
      ],
    },
  },
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
