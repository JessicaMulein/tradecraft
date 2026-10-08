"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInstalledVersion = getInstalledVersion;
exports.getInstalledNxVersion = getInstalledNxVersion;
exports.getInstalledLegacyNrwlWorkspaceVersion = getInstalledLegacyNrwlWorkspaceVersion;
exports.getInstalledPackageGroup = getInstalledPackageGroup;
const tslib_1 = require("tslib");
const node_module_1 = tslib_1.__importStar(require("node:module"));
const fileutils_1 = require("./fileutils");
const package_json_1 = require("./package-json");
const workspace_root_1 = require("./workspace-root");
const installation_directory_1 = require("./installation-directory");
/**
 * Read the installed `packageName` package.json via the cache-shielded
 * resolver. The resolver always reflects the workspace's `node_modules`/PnP
 * store rather than whichever copy happens to be loaded in the current process
 * (e.g. the temp `nx@latest` install used by the migrate bootstrap). See
 * nrwl/nx#35444 and `resolvePackageJsonWithoutCachePollution` below.
 */
function readInstalledPackageJson(packageName) {
    const path = resolvePackageJsonWithoutCachePollution(packageName, (0, installation_directory_1.getNxRequirePaths)(workspace_root_1.workspaceRoot));
    if (!path) {
        return null;
    }
    try {
        return (0, fileutils_1.readJsonFile)(path);
    }
    catch {
        return null;
    }
}
/**
 * Resolve the workspace's installed version of `packageName`, or `null` if it
 * cannot be located.
 */
function getInstalledVersion(packageName) {
    return readInstalledPackageJson(packageName)?.version ?? null;
}
/**
 * Resolve the workspace's installed `nx` version, or `null` if no installed
 * `nx` can be located.
 */
function getInstalledNxVersion() {
    return getInstalledVersion('nx');
}
/**
 * Resolve the workspace's installed `@nrwl/workspace` version (legacy-era
 * fallback for `nx migrate --include=optional` targeting `< 14.0.0-beta.0`),
 * or `null` if it cannot be resolved from the workspace require paths.
 */
function getInstalledLegacyNrwlWorkspaceVersion() {
    return getInstalledVersion('@nrwl/workspace');
}
/**
 * Return the package names declared in the installed `packageName` package's
 * `ng-update.packageGroup` (or `nx-migrations.packageGroup`), plus
 * `packageName` itself. Returns a set containing only `packageName` when the
 * package isn't installed or the metadata is missing.
 */
function getInstalledPackageGroup(packageName) {
    const set = new Set([packageName]);
    const pkg = readInstalledPackageJson(packageName);
    if (!pkg) {
        return set;
    }
    const declared = pkg['ng-update']?.packageGroup ?? pkg['nx-migrations']?.packageGroup;
    if (declared) {
        for (const entry of (0, package_json_1.normalizePackageGroup)(declared)) {
            set.add(entry.package);
        }
    }
    return set;
}
/**
 * Resolve `<packageName>/package.json` via Node's CJS resolver while
 * neutralising both ways `require.resolve(req, { paths })` can lie about
 * the `paths` argument:
 *
 *   1. Process-wide `Module._pathCache` — swapped out for the duration of
 *      the call, so any cache entries written are discarded and any
 *      previously-poisoned entries are not read. Without this, an
 *      in-process load of a second `nx` package (e.g. the temp `nx@latest`
 *      install used by the daemon's AI-agents and console-status checks)
 *      can poison the cache key this call uses and make us read the temp
 *      path instead of the workspace path.
 *
 *   2. Package self-reference — when a file inside package `nx` calls
 *      `require.resolve('nx/...')`, Node returns that calling package's
 *      own file regardless of `paths`. We avoid that by issuing the
 *      resolve from a `createRequire` rooted at a synthetic path that is
 *      outside any package, so the resolver has no "self" to reference
 *      and must honour `paths`.
 *
 * Node's single-threaded synchronous execution means `require.resolve` does
 * not yield, so no other code in the process can observe the swapped cache.
 */
function resolvePackageJsonWithoutCachePollution(packageName, requirePaths) {
    // `_pathCache` is an internal Node API not exposed in @types/node.
    const realCache = node_module_1.default._pathCache;
    node_module_1.default._pathCache = Object.create(null);
    try {
        const detachedRequire = (0, node_module_1.createRequire)('/__nx_detached_resolver__/x.js');
        return detachedRequire.resolve(`${packageName}/package.json`, {
            paths: requirePaths,
        });
    }
    catch {
        return null;
    }
    finally {
        node_module_1.default._pathCache = realCache;
    }
}
