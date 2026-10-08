"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PNPM_INSTALL_SETTINGS_INPUTS = exports.PNPM_MAJOR_RUNTIME_INPUT = void 0;
exports.pnpmInstallSettingsInputsForInferredTarget = pnpmInstallSettingsInputsForInferredTarget;
exports.shouldIncludePnpmMajorRuntimeInput = shouldIncludePnpmMajorRuntimeInput;
const devkit_1 = require("@nx/devkit");
const internal_1 = require("@nx/devkit/internal");
const path_1 = require("path");
/**
 * Task inputs covering the sources of the pnpm install settings a pruned
 * deploy output carries (build-script approvals, `supportedArchitectures`,
 * `patchedDependencies`). Nothing else in a build target's default hash moves
 * when an approval is revoked, so a target that emits the deploy output must
 * hash these or a cached run replays an output that still grants it. The
 * manifest is narrowed to the fields the output is built from so dependency
 * bumps in the root package.json do not invalidate every build.
 *
 * The pnpm major selects which emitted file carries the settings (pnpm 11+
 * reads them from pnpm-workspace.yaml, pnpm <=10 from the emitted
 * package.json). The manifest's `packageManager` field pins it when it
 * parses to a pnpm version; the runtime probe covers the ambient binary that
 * decides it otherwise, printing only the major so pnpm patch and minor
 * releases do not move the hash, and a sentinel when the binary is missing
 * (the hasher records the probe's output without checking its exit status,
 * so a missing binary does not fail the hash). The full set keeps the probe
 * even under a valid pin: the generator and the migrations write inputs
 * once, and the pin can be removed later. Plugins re-infer on every graph
 * build, so they use {@link pnpmInstallSettingsInputsForInferredTarget} to
 * add the probe only while no valid pin exists.
 *
 * The contents of vendored non-workspace local-path dependencies also ship in
 * the deploy output but are not covered: their set is derived from the
 * lockfile at build time, so no static input list stays correct as
 * dependencies change. Covering them needs content hashing at the graph level
 * (the pnpm parser's directory/link external nodes hash only name and path).
 */
exports.PNPM_MAJOR_RUNTIME_INPUT = {
    runtime: `node -e "try{console.log('pnpm major '+require('child_process').execSync('pnpm --version',{stdio:['ignore','pipe','ignore']}).toString().trim().split('.')[0])}catch{console.log('pnpm major unavailable')}"`,
};
const PNPM_INSTALL_SETTINGS_FILE_INPUTS = [
    '{workspaceRoot}/pnpm-workspace.yaml',
    {
        json: '{workspaceRoot}/package.json',
        fields: [
            'packageManager',
            'pnpm.onlyBuiltDependencies',
            'pnpm.neverBuiltDependencies',
            'pnpm.allowBuilds',
            'pnpm.supportedArchitectures',
            'pnpm.patchedDependencies',
        ],
    },
];
exports.PNPM_INSTALL_SETTINGS_INPUTS = [...PNPM_INSTALL_SETTINGS_FILE_INPUTS, exports.PNPM_MAJOR_RUNTIME_INPUT];
function pnpmInstallSettingsInputsForInferredTarget(includePnpmMajorRuntimeInput) {
    return includePnpmMajorRuntimeInput
        ? [...PNPM_INSTALL_SETTINGS_FILE_INPUTS, exports.PNPM_MAJOR_RUNTIME_INPUT]
        : [...PNPM_INSTALL_SETTINGS_FILE_INPUTS];
}
/**
 * Whether an inferred build target needs the runtime probe: the workspace uses
 * pnpm and the root `packageManager` field does not pin a pnpm version. A
 * missing or unreadable root manifest cannot pin one, so it counts as no pin.
 */
function shouldIncludePnpmMajorRuntimeInput(packageManager, workspaceRoot) {
    if (packageManager !== 'pnpm') {
        return false;
    }
    let field;
    try {
        field = (0, devkit_1.readJsonFile)((0, path_1.join)(workspaceRoot, 'package.json'))?.packageManager;
    }
    catch {
        field = undefined;
    }
    return ((0, internal_1.parseVersionFromPackageManagerField)('pnpm', typeof field === 'string' ? field : undefined) === null);
}
