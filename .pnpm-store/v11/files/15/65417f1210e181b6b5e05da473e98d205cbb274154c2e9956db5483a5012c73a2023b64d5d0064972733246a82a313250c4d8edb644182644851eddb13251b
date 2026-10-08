"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PseudoTtyProcess = void 0;
exports.getRunNxBaseCommand = getRunNxBaseCommand;
exports.getNxBin = getNxBin;
exports.readInstalledNxBin = readInstalledNxBin;
exports.runNxArgvSync = runNxArgvSync;
exports.runNxSync = runNxSync;
exports.runNxAsync = runNxAsync;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
const package_manager_1 = require("./package-manager");
const workspace_root_1 = require("./workspace-root");
const exit_codes_1 = require("./exit-codes");
const fileutils_1 = require("./fileutils");
const shell_quoting_1 = require("./shell-quoting");
function getRunNxBaseCommand(packageManagerCommand, cwd = process.cwd()) {
    if ((0, fs_1.existsSync)((0, path_1.join)(workspace_root_1.workspaceRoot, 'package.json'))) {
        if (!packageManagerCommand) {
            // `readLocalNxVersion` (command-line/migrate/migrate.ts) mirrors this
            // selector to predict which nx a spawn will run, for the workspaces
            // `getNxBin` declines to resolve; keep the two in sync.
            const pm = (0, package_manager_1.detectPackageManager)(workspace_root_1.workspaceRoot);
            packageManagerCommand = (0, package_manager_1.getPackageManagerCommand)(pm, workspace_root_1.workspaceRoot);
        }
        return `${packageManagerCommand.exec} nx`;
    }
    else {
        const offsetFromRoot = (0, path_1.relative)(cwd, (0, workspace_root_1.workspaceRootInner)(cwd, null));
        if (process.platform === 'win32') {
            return '.\\' + (0, path_1.join)(`${offsetFromRoot}`, 'nx.bat');
        }
        else {
            return './' + (0, path_1.join)(`${offsetFromRoot}`, 'nx');
        }
    }
}
/**
 * Locate an nx entry point to spawn for the workspace at `root`, so a caller
 * can run it directly instead of going through a shell. `findInstalledNxBin`
 * decides which one.
 *
 * Null means nothing may be spawned directly, leaving the caller to fall back
 * to `getRunNxBaseCommand`. Null is therefore always safe: it costs the
 * argument fidelity a direct spawn buys, never the ability to run.
 */
function getNxBin(root = workspace_root_1.workspaceRoot) {
    // A workspace with no root package.json runs nx through the `./nx` wrapper,
    // which reinstalls `.nx/installation` whenever it drifts from nx.json's
    // `installation.version`. Spawning the resolved entry point would skip that
    // sync, and a migration is precisely when the version changes.
    if (!(0, fs_1.existsSync)((0, path_1.join)(root, 'package.json'))) {
        return null;
    }
    return findInstalledNxBin(root);
}
/**
 * The entry point the nx installed directly under `dir` names, with no ascent
 * to `dir`'s ancestors. For an installation that declares nx itself, such as
 * the temp CLI `nx migrate` builds, an ancestor's nx is never the right answer.
 */
