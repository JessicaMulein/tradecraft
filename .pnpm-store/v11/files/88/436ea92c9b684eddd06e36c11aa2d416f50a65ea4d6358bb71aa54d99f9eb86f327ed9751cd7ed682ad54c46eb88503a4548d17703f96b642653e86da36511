"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTouchedProjectsFromLockFile = void 0;
const file_utils_1 = require("../../../../project-graph/file-utils");
const config_1 = require("../../utils/config");
const find_matching_projects_1 = require("../../../../utils/find-matching-projects");
const file_hasher_1 = require("../../../../hasher/file-hasher");
const output_1 = require("../../../../utils/output");
const lock_file_1 = require("../../lock-file/lock-file");
const getTouchedProjectsFromLockFile = (fileChanges, projectGraphNodes, nxJson, packageJson, projectGraph) => {
    const { projectsAffectedByDependencyUpdates } = (0, config_1.jsPluginConfig)(nxJson);
    const changedLockFile = fileChanges.find((f) => lock_file_1.AUTO_AFFECTED_LOCK_FILES.includes(f.file));
    if (projectsAffectedByDependencyUpdates === 'auto') {
        return getAutoAffected(changedLockFile, projectGraphNodes, projectGraph, packageJson);
    }
    else if (Array.isArray(projectsAffectedByDependencyUpdates)) {
        return (0, find_matching_projects_1.findMatchingProjects)(projectsAffectedByDependencyUpdates, projectGraphNodes);
    }
    if (changedLockFile) {
        return Object.values(projectGraphNodes).map((p) => p.name);
    }
    return [];
};
exports.getTouchedProjectsFromLockFile = getTouchedProjectsFromLockFile;
/**
 * In auto mode, parse the lock file at the base and head revisions
 * using Nx's existing lock file parsers, then diff the resulting
 * external-node maps to determine which packages actually changed.
 *
 * Returns external node names (e.g. "npm:lodash@4.17.21") so the
 * graph reversal in filterAffected can walk back to workspace projects.
 */
function getAutoAffected(changedLockFile, projectGraphNodes, projectGraph, packageJson) {
    const allProjectNames = Object.values(projectGraphNodes).map((p) => p.name);
    if (!changedLockFile) {
        return [];
    }
    const changes = changedLockFile.getChanges();
    // A WholeFileChange means we were unable to read both revisions of
    // the lock file (e.g. missing base revision, git error). Fall back
    // to marking all projects affected.
    if (!changes.every(file_utils_1.isLockFileChange)) {
        return allProjectNames;
    }
    const changedPackageNames = getChangedPackageNames(changedLockFile.file, changes, packageJson);
    if (changedPackageNames === null) {
        return allProjectNames;
    }
    if (changedPackageNames.size === 0) {
        return [];
    }
    // Look up the changed packages in the project graph's external nodes
    // and return the external node names. The graph reversal in
    // filterAffected walks from these nodes to workspace projects.
    const { touchedNodeNames, missingPackageNames } = findExternalNodesByPackageName(changedPackageNames, projectGraph.externalNodes ?? {});
    if (missingPackageNames.size > 0) {
        return allProjectNames;
    }
    return touchedNodeNames;
}
/**
 * Parse the base and head revisions of the lock file with Nx's
 * existing parsers and diff the resulting package -> version maps.
 *
 * Returns the set of changed package names, or null if parsing
 * failed (in which case the caller should fall back to all projects).
 */
function getChangedPackageNames(file, changes, packageJson) {
    try {
        const changed = new Set();
        // calculateFileChanges emits a single LockFileChange per lock file, but
        // the iteration keeps the contract open in case multiple ranges are ever
        // emitted for the same file.
        for (const change of changes) {
            const baseFingerprints = collectPackageFingerprints((0, lock_file_1.getLockFileNodesForName)(file, change.baseContent, (0, file_hasher_1.hashArray)([change.baseContent]), packageJson).nodes);
            const headFingerprints = collectPackageFingerprints((0, lock_file_1.getLockFileNodesForName)(file, change.headContent, (0, file_hasher_1.hashArray)([change.headContent]), packageJson).nodes);
            for (const [name, fingerprints] of headFingerprints) {
                const baseSet = baseFingerprints.get(name);
                if (!baseSet || !setsEqual(baseSet, fingerprints)) {
                    changed.add(name);
                }
            }
            for (const name of baseFingerprints.keys()) {
                if (!headFingerprints.has(name)) {
                    changed.add(name);
                }
            }
        }
        return changed;
    }
    catch (e) {
        output_1.output.warn({
            title: `Failed to parse "${file}" for projectsAffectedByDependencyUpdates "auto" mode. All projects will be marked as affected.`,
            bodyLines: [e instanceof Error ? e.message : String(e)],
        });
        return null;
    }
}
/**
 * Build a map of packageName -> set of versions present in the
 * external-node record returned by a lock-file parser. We include both
 * version and hash so patched/tarball/integrity-only changes still
 * count as lockfile changes even when the semver stays the same.
 */
function collectPackageFingerprints(nodes) {
    const fingerprints = new Map();
    for (const node of Object.values(nodes ?? {})) {
        const name = node.data?.packageName;
        if (!name)
            continue;
        const fingerprint = JSON.stringify({
            version: node.data.version ?? '',
            hash: node.data.hash ?? '',
        });
        let set = fingerprints.get(name);
        if (!set) {
            set = new Set();
            fingerprints.set(name, set);
        }
        set.add(fingerprint);
    }
    return fingerprints;
}
function setsEqual(a, b) {
    if (a.size !== b.size)
        return false;
    for (const value of a) {
        if (!b.has(value))
            return false;
    }
    return true;
}
/**
 * Given a set of package names, find all matching external node names
 * in the project graph.
 */
function findExternalNodesByPackageName(packageNames, externalNodes) {
    const touchedNodeNames = [];
    const matchedPackageNames = new Set();
    for (const [name, node] of Object.entries(externalNodes)) {
        if (packageNames.has(node.data.packageName)) {
            touchedNodeNames.push(name);
            matchedPackageNames.add(node.data.packageName);
        }
    }
    return {
        touchedNodeNames,
        missingPackageNames: new Set(Array.from(packageNames).filter((name) => !matchedPackageNames.has(name))),
    };
}
