"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readMinReleaseAgePolicy = readMinReleaseAgePolicy;
const semver_1 = require("semver");
const package_manager_1 = require("../package-manager");
const workspace_root_1 = require("../workspace-root");
const bun_1 = require("./behavior/bun");
const npm_1 = require("./behavior/npm");
const pnpm_1 = require("./behavior/pnpm");
const yarn_1 = require("./behavior/yarn");
// Lowest PM version that ships the cooldown feature; below it the gate is inert.
const INTRODUCED = {
    npm: '11.10.0',
    pnpm: '10.16.0',
    yarn: '4.10.0',
    bun: '1.3.0',
};
/**
 * Reads the package manager, its version, and the relevant cooldown config
 * surfaces once, then dispatches to the per-PM reader. PM versions below the
 * feature's introduction boundary short-circuit to 'inactive' without touching
 * any config surface.
 */
async function readMinReleaseAgePolicy(root = workspace_root_1.workspaceRoot) {
    const packageManager = (0, package_manager_1.detectPackageManager)(root);
    let pmVersion;
    try {
        pmVersion = (0, package_manager_1.getPackageManagerVersion)(packageManager, root);
    }
    catch {
        // Can't determine the version -> can't reason about the gate; let callers
        // fall back to a real PM install which will apply the right behavior.
        return {
            outcome: 'ambiguous',
            reason: `Unable to determine the ${packageManager} version.`,
        };
    }
    if (!(0, semver_1.valid)(pmVersion)) {
        // A non-semver version string can't be reasoned about (gte would throw);
        // defer to a real PM install rather than guess.
        return {
            outcome: 'ambiguous',
            reason: `Unable to parse the ${packageManager} version "${pmVersion}".`,
        };
    }
    if (!(0, semver_1.gte)(pmVersion, INTRODUCED[packageManager])) {
        return { outcome: 'inactive' };
    }
    switch (packageManager) {
        case 'npm':
            return (0, npm_1.readNpmPolicy)(root, pmVersion);
        case 'pnpm':
            return (0, pnpm_1.readPnpmPolicy)(root, pmVersion);
        case 'yarn':
            return (0, yarn_1.readYarnPolicy)(root, pmVersion);
        case 'bun':
            return (0, bun_1.readBunPolicy)(root, pmVersion);
    }
}
