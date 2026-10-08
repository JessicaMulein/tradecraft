"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acknowledgeBuildScripts = acknowledgeBuildScripts;
const fs_1 = require("fs");
const path_1 = require("path");
const yaml_1 = require("yaml");
const semver_1 = require("semver");
const package_manager_1 = require("./package-manager");
const fileutils_1 = require("./fileutils");
const json_1 = require("./json");
const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml';
/**
 * Records build-script decisions for dependencies that are about to be
 * installed, in whatever form the given package manager understands.
 *
 * Only pnpm needs this today: pnpm 11+ refuses to install a dependency whose
 * build scripts are neither allowed nor denied, so the generator or command
 * that introduces such a dependency records the decision up front. Other
 * package managers run build scripts unconditionally, so this is a no-op for
 * them.
 */
function acknowledgeBuildScripts(treeOrRoot, packageManager, entries) {
    if (packageManager !== 'pnpm') {
        return;
    }
    acknowledgePnpmBuildScripts(treeOrRoot, entries);
}
/**
 * Records `allowBuilds` decisions in pnpm-workspace.yaml, creating the file
 * when missing (mirroring `pnpm approve-builds` in single-package repos).
 *
 * Comment-preserving. Existing entries are never overwritten, so user
 * decisions always win. No-op for pnpm < 11, which warns instead of erroring
 * and does not read `allowBuilds`.
 */
function acknowledgePnpmBuildScripts(treeOrRoot, entries) {
    const host = createHost(treeOrRoot);
    const pnpmVersion = getPnpmVersion(host);
    if (!pnpmVersion || !(0, semver_1.gte)(pnpmVersion, '11.0.0')) {
        return;
    }
    const parsed = (0, yaml_1.parseDocument)(host.exists(PNPM_WORKSPACE_FILE) ? host.read(PNPM_WORKSPACE_FILE) : '');
    // A file that doesn't parse cleanly or whose root isn't a mapping is
    // malformed for pnpm; leave it alone rather than crashing or replacing the
    // user's content. pnpm's own error on the file is the actionable signal.
    // Empty and comment-only files have no contents at all; setIn creates the
    // mapping for them while keeping whatever comments they carry.
    if (parsed.errors.length > 0 ||
        (parsed.contents != null && !(parsed.contents instanceof yaml_1.YAMLMap))) {
        return;
    }
    let changed = false;
    for (const [pkg, allowed] of Object.entries(entries)) {
        // Only a real boolean is a user decision. pnpm's non-strict installs stub
        // undecided packages with a placeholder string ("set this to true or
        // false"), which would fail the next strict install if left in place.
        if (typeof parsed.getIn(['allowBuilds', pkg]) !== 'boolean') {
            parsed.setIn(['allowBuilds', pkg], allowed);
            changed = true;
        }
    }
    if (changed) {
        host.write(PNPM_WORKSPACE_FILE, parsed.toString());
    }
}
function createHost(treeOrRoot) {
    if (typeof treeOrRoot === 'string') {
        return {
            root: treeOrRoot,
            exists: (p) => (0, fs_1.existsSync)((0, path_1.join)(treeOrRoot, p)),
            read: (p) => (0, fs_1.readFileSync)((0, path_1.join)(treeOrRoot, p), 'utf-8'),
            write: (p, c) => (0, fs_1.writeFileSync)((0, path_1.join)(treeOrRoot, p), c),
            readJson: (p) => (0, fileutils_1.readJsonFile)((0, path_1.join)(treeOrRoot, p)),
        };
    }
    return {
        root: treeOrRoot.root,
        exists: (p) => treeOrRoot.exists(p),
        read: (p) => treeOrRoot.read(p, 'utf-8'),
        write: (p, c) => treeOrRoot.write(p, c),
        readJson: (p) => (0, json_1.parseJson)(treeOrRoot.read(p, 'utf-8')),
    };
}
function getPnpmVersion(host) {
    // The host's packageManager field wins: during workspace creation the
    // in-flight package.json only exists in the tree, not on disk.
    if (host.exists('package.json')) {
        const { packageManager } = host.readJson('package.json');
        const version = (0, package_manager_1.parseVersionFromPackageManagerField)('pnpm', typeof packageManager === 'string' ? packageManager : undefined);
        if (version) {
            return version;
        }
    }
    try {
        return (0, package_manager_1.getPackageManagerVersion)('pnpm', host.root);
    }
    catch {
        // The version cannot be probed (e.g. pnpm is not on PATH). Leave the
        // workspace file untouched; pnpm's own install error remains actionable.
        return null;
    }
}
