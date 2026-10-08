"use strict";
/**
 * This is the main API for accessing the lock file functionality.
 * It encapsulates the package manager specific logic and implementation details.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTO_AFFECTED_LOCK_FILES = exports.LOCKFILES = void 0;
exports.getLockFileNodes = getLockFileNodes;
exports.getLockFileNodesForName = getLockFileNodesForName;
exports.getLockFileDependencies = getLockFileDependencies;
exports.lockFileExists = lockFileExists;
exports.getLockFileName = getLockFileName;
exports.getLockFilePath = getLockFilePath;
exports.createLockFile = createLockFile;
exports.generatePrunedDeployOutput = generatePrunedDeployOutput;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const semver_1 = require("semver");
const fileutils_1 = require("../../../utils/fileutils");
const output_1 = require("../../../utils/output");
const pruned_output_1 = require("./pruned-output");
const package_manager_1 = require("../../../utils/package-manager");
const workspace_root_1 = require("../../../utils/workspace-root");
const get_workspace_packages_from_graph_1 = require("../utils/get-workspace-packages-from-graph");
const bun_parser_1 = require("./bun-parser");
const npm_parser_1 = require("./npm-parser");
const pnpm_parser_1 = require("./pnpm-parser");
const project_graph_pruning_1 = require("./project-graph-pruning");
const package_json_1 = require("./utils/package-json");
const yarn_parser_1 = require("./yarn-parser");
const YARN_LOCK_FILE = 'yarn.lock';
const NPM_LOCK_FILE = 'package-lock.json';
const PNPM_LOCK_FILE = 'pnpm-lock.yaml';
const PNPM_LOCK_FILE_LEGACY = 'pnpm-lock.yml';
exports.LOCKFILES = [
    YARN_LOCK_FILE,
    NPM_LOCK_FILE,
    PNPM_LOCK_FILE,
    bun_parser_1.BUN_LOCK_FILE,
    bun_parser_1.BUN_TEXT_LOCK_FILE,
];
exports.AUTO_AFFECTED_LOCK_FILES = [
    YARN_LOCK_FILE,
    NPM_LOCK_FILE,
    PNPM_LOCK_FILE,
    PNPM_LOCK_FILE_LEGACY,
    bun_parser_1.BUN_LOCK_FILE,
    bun_parser_1.BUN_TEXT_LOCK_FILE,
];
const YARN_LOCK_PATH = (0, node_path_1.join)(workspace_root_1.workspaceRoot, YARN_LOCK_FILE);
const NPM_LOCK_PATH = (0, node_path_1.join)(workspace_root_1.workspaceRoot, NPM_LOCK_FILE);
const PNPM_LOCK_PATH = (0, node_path_1.join)(workspace_root_1.workspaceRoot, PNPM_LOCK_FILE);
const BUN_LOCK_PATH = (0, node_path_1.join)(workspace_root_1.workspaceRoot, bun_parser_1.BUN_LOCK_FILE);
const BUN_TEXT_LOCK_PATH = (0, node_path_1.join)(workspace_root_1.workspaceRoot, bun_parser_1.BUN_TEXT_LOCK_FILE);
/**
 * Parses lock file and maps dependencies and metadata to {@link LockFileGraph}
 */
function getLockFileNodes(packageManager, contents, lockFileHash, context) {
    try {
        const packageJson = packageManager === 'yarn' || packageManager === 'bun'
            ? (0, fileutils_1.readJsonFile)((0, node_path_1.join)(context.workspaceRoot, 'package.json'))
            : undefined;
        return getLockFileNodesForName(getLockFileName(packageManager), contents, lockFileHash, packageJson);
    }
    catch (e) {
        if (!isPostInstallProcess()) {
            output_1.output.error({
                title: `Failed to parse ${packageManager} lockfile`,
                bodyLines: errorBodyLines(e),
            });
        }
        throw e;
    }
    throw new Error(`Unknown package manager: ${packageManager}`);
}
function getLockFileNodesForName(lockFile, contents, lockFileHash, packageJson) {
    if (lockFile === YARN_LOCK_FILE || lockFile === bun_parser_1.BUN_LOCK_FILE) {
        // yarn-parser only reads optional fields plus an unused `name` for the
        // synthetic root workspace node, which is identical across base/head and
        // therefore irrelevant for affected diffing.
        return (0, yarn_parser_1.getYarnLockfileNodes)(contents, lockFileHash, packageJson ?? {});
    }
    if (lockFile === PNPM_LOCK_FILE || lockFile === PNPM_LOCK_FILE_LEGACY) {
        return (0, pnpm_parser_1.getPnpmLockfileNodes)(contents, lockFileHash);
    }
    if (lockFile === NPM_LOCK_FILE) {
        return (0, npm_parser_1.getNpmLockfileNodes)(contents, lockFileHash);
    }
    if (lockFile === bun_parser_1.BUN_TEXT_LOCK_FILE) {
        const nodes = (0, bun_parser_1.getBunTextLockfileNodes)(contents, lockFileHash);
        return { nodes, keyMap: new Map() };
    }
    throw new Error(`Unknown lock file: ${lockFile}`);
}
/**
 * Parses lock file and maps dependencies and metadata to {@link LockFileGraph}
 */
