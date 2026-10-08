"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prettierConfigFiles = void 0;
exports.isUsingPrettier = isUsingPrettier;
exports.isUsingPrettierInTree = isUsingPrettierInTree;
exports.filterToPrettierSupportedFiles = filterToPrettierSupportedFiles;
exports.writeWithPrettier = writeWithPrettier;
exports.checkWithPrettier = checkWithPrettier;
exports.getPrettierPath = getPrettierPath;
exports.quoteForShell = quoteForShell;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const semver_1 = require("semver");
const json_1 = require("../../generators/utils/json");
const fileutils_1 = require("../fileutils");
const handle_import_1 = require("../handle-import");
const package_json_1 = require("../package-json");
const shared_1 = require("./shared");
/**
 * Config filenames prettier discovers. Exported because generator setup must
 * agree with detection - a format missing from one side gets a second,
 * redundant config written next to it.
 * https://prettier.io/docs/configuration
 */
exports.prettierConfigFiles = [
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    '.prettierrc.json5',
    '.prettierrc.js',
    'prettier.config.js',
    '.prettierrc.ts',
    'prettier.config.ts',
    '.prettierrc.mjs',
    'prettier.config.mjs',
    '.prettierrc.mts',
    'prettier.config.mts',
    '.prettierrc.cjs',
    'prettier.config.cjs',
    '.prettierrc.cts',
    'prettier.config.cts',
    '.prettierrc.toml',
];
function isUsingPrettier(root) {
    for (const file of exports.prettierConfigFiles) {
        if ((0, node_fs_1.existsSync)((0, node_path_1.join)(root, file))) {
            return true;
        }
    }
    // Even if no file is present, it is possible the user is configuring prettier via their package.json
    const packageJsonPath = (0, node_path_1.join)(root, 'package.json');
    if ((0, node_fs_1.existsSync)(packageJsonPath)) {
        const packageJson = (0, fileutils_1.readJsonFile)(packageJsonPath);
        if (packageJson.prettier) {
            return true;
        }
    }
    return false;
}
function isUsingPrettierInTree(tree) {
    for (const file of exports.prettierConfigFiles) {
        if (tree.exists(file)) {
            return true;
        }
    }
    // Even if no file is present, it is possible the user is configuring prettier via their package.json
    if (tree.exists('package.json')) {
        const packageJson = (0, json_1.readJson)(tree, 'package.json');
        if (packageJson.prettier) {
            return true;
        }
    }
    return false;
}
/**
 * Keeps only the files prettier can format. oxfmt needs no equivalent - it
 * silently skips file types it does not handle.
 */
