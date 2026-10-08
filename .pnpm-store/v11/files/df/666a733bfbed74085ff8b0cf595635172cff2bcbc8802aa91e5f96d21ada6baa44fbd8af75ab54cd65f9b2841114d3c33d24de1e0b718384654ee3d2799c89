"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLatestNxTmpPath = getLatestNxTmpPath;
exports.cleanupLatestNx = cleanupLatestNx;
// Import from the defining module, not the devkit-internals barrel: the barrel
// eagerly pulls in the task-execution subsystem and instantiates a daemon
// client, all of which would stay resident for the daemon server's lifetime.
const package_json_1 = require("../../utils/package-json");
const package_manager_1 = require("../../utils/package-manager");
const provenance_1 = require("../../utils/provenance");
const workspace_root_1 = require("../../utils/workspace-root");
const logger_1 = require("../logger");
// Module-level state - persists across invocations within daemon lifecycle
let latestNxTmpPath = null;
let cleanupFn = null;
let installPromise = null;
/**
 * Returns the path to a temp directory containing `nx@latest`.
 * The installation is cached for the lifetime of the daemon process.
 * Guards against concurrent callers by reusing the in-flight promise.
 */
async function getLatestNxTmpPath() {
    if (latestNxTmpPath !== null) {
        logger_1.serverLogger.log('[LATEST-NX]: Reusing cached Nx installation from', latestNxTmpPath);
        return latestNxTmpPath;
    }
    if (installPromise) {
        return installPromise;
    }
    installPromise = (async () => {
        try {
            logger_1.serverLogger.log('[LATEST-NX]: Pulling latest Nx...');
            await (0, provenance_1.ensurePackageHasProvenance)('nx', 'latest');
            const result = await (0, package_json_1.installPackageToTmpAsync)('nx', 'latest', (0, package_manager_1.detectPackageManager)(workspace_root_1.workspaceRoot));
            latestNxTmpPath = result.tempDir;
            cleanupFn = result.cleanup;
            logger_1.serverLogger.log('[LATEST-NX]: Successfully pulled latest Nx to', latestNxTmpPath);
            return latestNxTmpPath;
        }
        finally {
            installPromise = null;
        }
    })();
    return installPromise;
}
/**
 * Clean up the latest Nx installation on daemon shutdown.
 */
function cleanupLatestNx() {
    if (cleanupFn) {
        logger_1.serverLogger.log('[LATEST-NX]: Cleaning up latest Nx installation from', latestNxTmpPath);
        cleanupFn();
    }
    latestNxTmpPath = null;
    cleanupFn = null;
}
