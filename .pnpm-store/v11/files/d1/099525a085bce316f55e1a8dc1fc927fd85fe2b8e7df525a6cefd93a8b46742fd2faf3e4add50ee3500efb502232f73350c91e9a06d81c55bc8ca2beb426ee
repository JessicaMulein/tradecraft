/**
 * Resolve the workspace's installed version of `packageName`, or `null` if it
 * cannot be located.
 */
export declare function getInstalledVersion(packageName: string): string | null;
/**
 * Resolve the workspace's installed `nx` version, or `null` if no installed
 * `nx` can be located.
 */
export declare function getInstalledNxVersion(): string | null;
/**
 * Resolve the workspace's installed `@nrwl/workspace` version (legacy-era
 * fallback for `nx migrate --include=optional` targeting `< 14.0.0-beta.0`),
 * or `null` if it cannot be resolved from the workspace require paths.
 */
export declare function getInstalledLegacyNrwlWorkspaceVersion(): string | null;
/**
 * Return the package names declared in the installed `packageName` package's
 * `ng-update.packageGroup` (or `nx-migrations.packageGroup`), plus
 * `packageName` itself. Returns a set containing only `packageName` when the
 * package isn't installed or the metadata is missing.
 */
export declare function getInstalledPackageGroup(packageName: string): Set<string>;
