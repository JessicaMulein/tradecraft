import { type Tree } from 'nx/src/devkit-exports';
/**
 * Throws a standardized error when a package is installed at a version below
 * a plugin's supported floor.
 *
 * Use this at every site where a plugin determines the installed version of
 * a supported package is below its declared floor, so the message is
 * consistent across plugins.
 *
 * @param packageName Name of the package (e.g. `@angular/core`).
 * @param installedVersion Version detected in the workspace (e.g. `18.2.0`).
 * @param floor Lowest version the plugin supports (e.g. `19.0.0`).
 */
export declare function throwForUnsupportedVersion(packageName: string, installedVersion: string, floor: string): never;
/**
 * Asserts that a package detected in the workspace is at or above the
 * plugin's supported floor. No-op when the package is not detected
 * (fresh-install path) or when declared as `latest`/`next`.
 *
 * Resolution order:
 * - When the installed version satisfies the declared range, the installed
 *   version decides. This resolves open ranges (e.g. `>=4.8.4 <6.1.0`) to
 *   what is actually installed.
 * - An exact declared version is compared to the floor directly.
 * - A declared range that cannot reach the floor throws as unsupported. A
 *   range that straddles the floor cannot be judged without an installed
 *   version (the lockfile may pin either side), so when none resolves it
 *   throws asking to install dependencies first.
 *
 * Prereleases count as their release version throughout (e.g. `6.0.0-rc.1`
 * as `6.0.0`), for installed versions, exact declared versions, and range
 * endpoints alike.
 *
 * Use from generator entry points to fail fast on unsupported workspaces
 * before writing any incompatible config.
 */
export declare function assertSupportedPackageVersion(tree: Tree, packageName: string, minSupportedVersion: string): void;
/**
 * Asserts that a package installed in the workspace is at or above the
 * plugin's supported floor. No-op when the package is not resolvable from
 * `node_modules` (peer not yet satisfied, fresh-install path). Throws via
 * `throwForUnsupportedVersion` when below floor.
 *
 * Use from executor / runtime / preset / library entry points where
 * node_modules is present and no `Tree` is available. Generator code should
 * use `assertSupportedPackageVersion` instead, which reads the declared
 * range from a tree.
 */
export declare function assertSupportedInstalledPackageVersion(packageName: string, minSupportedVersion: string): void;
