import { type Tree } from '@nx/devkit';
/**
 * Determine whether a project should be treated as ESM for the purpose of
 * emitting `.ts` config and source files (e.g. choosing between
 * `__filename`/`__dirname` and `import.meta.dirname`, or `require()` and
 * `import` for sibling subpath imports).
 *
 * Mirrors Node's package.json `type` resolution: the **closest**
 * package.json with a recognized `type` field wins.
 *
 * Resolution order:
 * 1. The project's package.json `type`, if present and recognized.
 * 2. The workspace-root package.json `type`, if present and recognized.
 * 3. Default: `false` (CJS).
 */
export declare function isEsmProject(tree: Tree, projectRoot: string): boolean;
