"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.yargsCompletionCommand = void 0;
const prompt_helpers_1 = require("../../utils/prompt-helpers");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const handle_import_1 = require("../../utils/handle-import");
const SHELL_CHOICES = ['bash', 'zsh', 'fish', 'powershell'];
exports.yargsCompletionCommand = {
    command: 'completion [shell]',
    describe: 'Install shell completion for bash, zsh, fish, or powershell. Omit the shell to pick interactively.',
    builder: (yargs) => {
        const y = withCompletionOptions(yargs);
        // Yargs' built-in help is disabled (see nx-commands.ts) and this command
        // skips initLocal's --help handling, so handle it in the builder like init.
        if (process.argv.includes('--help') || process.argv.includes('-h')) {
            y.showHelp();
            process.exit(0);
        }
        return y;
    },
    handler: async (args) => {
        const scripts = await (0, handle_import_1.handleImport)('./scripts.js', __dirname);
        const shells = args.shell ? [args.shell] : await pickShellsInteractively();
        if (shells.length === 0) {
            console.warn('nx: no shells selected — nothing installed.');
            process.exit(0);
        }
        if (args.stdout && shells.length > 1) {
            console.warn('nx: --stdout only makes sense with one shell — concatenating two wrapper scripts to stdout is never useful.');
            process.exit(1);
        }
        const emit = args.stdout
            ? scripts.printCompletionScript
            : scripts.installCompletionScript;
        // Fire the PATH-advisory once, before any per-shell emit.
        if (!args.force)
            scripts.maybeWarnNxNotOnPath();
        for (const shell of shells)
            emit(shell);
        process.exit(0);
    },
};
function withCompletionOptions(yargs) {
    return yargs
        .positional('shell', {
        type: 'string',
        choices: SHELL_CHOICES,
        describe: 'Shell to install completion for.',
    })
        .option('force', {
        type: 'boolean',
        default: false,
        describe: 'Install the completion script even if `nx` is not found on PATH.',
    })
        .option('stdout', {
        type: 'boolean',
        default: false,
        describe: 'Print the completion script to stdout instead of writing to the shell rc file.',
    })
        .example('$0 completion bash', 'Install bash completion to ~/.bashrc')
        .example('$0 completion', 'Pick shells interactively and install completion for each')
        .example('$0 completion bash --stdout >> ~/.bash_profile', 'Print to stdout for a custom rc location');
}
async function pickShellsInteractively() {
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
        console.warn('nx: please specify a shell — `nx completion <bash|zsh|fish|powershell>`.');
        process.exit(1);
    }
    const detected = detectAvailableShells();
    return await (0, prompt_helpers_1.multiselectPrompt)({
        message: 'Install nx completion for which shell(s)?',
        choices: SHELL_CHOICES,
        // Pre-select shells we can detect on this machine.
        initialValues: SHELL_CHOICES.filter((name) => detected.has(name)),
        onCancel: () => [],
    });
}
/** Best-effort detect-which-shells-the-user-has. Pre-checks the multiselect.
 *  Signals: $SHELL basename, presence of conventional rc files, $PSModulePath
 *  for PowerShell. False positives are fine — the user can uncheck. */
function detectAvailableShells() {
    const found = new Set();
    const home = (0, os_1.homedir)();
    const shellEnv = (process.env.SHELL ?? '').replace(/\\/g, '/');
    const shellName = shellEnv.split('/').pop() ?? '';
    if (shellName === 'bash' || (0, fs_1.existsSync)((0, path_1.join)(home, '.bashrc'))) {
        found.add('bash');
    }
    if (shellName === 'zsh' || (0, fs_1.existsSync)((0, path_1.join)(home, '.zshrc'))) {
        found.add('zsh');
    }
    if (shellName === 'fish' ||
        (0, fs_1.existsSync)((0, path_1.join)(home, '.config', 'fish', 'config.fish'))) {
        found.add('fish');
    }
    if (process.env.PSModulePath || process.platform === 'win32') {
        found.add('powershell');
    }
    return found;
}
