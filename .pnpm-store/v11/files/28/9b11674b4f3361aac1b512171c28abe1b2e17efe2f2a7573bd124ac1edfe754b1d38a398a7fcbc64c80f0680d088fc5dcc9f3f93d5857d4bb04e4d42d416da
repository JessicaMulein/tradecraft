"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHELLS = void 0;
exports.printCompletionScript = printCompletionScript;
exports.installCompletionScript = installCompletionScript;
exports.maybeWarnNxNotOnPath = maybeWarnNxNotOnPath;
exports.generateScript = generateScript;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
exports.SHELLS = ['bash', 'zsh', 'fish', 'powershell'];
/** Print the raw wrapper script to stdout — for scripting / custom rc paths. */
function printCompletionScript(shell) {
    process.stdout.write(generateScript(shell));
}
/**
 * Write the wrapper to the shell's default rc location, replacing any prior
 * nx-completion block (idempotent via the begin/end markers). Logs the
 * resolved path and a one-line "open a new shell" hint.
 */
function installCompletionScript(shell) {
    writeScriptToRcFile(shell);
}
/**
 * Stderr advisory when `nx` is not on PATH — the wrappers walk up for a
 * workspace-local nx, but the outside-workspace fallback needs `nx`
 * reachable by name. Callers fire this ONCE per invocation even when
 * installing for multiple shells.
 */
function maybeWarnNxNotOnPath() {
    if (isNxOnPath())
        return;
    console.warn([
        `nx: \`nx\` is not on your PATH.`,
        `    The generated wrappers resolve a workspace-local nx when you`,
        `    tab-complete inside a project, but outside any workspace they`,
        `    fall back to a bare \`nx\`. Install nx globally so completion`,
        `    works everywhere (e.g. \`pnpm add -g nx\` or \`npm i -g nx\`).`,
        `    Continuing — pass --force to skip this notice.`,
    ].join('\n'));
}
function writeScriptToRcFile(shell) {
    const script = generateScript(shell);
    const paths = installPathsFor(shell);
    if (paths.length === 0) {
        console.warn(`nx: automatic install isn't supported for ${shell} yet — run with --stdout and redirect manually.`);
        return;
    }
    for (const path of paths) {
        writeOneRcFile(shell, path, script);
    }
}
function writeOneRcFile(shell, path, script) {
    (0, fs_1.mkdirSync)((0, path_1.dirname)(path), { recursive: true });
    // Fish keeps each completion in its own file (a full overwrite is correct).
    // bash/zsh/powershell append to a shared rc file: skip if an nx-completion
    // block is already present so re-runs are no-ops, and never modify
    // existing content — the user may have customized around the block.
    if (shell === 'fish') {
        (0, fs_1.writeFileSync)(path, script);
    }
    else {
        const existing = (0, fs_1.existsSync)(path) ? (0, fs_1.readFileSync)(path, 'utf8') : '';
        if (existing.includes('###-begin-nx-completions-###')) {
            console.warn(`nx: ${shell} completion already present in ${path} — skipping.\n` +
                `    Remove the existing block manually if you need to reinstall.`);
            return;
        }
        const sep = existing && !existing.endsWith('\n') ? '\n' : '';
        (0, fs_1.writeFileSync)(path, existing + sep + script);
    }
    console.warn(`nx: ${shell} completion installed at ${path}.\n` +
        `    Open a new shell (or re-source the rc file) to activate.`);
}
function installPathsFor(shell) {
    const home = (0, os_1.homedir)();
    switch (shell) {
        case 'bash':
            return [(0, path_1.join)(home, '.bashrc')];
        case 'zsh':
            return [(0, path_1.join)(home, '.zshrc')];
        case 'fish':
            return [(0, path_1.join)(home, '.config', 'fish', 'completions', 'nx.fish')];
        case 'powershell':
            return resolvePowerShellProfiles();
    }
}
/**
 * Shell out to each available PowerShell to expand $PROFILE. The variable's
 * resolution depends on the PS version (5.1 vs 7), $PSVersionTable, and
 * Windows Documents-folder redirection (OneDrive etc.), so asking PS itself
 * is the only reliable way. Returns every distinct profile path we find —
 * PS 5.1 and PS 7 keep separate profile files, so a user with both
 * installed needs the wrapper written to both.
 */
function resolvePowerShellProfiles() {
    const candidates = process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe'] : ['pwsh'];
    const paths = [];
    for (const exe of candidates) {
        const result = (0, child_process_1.spawnSync)(exe, ['-NoProfile', '-Command', '$PROFILE'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        });
        if (result.status !== 0 || !result.stdout)
            continue;
        const path = result.stdout.trim();
        if (path && !paths.includes(path))
            paths.push(path);
    }
    return paths;
}
function isNxOnPath() {
    const pathEnv = process.env.PATH;
    if (!pathEnv)
        return false;
    const names = process.platform === 'win32' ? ['nx.cmd', 'nx.exe', 'nx'] : ['nx'];
    for (const dir of pathEnv.split(path_1.delimiter)) {
        if (!dir)
            continue;
        for (const name of names) {
            if ((0, fs_1.existsSync)((0, path_1.join)(dir, name)))
                return true;
        }
    }
    return false;
}
// Wrappers live as plain files in ./scripts/ for syntax highlighting and
// shellcheck. Read at call time — each invocation needs each shell's
// wrapper at most once.
const WRAPPER_FILES = {
    bash: 'bash.sh',
    zsh: 'zsh.zsh',
    fish: 'fish.fish',
    powershell: 'powershell.ps1',
};
function generateScript(shell) {
    return (0, fs_1.readFileSync)((0, path_1.join)(__dirname, 'scripts', WRAPPER_FILES[shell]), 'utf-8');
}