function readInstalledNxBin(dir) {
    const packageDir = (0, path_1.join)(dir, 'node_modules', 'nx');
    const manifest = (0, path_1.join)(packageDir, 'package.json');
    if (!(0, fs_1.existsSync)(manifest)) {
        return null;
    }
    let bin;
    try {
        ({ bin } = (0, fileutils_1.readJsonFile)(manifest));
    }
    catch {
        return null;
    }
    // npm accepts both the single-entry shorthand and the map form.
    const entry = typeof bin === 'string' ? bin : bin?.nx;
    return typeof entry === 'string' ? (0, path_1.join)(packageDir, entry) : null;
}
// Ascend to the nearest installed nx and take the entry point its `bin` field
// names, which is the file a package manager links into `node_modules/.bin`.
// Deliberately npx-shaped: npx and bun ascend unconditionally while pnpm and
// yarn stop at an outer workspace, so this can name an nx those two would
// decline to run.
//
// Deliberately not a resolver. Resolvers answer from NODE_PATH once their
// explicit paths miss, and `nxCliPath` (command-line/migrate/migrate.ts) points
// NODE_PATH at the temp installation before spawning it; they also answer
// through package self-reference, which hands back the running nx whatever
// `paths` they are given. Either one lets the temp installation hand off to
// itself, which for `--run-migrations` re-enters the same hand-off and respawns
// without end.
function findInstalledNxBin(root) {
    for (let dir = root;; dir = (0, path_1.dirname)(dir)) {
        // The nearest install wins, so an unusable manifest there ends the search
        // rather than deferring to an ancestor.
        if ((0, fs_1.existsSync)((0, path_1.join)(dir, 'node_modules', 'nx', 'package.json'))) {
            return readInstalledNxBin(dir);
        }
        if (dir === (0, path_1.dirname)(dir)) {
            return null;
        }
    }
}
/**
 * Run a nx command, passing the arguments through as an argv array.
 *
 * When `getNxBin` names an entry point, the child is spawned directly with no
 * shell in between, so every argument reaches the child exactly as provided:
 * shell metacharacters (`(`, `%`, `^`, spaces, quotes) are data, not syntax.
 * Otherwise falls back to the package-manager + shell path, where every
 * argument goes through `quoteShellArg` and the Windows limits it documents
 * apply.
 */
function runNxArgvSync(argv, options) {
    let { nxBin, ...spawnOptions } = options ?? {};
    spawnOptions.cwd ??= process.cwd();
    spawnOptions.windowsHide ??= true;
    nxBin ??= getNxBin((0, workspace_root_1.workspaceRootInner)(spawnOptions.cwd, null) ?? workspace_root_1.workspaceRoot);
    if (!nxBin) {
        runNxSync(argv.map(shell_quoting_1.quoteShellArg).join(' '), spawnOptions);
        return;
    }
    const result = (0, child_process_1.spawnSync)(process.execPath, [nxBin, ...argv], spawnOptions);
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        const error = new Error(`Command failed: nx ${argv.join(' ')} (exit code ${result.status})`);
        error.status = result.status ?? 1;
        throw error;
    }
}
function runNxSync(cmd, options) {
    let { packageManagerCommand, ...execSyncOptions } = options ?? {};
    execSyncOptions.cwd ??= process.cwd();
    execSyncOptions.windowsHide ??= true;
    const baseCmd = getRunNxBaseCommand(packageManagerCommand, execSyncOptions.cwd);
    (0, child_process_1.execSync)(`${baseCmd} ${cmd}`, execSyncOptions);
}
async function runNxAsync(cmd, options) {
    options ??= {};
    options.cwd ??= process.cwd();
    let { silent, packageManagerCommand, ...execSyncOptions } = options;
    silent ??= true;
    const baseCmd = getRunNxBaseCommand(packageManagerCommand, execSyncOptions.cwd);
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.exec)(`${baseCmd} ${cmd}`, { ...execSyncOptions, windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                reject(stderr || stdout || error.message);
            }
            else {
                resolve();
            }
        });
        if (!silent) {
            child.stdout?.pipe(process.stdout);
            child.stderr?.pipe(process.stderr);
        }
    });
}
class PseudoTtyProcess {
    constructor(childProcess) {
        this.childProcess = childProcess;
        this.isAlive = true;
        this.exitCallbacks = [];
        childProcess.onExit((message) => {
            this.isAlive = false;
            const exitCode = (0, exit_codes_1.messageToCode)(message);
            this.exitCallbacks.forEach((cb) => cb(exitCode));
        });
    }
    onExit(callback) {
        this.exitCallbacks.push(callback);
    }
    onOutput(callback) {
        this.childProcess.onOutput(callback);
    }
    kill() {
        try {
            this.childProcess.kill();
        }
        catch {
            // when the child process completes before we explicitly call kill, this will throw
            // do nothing
        }
        finally {
            if (this.isAlive == true) {
                this.isAlive = false;
            }
        }
    }
}
exports.PseudoTtyProcess = PseudoTtyProcess;