function getLockFileDependencies(packageManager, contents, lockFileHash, context, keyMap) {
    try {
        if (packageManager === 'yarn') {
            return (0, yarn_parser_1.getYarnLockfileDependencies)(contents, lockFileHash, context, keyMap);
        }
        if (packageManager === 'pnpm') {
            return (0, pnpm_parser_1.getPnpmLockfileDependencies)(contents, lockFileHash, context, keyMap);
        }
        if (packageManager === 'npm') {
            return (0, npm_parser_1.getNpmLockfileDependencies)(contents, lockFileHash, context, keyMap);
        }
        if (packageManager === 'bun') {
            const lockFilePath = getLockFilePath(packageManager);
            if (lockFilePath.endsWith(bun_parser_1.BUN_TEXT_LOCK_FILE)) {
                // Bun parser doesn't use keyMap
                return (0, bun_parser_1.getBunTextLockfileDependencies)(contents, lockFileHash, context);
            }
            else {
                // Fallback to yarn parser for binary format
                return (0, yarn_parser_1.getYarnLockfileDependencies)(contents, lockFileHash, context, keyMap);
            }
        }
    }
    catch (e) {
        if (!isPostInstallProcess()) {
            output_1.output.error({
                title: `Failed to parse ${packageManager} lockfile`,
                bodyLines: errorBodyLines(e),
            });
        }
        throw e;
    }
    throw new Error(`Unknown package manager: ${packageManager}`);
}
function lockFileExists(packageManager) {
    if (packageManager === 'yarn') {
        return (0, node_fs_1.existsSync)(YARN_LOCK_PATH);
    }
    if (packageManager === 'pnpm') {
        return (0, node_fs_1.existsSync)(PNPM_LOCK_PATH);
    }
    if (packageManager === 'npm') {
        return (0, node_fs_1.existsSync)(NPM_LOCK_PATH);
    }
    if (packageManager === 'bun') {
        return (0, node_fs_1.existsSync)(BUN_LOCK_PATH) || (0, node_fs_1.existsSync)(BUN_TEXT_LOCK_PATH);
    }
    throw new Error(`Unknown package manager ${packageManager} or lock file missing`);
}
/**
 * Returns lock file name based on the detected package manager in the root
 * @param packageManager
 * @returns
 */
