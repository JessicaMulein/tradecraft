import { type Tree } from '@nx/devkit';
/**
 * Checks whether the workspace's `typescript` is at or above the given version.
 *
 * Resolution order:
 * - When `typescript` is declared and the installed version satisfies that
 *   declared range, the installed version decides. This resolves open ranges
 *   (e.g. `>=5.8.0`, `^5 || ^6`) to what is actually installed.
 * - Otherwise the declared range's minimum is used (e.g. `^5.9.2` -> `5.9.2`,
 *   `<6` -> `0.0.0`). This is the fresh-workspace path (nothing installed yet)
 *   and the case where a generator is mid-flight re-pinning `typescript` - the
 *   new range no longer satisfies the still-installed version, so intent wins.
 * - When `typescript` is not declared at all, Nx's default install version is
 *   assumed; a transitively-hoisted install is ignored as it does not reflect
 *   a workspace choice.
 *
 * Dist-tags and unparseable ranges (e.g. `latest`, `next`) have no resolvable
 * floor, so they are treated as meeting any version.
 *
 * Use from generators to emit version-appropriate config when a single value
 * is not valid across the supported TypeScript range.
 */
export declare function isTypescriptVersionAtLeast(tree: Tree, version: string): boolean;
/**
 * The `moduleResolution` to emit in generated tsconfig files, chosen for the
 * workspace's TypeScript version: `bundler` on TS >= 6, `node10` on TS < 6.
 * node-family resolution is a TS5107 deprecation error on TS 6, and `bundler`
 * is invalid in a commonjs setup on TS < 6 (TS5095); `node10` also preserves
 * classic node resolution for pre-TS6 workspaces.
 */
export declare function getTsConfigModuleResolution(tree: Tree): 'bundler' | 'node10';
/**
 * Returns the minimum satisfying version for a semver range, stripping
 * prerelease so `>=6.0.0-beta.1` still counts as 6.0. Falls back to coerce()
 * for dist-tags and garbage inputs that minVersion() cannot parse.
 */
export declare function getRangeMinimum(range: string): string | undefined;
