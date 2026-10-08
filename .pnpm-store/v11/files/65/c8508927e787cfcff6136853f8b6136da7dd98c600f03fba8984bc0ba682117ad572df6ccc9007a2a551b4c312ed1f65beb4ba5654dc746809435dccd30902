"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.throwForUnsupportedVersion = throwForUnsupportedVersion;
exports.assertSupportedPackageVersion = assertSupportedPackageVersion;
exports.assertSupportedInstalledPackageVersion = assertSupportedInstalledPackageVersion;
const devkit_exports_1 = require("nx/src/devkit-exports");
const semver_1 = require("semver");
const installed_version_1 = require("./installed-version");
const package_json_1 = require("./package-json");
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
function throwForUnsupportedVersion(packageName, installedVersion, floor) {
    throw new Error(`Unsupported version of \`${packageName}\` detected.\n\n` +
        `  Installed: ${installedVersion}\n` +
        `  Supported: >= ${floor}\n\n` +
        `Update \`${packageName}\` to ${floor} or higher.`);
}
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
function assertSupportedPackageVersion(tree, packageName, minSupportedVersion) {
    const declared = (0, package_json_1.getDependencyVersionFromPackageJson)(tree, packageName);
    if (!declared || (0, installed_version_1.isNonSemverDistTag)(declared)) {
        return;
    }
    const installed = (0, installed_version_1.getInstalledPackageVersionFromTree)(tree, packageName) ??
        getInstalledPackageVersionFromProcess(tree, packageName);
    if (installed) {
        // An installed prerelease can match the declared range in either form:
        // raw (a same-tuple prerelease comparator) or as its release version.
        const release = (0, semver_1.coerce)(installed)?.version ?? installed;
        if ((0, semver_1.satisfies)(installed, declared) || (0, semver_1.satisfies)(release, declared)) {
            if ((0, semver_1.lt)(release, minSupportedVersion)) {
                throwForUnsupportedVersion(packageName, installed, minSupportedVersion);
            }
            return;
        }
    }
    const cleaned = (0, semver_1.clean)(declared);
    if (cleaned) {
        // Strip any prerelease so it counts as its release version.
        const release = (0, semver_1.coerce)(cleaned)?.version ?? cleaned;
        if ((0, semver_1.lt)(release, minSupportedVersion)) {
            throwForUnsupportedVersion(packageName, declared, minSupportedVersion);
        }
        return;
    }
    if ((0, semver_1.validRange)(declared)) {
        // The `-0` floor comparator admits prereleases of the floor version, so
        // a range reaching the floor only through its prereleases still counts.
        if (!(0, semver_1.intersects)(declared, `>=${minSupportedVersion}-0`)) {
            throwForUnsupportedVersion(packageName, declared, minSupportedVersion);
        }
        const min = (0, semver_1.minVersion)(declared);
        const rangeMinimum = min ? `${min.major}.${min.minor}.${min.patch}` : null;
        if (rangeMinimum && (0, semver_1.lt)(rangeMinimum, minSupportedVersion)) {
            throw new Error(`Unable to determine the installed version of \`${packageName}\`.\n\n` +
                `  Declared: ${declared}\n` +
                `  Supported: >= ${minSupportedVersion}\n\n` +
                `The declared range allows versions below the supported minimum. ` +
                `Install the workspace dependencies so the installed version can be verified, then try again.`);
        }
        return;
    }
    const coerced = (0, semver_1.coerce)(declared)?.version;
    if (coerced && (0, semver_1.lt)(coerced, minSupportedVersion)) {
        throwForUnsupportedVersion(packageName, declared, minSupportedVersion);
    }
}
/**
 * Module-resolution fallback for installs without a `node_modules` layout
 * (e.g. Yarn PnP). Only valid when the tree is the running process's
 * workspace; unit trees (e.g. rooted at `/virtual`) must not resolve
 * packages from the process environment. Resolves from the workspace root
 * only, so a copy hoisted into `.nx/installation` cannot shadow the
 * workspace's own install.
 */
function getInstalledPackageVersionFromProcess(tree, packageName) {
    if (tree.root !== devkit_exports_1.workspaceRoot) {
        return null;
    }
    return (0, installed_version_1.getInstalledPackageVersion)(packageName, [tree.root]);
}
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
function assertSupportedInstalledPackageVersion(packageName, minSupportedVersion) {
    const installed = (0, installed_version_1.getInstalledPackageVersion)(packageName);
    if (!installed) {
        return;
    }
    // Coerce strips any prerelease tag (e.g. `19.0.0-rc.1` → `19.0.0`) so a
    // prerelease of the supported major isn't wrongly flagged as below floor
    // by semver's spec-mandated `lt(prerelease, release) === true` ordering.
    const normalized = (0, semver_1.coerce)(installed)?.version;
    if (!normalized || !(0, semver_1.lt)(normalized, minSupportedVersion)) {
        return;
    }
    throwForUnsupportedVersion(packageName, installed, minSupportedVersion);
}