function getLockFileName(packageManager) {
    if (packageManager === 'yarn') {
        return YARN_LOCK_FILE;
    }
    if (packageManager === 'pnpm') {
        return PNPM_LOCK_FILE;
    }
    if (packageManager === 'npm') {
        return NPM_LOCK_FILE;
    }
    if (packageManager === 'bun') {
        const lockFilePath = getLockFilePath(packageManager);
        return lockFilePath.endsWith(bun_parser_1.BUN_TEXT_LOCK_FILE)
            ? bun_parser_1.BUN_TEXT_LOCK_FILE
            : bun_parser_1.BUN_LOCK_FILE;
    }
    throw new Error(`Unknown package manager: ${packageManager}`);
}
function getLockFilePath(packageManager) {
    if (packageManager === 'yarn') {
        return YARN_LOCK_PATH;
    }
    if (packageManager === 'pnpm') {
        return PNPM_LOCK_PATH;
    }
    if (packageManager === 'npm') {
        return NPM_LOCK_PATH;
    }
    if (packageManager === 'bun') {
        try {
            // Check if text format exists first (prefer over binary)
            if ((0, node_fs_1.existsSync)(BUN_TEXT_LOCK_PATH)) {
                return BUN_TEXT_LOCK_PATH;
            }
            // Fall back to binary format
            if ((0, node_fs_1.existsSync)(BUN_LOCK_PATH)) {
                return BUN_LOCK_PATH;
            }
            const bunVersion = (0, node_child_process_1.execSync)('bun --version', { windowsHide: true })
                .toString()
                .trim();
            // Version-based fallback
            if ((0, semver_1.gte)(bunVersion, '1.2.0')) {
                return BUN_TEXT_LOCK_PATH;
            }
            return BUN_LOCK_PATH;
        }
        catch {
            return BUN_LOCK_PATH;
        }
    }
    throw new Error(`Unknown package manager: ${packageManager}`);
}
/**
 * Create lock file based on the root level lock file and (pruned) package.json
 *
 * A pruned pnpm lockfile no longer declares the resolution-time pnpm config it
 * bakes into its snapshots, so the config is dropped from `packageJson` too:
 * pnpm 10 and below validate the manifest against the lockfile and abort a
 * frozen install with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH when the two disagree.
 * An inherited `pnpm.patchedDependencies` goes with it, since the prune scopes
 * the lockfile's patches to the packages that survive it and rewrites their
 * paths onto the output.
 * The manifest is left alone for npm and yarn, which never read that block.
 * Mutating it means callers must write or emit the manifest after this returns.
 *
 * The lockfile alone does not make a complete pnpm output. A workspace
 * declaring build-script approvals, patches or vendored local paths also needs
 * the artifacts `generatePrunedDeployOutput` ships, and this warns when that is
 * the case.
 *
 * On a pruning error the root lockfile is returned as a fail-open fallback,
 * with the manifest left as authored.
 *
 * @deprecated Use `generatePrunedDeployOutput` instead. This will be removed in Nx 25.
 */
function createLockFile(packageJson, graph, packageManager = (0, package_manager_1.detectPackageManager)(workspace_root_1.workspaceRoot)) {
    let pruned = true;
    const lockFileContent = buildLockFile(packageJson, graph, packageManager, {
        onPruneFallback: () => {
            pruned = false;
        },
    });
    if (pruned && packageManager === 'pnpm') {
        (0, pruned_output_1.stripPrunedLockfilePnpmConfig)(packageJson);
        (0, pruned_output_1.dropInheritedPnpmPatchedDependencies)(packageJson);
        (0, pruned_output_1.warnIncompletePrunedPnpmOutput)(lockFileContent);
    }
    return lockFileContent;
}
/**
 * `createLockFile` without the manifest reconciliation, for callers that own
 * that step themselves. `options.onPruneFallback` fires just before the
 * root-lockfile fallback is returned, so a caller can skip work that only makes
 * sense for an actually pruned lockfile (e.g. link-closure validation and
 * local-path artifact shipping). Every root-relative read resolves from
 * `options.workspaceRootPath`, so a caller passing one cannot end up with the
 * lockfile read from one root and the catalogs resolved from another.
 */
