import { CreateDependencies, CreateNodes } from '@nx/devkit';
export interface VitestPluginOptions {
    testTargetName?: string;
    /**
     * Atomizer for vitest
     */
    ciTargetName?: string;
    /**
     * The name that should be used to group atomized tasks on CI
     */
    ciGroupName?: string;
    /**
     * Default mode for running tests.
     * - 'watch': Tests run in watch mode locally, auto-run in CI (default)
     * - 'run': Tests run once and exit
     */
    testMode?: 'watch' | 'run';
    /**
     * How atomized test files (the `ciTargetName` targets) are discovered.
     * - 'glob' (default): enumerate specs with a glob that mirrors Vitest's own
     *   resolution instead of booting Vitest per project. Booting Vitest starts a
     *   Vite dev server and runs the config's plugin hooks, so the glob is faster
     *   during graph creation. The glob reads the Nx workspace file index, so
     *   files ignored by `.gitignore`/`.nxignore` are never enumerated even when
     *   Vitest itself would run them.
     * - 'vitest': always enumerate through Vitest.
     *
     * Configs a glob cannot reproduce faithfully still boot Vitest automatically
     * even under 'glob': `test.projects`/`test.workspace` (inline or an
     * auto-loaded `vitest.workspace.*`/`vitest.projects.*` sibling file), plugins
     * with a `configureVitest` hook, `test.changed`/`test.related`, enabled
     * browser `instances` that set their own include/exclude/includeSource/dir,
     * and `include`, `exclude`, `includeSource`, or `typecheck` include/exclude
     * patterns the workspace glob reads differently (absolute paths, a trailing
     * `/`, or an `!(...)` extglob, each optionally negated).
     * @default 'glob'
     */
    discoverTestFiles?: 'glob' | 'vitest';
}
/**
 * @deprecated The 'createDependencies' function is now a no-op. This functionality is included in 'createNodesV2'.
 */
export declare const createDependencies: CreateDependencies;
export declare const createNodes: CreateNodes<VitestPluginOptions>;
export declare const createNodesV2: CreateNodes<VitestPluginOptions>;