async function filterToPrettierSupportedFiles(files) {
    const prettier = await (0, handle_import_1.handleImport)('prettier');
    const supportInfo = await prettier.getSupportInfo();
    const supportedExtensions = new Set(supportInfo.languages
        .flatMap((language) => language.extensions)
        .filter((extension) => !!extension));
    // Prettier matches ~30 files by *name* rather than extension (`.swcrc`,
    // `Jakefile`). It publishes that list next to the extensions, so read it
    // rather than hardcoding.
    const supportedFilenames = new Set(supportInfo.languages.flatMap((language) => language.filenames ?? []));
    return files.filter((file) => supportedExtensions.has((0, node_path_1.extname)(file)) ||
        supportedFilenames.has((0, node_path_1.basename)(file)));
}
function writeWithPrettier(patterns, 
// Defaults to the caller's cwd. `nx init` sets it so it can pass paths
// relative to the repo root rather than absolute ones the user has to read.
cwd) {
    if (patterns.length === 0) {
        // Prettier with no file arguments reads stdin, and `stdio: [0, 1, 2]` hands
        // it nx's own - from a terminal it blocks forever with nothing on screen. At
        // EOF it exits 0 under `--list-different` and 2 (which `execSync` throws on)
        // without it, so which failure you get depends on `shouldUseListDifferent`.
        return;
    }
    const prettierPath = getPrettierPath();
    const listDifferentArg = shouldUseListDifferent() ? '--list-different ' : '';
    // No `--parser json` special case for `.swcrc`: prettier's own language table
    // maps it to the json parser, so it formats correctly on its own (measured).
    // Splitting the batch also meant one of the two spawns could receive zero
    // files, which is the error above.
    (0, node_child_process_1.execSync)(`node ${quoteForShell(prettierPath)} --write ${listDifferentArg}-- ${patterns
        .map(quoteForShell)
        .join(' ')}`, {
        cwd,
        stdio: [0, 1, 2],
        windowsHide: true,
    });
}
function checkWithPrettier(patterns) {
    const prettierPath = getPrettierPath();
    return new Promise((resolve, reject) => {
        (0, node_child_process_1.exec)(`node ${quoteForShell(prettierPath)} --list-different -- ${patterns
            .map(quoteForShell)
            .join(' ')}`, { encoding: 'utf-8', windowsHide: true, maxBuffer: shared_1.FORMATTER_MAX_BUFFER }, (error, stdout) => {
            if (error) {
                // As the oxfmt sibling: a spawn failure, kill or maxBuffer overrun reports a
                // string `code` or none. Prettier signals "files differ" numerically, so
                // treating these as a file list would pass `format:check` on a formatter
                // that never ran.
                if (typeof error['code'] !== 'number') {
                    reject(new Error(`prettier could not be run to completion (${error['code'] ?? error.signal ?? 'unknown'}): ${error.message}`));
                    return;
                }
                // Only `Mismatch` means "files differ", as in `checkWithOxfmt`. `Failure`
                // still prints the files prettier got through - measured, one differing plus
                // one unparseable exits 2 with the differing file on stdout - so reading
                // stdout there would swallow the syntax error.
                if (error['code'] !== 1 /* PrettierExitCode.Mismatch */ ||
                    stdout.length === 0) {
                    reject(error);
                    return;
                }
                resolve(stdout.trim().split('\n'));
            }
            else {
                resolve([]);
            }
        });
    });
}
let prettierPath;
function getPrettierPath() {
    if (prettierPath) {
        return prettierPath;
    }
    const { packageJson, path: packageJsonPath } = (0, package_json_1.readModulePackageJson)('prettier');
    const bin = packageJson.bin;
    const binPath = typeof bin === 'string' ? bin : bin?.['prettier'];
    if (!binPath) {
        throw new Error(`Could not find prettier binary in ${packageJsonPath}`);
    }
    prettierPath = (0, node_path_1.resolve)((0, node_path_1.dirname)(packageJsonPath), binPath);
    return prettierPath;
}
let useListDifferent;
/**
 * Determines if --list-different should be used with --write.
 * Prettier 4+ and 3.6.x with experimental CLI don't support combining these flags.
 */
function shouldUseListDifferent() {
    if (useListDifferent !== undefined) {
        return useListDifferent;
    }
    try {
        const { packageJson } = (0, package_json_1.readModulePackageJson)('prettier');
        const prettierMajor = (0, semver_1.major)(packageJson.version);
        const isExperimentalCli = process.env.PRETTIER_EXPERIMENTAL_CLI === '1';
        useListDifferent = prettierMajor < 4 && !isExperimentalCli;
    }
    catch {
        useListDifferent = false;
    }
    return useListDifferent;
}
/**
 * Quote a pattern for prettier's shell-based exec calls; oxfmt uses execFile
 * and takes raw paths.
 *
 * Exported so `nx format` can size its chunks against the quoted length -
 * patterns are chunked before they get here, and quoting grows each one.
 */
function quoteForShell(pattern) {
    // Interpolated into a command string, so every character special *inside
    // double quotes* needs escaping, not just `$`: a backtick substitutes, `"`
    // closes the quoting, `\` escapes what follows. One pass over the original,
    // since `String.replace` never re-scans what it inserted.
    const escaped = process.platform !== 'win32'
        ? pattern.replace(/([\\"`$])/g, '\\$1')
        : pattern;
    return `"${escaped}"`;
}