function buildLockFile(packageJson, graph, packageManager = (0, package_manager_1.detectPackageManager)(workspace_root_1.workspaceRoot), options) {
    const workspaceRootPath = options?.workspaceRootPath ?? workspace_root_1.workspaceRoot;
    const normalizedPackageJson = (0, package_json_1.normalizePackageJson)(packageJson);
    const content = (0, node_fs_1.readFileSync)((0, node_path_1.join)(workspaceRootPath, getLockFileName(packageManager)), 'utf8');
    try {
        if (packageManager === 'bun') {
            output_1.output.log({
                title: "Unable to create bun lock files. Run bun install it's just as quick",
            });
            return '';
        }
        const prunedGraph = (0, project_graph_pruning_1.pruneProjectGraph)(graph, packageJson, workspaceRootPath, packageManager);
        if (packageManager === 'yarn') {
            return (0, yarn_parser_1.stringifyYarnLockfile)(prunedGraph, content, normalizedPackageJson);
        }
        if (packageManager === 'pnpm') {
            return (0, pnpm_parser_1.stringifyPnpmLockfile)(prunedGraph, content, normalizedPackageJson, workspaceRootPath);
        }
        if (packageManager === 'npm') {
            return (0, npm_parser_1.stringifyNpmLockfile)(prunedGraph, content, normalizedPackageJson);
        }
    }
    catch (e) {
        options?.onPruneFallback?.(e);
        if (!isPostInstallProcess()) {
            const additionalInfo = [
                'To prevent the build from breaking we are returning the root lock file.',
            ];
            if (packageManager === 'npm') {
                additionalInfo.push('If you run `npm install --package-lock-only` in your output folder it will regenerate the correct pruned lockfile.');
            }
            if (packageManager === 'pnpm') {
                additionalInfo.push('If you run `pnpm install --lockfile-only` in your output folder it will regenerate the correct pruned lockfile.');
            }
            output_1.output.error({
                title: 'An error occurred while creating pruned lockfile',
                bodyLines: errorBodyLines(e, additionalInfo),
            });
        }
        return content;
    }
}
/**
 * Creates the pruned lockfile for a generate-package-json flow, running the
 * steps such a flow needs around `createLockFile`. For pnpm, the manifest's
 * `file:`/`link:` local-path specifiers are relocated to their shipped location
 * first (pnpm re-resolves them on a non-frozen install, and the lockfile copies
 * the manifest's form), and the local-path dependency closure is validated
 * after pruning so a shipped `link:` target that requires an unresolvable
 * dependency fails the build instead of the deploy. After a successful prune,
 * the manifest's pnpm config block is stripped for every package manager:
 * re-declaring config a pruned pnpm lockfile bakes into its snapshots trips
 * ERR_PNPM_LOCKFILE_CONFIG_MISMATCH, and npm and yarn never read the block at
 * install time, so dropping it does not change their installs. An inherited
 * `pnpm.patchedDependencies` is dropped on both paths, since the sinks below
 * declare the patches the output actually ships.
 *
 * `pruned` is false when the prune failed and the root lockfile was returned on a
 * pruning error: the fallback's importer describes the whole workspace, so the
 * manifest mutations are rolled back (the root lockfile matches the manifest as
 * authored: original local-path specifiers, the rest of the pnpm config kept),
 * the closure validation is skipped, and the remaining install-time pieces must
 * not ship local-path artifacts for it (see `getPrunedPnpmInstallArtifacts`).
 *
 * Mutates `packageJson` (the pnpm-only specifier relocation and the config
 * strip), so write or emit the manifest after calling this. Not for bun, which
 * has no lockfile generation.
 */
function createPrunedLockfile(packageJson, graph, projectRoot, workspaceRootPath = workspace_root_1.workspaceRoot, packageManager = (0, package_manager_1.detectPackageManager)(workspaceRootPath)) {
    const originalPackageJson = structuredClone(packageJson);
    if (packageManager === 'pnpm') {
        (0, pruned_output_1.rewritePrunedLocalPathSpecifiers)(packageJson, projectRoot, workspaceRootPath, new Set((0, get_workspace_packages_from_graph_1.getWorkspacePackagesFromGraph)(graph).keys()));
    }
    let pruneError;
    const lockFileContent = buildLockFile(packageJson, graph, packageManager, {
        onPruneFallback: (error) => {
            pruneError = error;
        },
        workspaceRootPath,
    });
    const pruned = pruneError === undefined;
    if (pruned) {
        (0, pruned_output_1.stripPrunedLockfilePnpmConfig)(packageJson);
        if (packageManager === 'pnpm') {
            (0, pruned_output_1.validatePrunedLocalPathClosure)(packageJson, workspaceRootPath, lockFileContent);
        }
    }
    else {
        // The root lockfile matches the manifest as authored, so undo the
        // specifier relocation and keep the pnpm config it still declares.
        for (const key of Object.keys(packageJson)) {
            delete packageJson[key];
        }
        Object.assign(packageJson, originalPackageJson);
        // The pruning error output is suppressed under a postinstall, so
        // this is the only signal there naming the cause and what the fallback
        // output is missing.
        const bodyLines = [`The lockfile pruning failed: ${pruneError?.message}`];
        if (packageManager === 'pnpm') {
            bodyLines.push('The emitted package.json keeps its resolution-time pnpm config (`overrides`, `packageExtensions`), its vendored local-path specifiers point at their original workspace locations, and no local-path artifacts are shipped for it.');
        }
        bodyLines.push(packageManager === 'npm'
            ? '`npm ci` in the output will fail; run `npm install` instead.'
            : packageManager === 'yarn'
                ? 'An immutable install of the output (`--immutable`, or `--frozen-lockfile` on yarn 1) may fail; run an install without immutability instead (yarn 2+ turns it on by default in CI).'
                : 'A `--frozen-lockfile` install of the output will fail; run a regular install instead.');
        output_1.output.warn({
            title: 'The pruned output falls back to the root lockfile',
            bodyLines,
        });
    }
    (0, pruned_output_1.dropInheritedPnpmPatchedDependencies)(packageJson);
    return { lockFileContent, pruned };
}
/**
 * Generates the standalone deploy output a generate-package-json flow ships
 * alongside its manifest: the pruned lockfile and, for pnpm, the install-time
 * artifacts that lockfile needs (the settings-only pnpm-workspace.yaml, the
 * `pnpm patch` files, and the vendored non-workspace local-path dependencies).
 * `options` carries either an `outputDirectory` to write into or an `emit` sink
 * for a bundler's asset pipeline, never both.
 *
 * Mutates `packageJson` into the form the output must ship (the relocated
 * local-path specifiers, the pnpm config strip, the pnpm <=10 build settings),
 * so write or emit the manifest after this returns.
 *
 * Bun has no lockfile generation, so it warns and ships nothing, leaving the
 * manifest as authored.
 */
