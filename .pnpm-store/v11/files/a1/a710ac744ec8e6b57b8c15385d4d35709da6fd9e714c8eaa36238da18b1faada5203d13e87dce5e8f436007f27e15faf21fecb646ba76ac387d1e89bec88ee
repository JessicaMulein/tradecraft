"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ignoresNpmConfigEnv = exports.mergeNpmConfigEnv = exports.getPackageScope = void 0;
exports.getNpmSpawnRegistryEnv = getNpmSpawnRegistryEnv;
const semver_1 = require("semver");
const logger_1 = require("../logger");
const bun_1 = require("./bun");
const pnpm_1 = require("./pnpm");
const yarn_berry_1 = require("./yarn-berry");
const yarn_classic_1 = require("./yarn-classic");
const utils_1 = require("./utils");
var utils_2 = require("./utils");
Object.defineProperty(exports, "getPackageScope", { enumerable: true, get: function () { return utils_2.getPackageScope; } });
Object.defineProperty(exports, "mergeNpmConfigEnv", { enumerable: true, get: function () { return utils_2.mergeNpmConfigEnv; } });
Object.defineProperty(exports, "ignoresNpmConfigEnv", { enumerable: true, get: function () { return utils_2.ignoresNpmConfigEnv; } });
/**
 * Computes the npm_config_* environment entries a spawned `npm view`/`npm pack`
 * (or a pre-v11 `pnpm view`, which passes through to npm) needs so its registry,
 * auth and TLS resolution reproduces what the workspace's package manager would
 * do for `packageName`. Returns an empty object when nothing needs bridging (npm
 * workspaces, or config npm already resolves identically on its own) and when
 * resolution fails, which is warned about rather than thrown.
 */
function getNpmSpawnRegistryEnv(packageName, root, packageManager, packageManagerVersion) {
    try {
        const env = resolveSpawnRegistryEnv(packageName, root, packageManager, packageManagerVersion);
        reconcileScopedRegistryKey(env, packageName);
        return env;
    }
    catch (e) {
        // The warning omits the cause because an rc parse error quotes the lines
        // around the fault, which in these files is credential material.
        warnUnresolvedConfig(packageManager);
        logger_1.logger.verbose(`Failed to resolve the ${packageManager} registry configuration; falling back to npm's own resolution.`, e);
        return {};
    }
}
function resolveSpawnRegistryEnv(packageName, root, packageManager, packageManagerVersion) {
    switch (packageManager) {
        case 'npm':
            // npm resolves its own config; the spawned npm IS the package manager.
            return {};
        case 'pnpm':
            if (!packageManagerVersion) {
                // Which surfaces pnpm honors depends on its version.
                warnUnknownVersion('pnpm', 'a registry configured only in pnpm-workspace.yaml');
                return {};
            }
            return (0, pnpm_1.getPnpmSpawnRegistryEnv)(packageName, root, packageManagerVersion);
        case 'yarn':
            if (!packageManagerVersion) {
                // Without the version we cannot tell classic from berry.
                warnUnknownVersion('yarn', 'a registry configured only in .yarnrc.yml');
                return {};
            }
            return (0, semver_1.major)(packageManagerVersion) >= 2
                ? (0, yarn_berry_1.getYarnBerrySpawnRegistryEnv)(packageName, root, packageManagerVersion)
                : (0, yarn_classic_1.getYarnClassicSpawnRegistryEnv)(packageName, root);
        case 'bun':
            return (0, bun_1.getBunSpawnRegistryEnv)(packageName, root, packageManagerVersion);
        default: {
            // getNpmSpawnRegistryEnv catches this and falls open to no bridging.
            const _exhaustive = packageManager;
            throw new Error(`Unhandled package manager: ${_exhaustive}`);
        }
    }
}
// npm's loadEnv lowercases an env key and rewrites its non-leading `_` to `-`,
// but looks @scope:registry up verbatim, so a bridged override for such a scope
// is never found. The command targets this package, so redirect the default.
function reconcileScopedRegistryKey(env, packageName) {
    const scope = (0, utils_1.getPackageScope)(packageName);
    if (!scope) {
        return;
    }
    const scopedRegistry = env[`npm_config_${scope}:registry`];
    if (!scopedRegistry) {
        return;
    }
    const key = `${scope}:registry`;
    if ((0, utils_1.normalizeNpmConfigKey)(key) !== key) {
        (0, utils_1.setRegistry)(env, scopedRegistry);
    }
}
const warnedUnresolvedConfigs = new Set();
// Reached by a failed read and equally by a malformed value the read returned,
// so the wording stays on resolution rather than naming a file.
function warnUnresolvedConfig(packageManager) {
    if (warnedUnresolvedConfigs.has(packageManager)) {
        return;
    }
    warnedUnresolvedConfigs.add(packageManager);
    logger_1.logger.warn(`Could not resolve the ${packageManager} configuration; packages will be fetched using npm's own registry resolution, which may differ from ${packageManager}'s. Run with NX_VERBOSE_LOGGING=true for the cause.`);
}
const warnedUnknownVersions = new Set();
function warnUnknownVersion(packageManager, example) {
    if (warnedUnknownVersions.has(packageManager)) {
        return;
    }
    warnedUnknownVersions.add(packageManager);
    logger_1.logger.warn(`Could not determine the ${packageManager} version; skipping ${packageManager} registry configuration when fetching packages. They will be fetched using npm's own registry resolution, which may differ from ${packageManager}'s (for example, ${example}).`);
}