function generatePrunedDeployOutput(packageJson, graph, projectRoot, options) {
    const workspaceRootPath = options.workspaceRoot ?? workspace_root_1.workspaceRoot;
    const { packageManager } = options;
    if (packageManager === 'bun') {
        output_1.output.warn({
            title: 'Bun lockfile generation is not supported',
            bodyLines: [
                'Only the package.json is generated. Run `bun install` in the output directory if needed.',
            ],
        });
        return;
    }
    const { lockFileContent, pruned } = createPrunedLockfile(packageJson, graph, projectRoot, workspaceRootPath, packageManager);
    const artifacts = [
        { path: getLockFileName(packageManager), content: lockFileContent },
    ];
    if (packageManager === 'pnpm') {
        artifacts.push(...(0, pruned_output_1.getPrunedPnpmInstallArtifacts)(workspaceRootPath, lockFileContent, packageJson, { includeLocalPathArtifacts: pruned }));
    }
    // Discriminate on the value, not key presence: options built by spread can
    // carry an explicitly-present `outputDirectory: undefined` beside `emit`.
    if (options.outputDirectory !== undefined) {
        const { outputDirectory } = options;
        // Directory trees flow through here one file at a time, so dedupe the
        // recursive mkdir per destination directory.
        const createdDirs = new Set();
        for (const artifact of artifacts) {
            const destination = (0, node_path_1.join)(outputDirectory, artifact.path);
            const destinationDir = (0, node_path_1.dirname)(destination);
            if (!createdDirs.has(destinationDir)) {
                (0, node_fs_1.mkdirSync)(destinationDir, { recursive: true });
                createdDirs.add(destinationDir);
            }
            if ('sourcePath' in artifact) {
                (0, node_fs_1.copyFileSync)(artifact.sourcePath, destination);
            }
            else {
                (0, node_fs_1.writeFileSync)(destination, artifact.content);
            }
        }
    }
    else {
        for (const artifact of artifacts) {
            options.emit(artifact.path, 'sourcePath' in artifact
                ? (0, node_fs_1.readFileSync)(artifact.sourcePath)
                : artifact.content);
        }
    }
}
// generate body lines for error message
function errorBodyLines(originalError, additionalInfo = []) {
    return [
        'Please open an issue at `https://github.com/nrwl/nx/issues/new?template=1-bug.yml` and provide a reproduction.',
        ...additionalInfo,
        `\nOriginal error: ${originalError.message}\n\n`,
        originalError.stack,
    ];
}
function isPostInstallProcess() {
    return (process.env.npm_command === 'install' &&
        process.env.npm_lifecycle_event === 'postinstall');
}
