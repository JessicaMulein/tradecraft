"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.oxfmtConfigFiles = void 0;
exports.isUsingOxfmt = isUsingOxfmt;
exports.isUsingOxfmtInTree = isUsingOxfmtInTree;
exports.getOxfmtBinPath = getOxfmtBinPath;
exports.writeWithOxfmt = writeWithOxfmt;
exports.checkWithOxfmt = checkWithOxfmt;
exports.formatFilesWithOxfmt = formatFilesWithOxfmt;
const tslib_1 = require("tslib");
const ignore = require("ignore");
const minimatch_1 = require("minimatch");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const path = tslib_1.__importStar(require("node:path"));
const node_url_1 = require("node:url");
const ignore_1 = require("../ignore");
const json_1 = require("../json");
const package_json_1 = require("../package-json");
const shared_1 = require("./shared");
const dynamicImport = new Function('specifier', 'return import(specifier)');
/**
 * oxfmt errors on a file it has no parser for rather than skipping it, and
 * nx hands it every changed file.
 */
const UNSUPPORTED_FILE_TYPE = 'Unsupported file type';
/**
 * Config filenames oxfmt *discovers* - narrower than the set `-c` accepts.
 * Measured against 0.60.0: `oxfmt.config.{js,cjs,mjs,cts}` load when named
 * but are never searched for, so treating one as config would format on
 * options oxfmt ignores. No precedence order - oxfmt fails with
 * "Both '<a>' and '<b>' found in <dir>" when a directory holds two.
 */
exports.oxfmtConfigFiles = [
    '.oxfmtrc.json',
    '.oxfmtrc.jsonc',
    'oxfmt.config.ts',
    'oxfmt.config.mts',
];
function isUsingOxfmt(root) {
    for (const file of exports.oxfmtConfigFiles) {
        if ((0, node_fs_1.existsSync)(path.join(root, file))) {
            return true;
        }
    }
    return false;
}
function isUsingOxfmtInTree(tree) {
    for (const file of exports.oxfmtConfigFiles) {
        if (tree.exists(file)) {
            return true;
        }
    }
    return false;
}
/**
 * oxfmt exits 2 when *every* path was skipped. Nx routinely passes mixed
 * file lists, so an empty match is success, not failure.
 */
const OXFMT_BASE_ARGS = ['--no-error-on-unmatched-pattern'];
let cachedOxfmtBin;
function getOxfmtBinPath() {
    if (cachedOxfmtBin) {
        return cachedOxfmtBin;
    }
    const { packageJson, path: packageJsonPath } = (0, package_json_1.readModulePackageJson)('oxfmt');
    const bin = typeof packageJson.bin === 'string'
        ? packageJson.bin
        : packageJson.bin?.['oxfmt'];
    if (!bin) {
        throw new Error(`Could not find the oxfmt binary in ${packageJsonPath}`);
    }
    cachedOxfmtBin = path.resolve(path.dirname(packageJsonPath), bin);
    return cachedOxfmtBin;
}
function writeWithOxfmt(patterns, 
// Defaults to the caller's cwd. `nx init` sets it so it can pass paths
// relative to the repo root rather than absolute ones the user has to read.
cwd) {
    const oxfmtPath = getOxfmtBinPath();
    (0, node_child_process_1.execFileSync)('node', [oxfmtPath, ...OXFMT_BASE_ARGS, '--write', '--', ...patterns], {
        cwd,
        stdio: [0, 1, 2],
        windowsHide: true,
    });
}
function checkWithOxfmt(patterns) {
    const oxfmtPath = getOxfmtBinPath();
    return new Promise((resolve, reject) => {
        (0, node_child_process_1.execFile)('node', [oxfmtPath, ...OXFMT_BASE_ARGS, '--list-different', '--', ...patterns], {
            encoding: 'utf-8',
            windowsHide: true,
            maxBuffer: shared_1.FORMATTER_MAX_BUFFER,
        }, (error, stdout, stderr) => {
            // A spawn failure, kill, or maxBuffer overrun reports a string `code` or
            // none. Treating those as exit 0 would let `nx format:check` pass on a
            // formatter that never ran, so they reject before the code is read.
            if (error && typeof error['code'] !== 'number') {
                reject(new Error(`oxfmt could not be run to completion (${error['code'] ?? error.signal ?? 'unknown'}): ${error.message}`));
                return;
            }
            // oxfmt writes the differing paths to stdout *before* it reports any
            // error, so a non-empty stdout does not mean the run succeeded. The
            // exit code is the only reliable signal.
            const code = error ? error['code'] : 0 /* OxfmtExitCode.Success */;
            if (code === 0 /* OxfmtExitCode.Success */) {
                resolve([]);
            }
            else if (code === 1 /* OxfmtExitCode.Mismatch */ &&
                stdout.trim().length > 0) {
                resolve(stdout.trim().split('\n'));
            }
            else {
                // Exit 1 with no stdout means an invalid config; exit 2 means oxfmt
                // failed outright (parse error, unreadable file).
                reject(new Error(stderr?.trim() ||
                    error?.message ||
                    `oxfmt exited with code ${code}`));
            }
        });
    });
}
let cachedOxfmtModule;
/**
 * `require` first: Node resolves ESM-only through it (20.19+/22.12+), and the
 * bare specifier is what lets jest swap in a CommonJS mock. The fallback reaches
 * `import()` via `new Function` so TypeScript cannot downlevel it to `require`.
 *
 * The two resolve from different places on purpose - `require` from nx's own
 * chain, the fallback from the workspace's install, since nx does not depend
 * on oxfmt.
 */
function loadOxfmtModule() {
    if (!cachedOxfmtModule) {
        cachedOxfmtModule = (async () => {
            try {
                // Node resolves an ESM-only package through `require` on its own, and
                // going through the package name keeps the module mockable.
                const required = require('oxfmt');
                return required.format ? required : required.default;
            }
            catch {
                // Older runtimes cannot `require` an ESM package, so import the entry
                // point the same way the binary is resolved - from the workspace's own
                // install, because nx does not depend on oxfmt itself.
                const { packageJson, path: packageJsonPath } = (0, package_json_1.readModulePackageJson)('oxfmt');
                const entryPoint = path.resolve(path.dirname(packageJsonPath), packageJson.main ?? 'dist/index.js');
                const imported = await dynamicImport((0, node_url_1.pathToFileURL)(entryPoint).href);
                return imported.format ? imported : imported.default;
            }
        })().catch((error) => {
            // Do not hold on to the failure - the next call gets to try again.
            cachedOxfmtModule = undefined;
            throw error;
        });
    }
    return cachedOxfmtModule;
}
function isJsonOxfmtConfig(name) {
    return name.endsWith('.json') || name.endsWith('.jsonc');
}
/**
 * `register` is required lazily so a JSON config does not pull in the
 * transpiler. `loadTsFile` bubbles the ESM-redispatch codes for a caller like
 * this one to dispatch to `import()`.
 *
 * The retry is deliberately not gated on those codes: the same config surfaces
 * as `ERR_REQUIRE_ASYNC_MODULE` or as `exports is not defined` depending on
 * whether swc/ts-node registered, and both mean "this is ESM, import it".
 * Only `import()` ever evaluates the config, so its error is thrown with the
 * `require` one as its cause rather than either being chosen.
 *
 * Covered by `create-nx-workspace-formatter.test.ts`; unreachable from jest.
 */
async function loadTsOxfmtConfig(configPath) {
    try {
        return require('../../plugins/js/utils/register').loadTsFile(configPath);
    }
    catch (loadError) {
        try {
            return await dynamicImport((0, node_url_1.pathToFileURL)(configPath).href);
        }
        catch (importError) {
            throw Object.assign(importError, { cause: loadError });
        }
    }
}
/**
 * True when an ignore file along the chain covers the file, or the resolved
 * config's own `ignorePatterns` do.
 *
 * `ignorePatterns` is not an ignore file: oxfmt roots it at that config's
 * directory, so it is matched separately from the chain.
 */
function isIgnored(isIgnoredFile, relativePath, config, absoluteFilePath) {
    if (isIgnoredFile(relativePath)) {
        return true;
    }
    if (config.ignoreMatcher) {
        const relative = toRelativeWithin(config.dir, absoluteFilePath);
        if (relative !== undefined && config.ignoreMatcher.ignores(relative)) {
            return true;
        }
    }
    return false;
}
function readEditorConfigInDir(dir) {
    let contents;
    try {
        contents = (0, node_fs_1.readFileSync)(path.join(dir, '.editorconfig'), 'utf-8');
    }
    catch (e) {
        // Not having one is the common case. Anything else - unreadable, a
        // directory, a broken mount - would otherwise look identical to that and
        // silently format to different widths than `nx format` produces.
        if (e.code !== 'ENOENT') {
            throw new Error(`Could not read .editorconfig: ${e.message}`);
        }
        return undefined;
    }
    return parseEditorConfig(contents);
}
/**
 * Compiles each section's glob once per batch, not per file: the globs are
 * invariant, so this is O(sections) rather than O(files x sections).
 */
function parseEditorConfig(contents) {
    const sections = [];
    let current;
    let isRoot = false;
    for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
            continue;
        }
        const header = /^\[(.*)\]$/.exec(trimmed);
        if (header) {
            current = { matches: compileEditorConfigGlob(header[1]), properties: {} };
            sections.push(current);
            continue;
        }
        const separator = trimmed.indexOf('=');
        if (separator === -1) {
            continue;
        }
        const key = trimmed.slice(0, separator).trim().toLowerCase();
        const value = trimmed
            .slice(separator + 1)
            .trim()
            .toLowerCase();
        // Anything before the first section is preamble, where `root = true` stops
        // the walk-up.
        if (!current) {
            if (key === 'root' && value === 'true') {
                isRoot = true;
            }
            continue;
        }
        current.properties[key] = value;
    }
    return { sections, isRoot };
}
/**
 * The `.editorconfig` files applying to a directory, farthest first, walking
 * up until one declares `root = true` - the spec's termination rule, which
 * the oxfmt CLI follows. Deliberately continues above the workspace root,
 * where a repo nested in a larger checkout keeps shared settings.
 *
 * `read` takes workspace-relative paths and the walk starts at the workspace
 * root, so it can only serve the starting directory; every directory above
 * sits outside the workspace and is read from disk.
 *
 * Returned in application order, so nearer overwrites farther.
 */
function editorConfigChainFor(dir, read) {
    const found = [];
    const start = path.resolve(dir);
    let current = start;
    while (true) {
        let parsed;
        if (read && current === start) {
            const contents = read('.editorconfig');
            parsed = contents == null ? undefined : parseEditorConfig(contents);
        }
        else {
            parsed = readEditorConfigInDir(current);
        }
        if (parsed) {
            found.push({ ...parsed, dir: current });
            if (parsed.isRoot) {
                break;
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return found.reverse();
}
/**
 * Compiles one `.editorconfig` section header into a matcher.
 *
 * Per the spec a pattern containing `/` is relative to the `.editorconfig`'s
 * directory (a leading `/` is only an anchor and is stripped); one with no
 * separator applies at any depth.
 */
function compileEditorConfigGlob(glob) {
    const pattern = glob.startsWith('/')
        ? glob.slice(1)
        : glob.includes('/')
            ? glob
            : `**/${glob}`;
    const matcher = new minimatch_1.Minimatch(pattern, { dot: true });
    return (filePath) => matcher.match(filePath);
}
/**
 * Translates the `.editorconfig` properties with an oxfmt equivalent. Values
 * oxfmt has no meaning for - including the spec's `unset` - are left out so
 * oxfmt's own default applies.
 */
function editorConfigOptionsForFile(files, absoluteFilePath) {
    const properties = {};
    for (const file of files) {
        // Globs are relative to the directory holding the `.editorconfig`.
        const relative = toRelativeWithin(file.dir, absoluteFilePath);
        if (relative === undefined) {
            continue;
        }
        for (const section of file.sections) {
            if (section.matches(relative)) {
                // Later sections win, matching how editorconfig resolves a property.
                Object.assign(properties, section.properties);
            }
        }
    }
    const options = {};
    const indentStyle = properties['indent_style'];
    if (indentStyle === 'tab' || indentStyle === 'space') {
        options.useTabs = indentStyle === 'tab';
    }
    // Measured divergence, left deliberately: with no `indent_style` the CLI
    // ignores `indent_size` and uses `tab_width` (default 2), while this follows
    // the spec and honours `indent_size`. Matching the quirk would drop a width
    // the user asked for. With `indent_style` set - nearly every file - the two
    // agree.
    const indentSize = properties['indent_size'] ?? properties['tab_width'];
    if (indentSize === 'tab') {
        options.useTabs = true;
    }
    else if (indentSize && /^\d+$/.test(indentSize)) {
        options.tabWidth = Number(indentSize);
    }
    const maxLineLength = properties['max_line_length'];
    if (maxLineLength && /^\d+$/.test(maxLineLength)) {
        options.printWidth = Number(maxLineLength);
    }
    const quoteType = properties['quote_type'];
    if (quoteType === 'single' || quoteType === 'double') {
        options.singleQuote = quoteType === 'single';
    }
    const endOfLine = properties['end_of_line'];
    if (endOfLine === 'lf' || endOfLine === 'crlf' || endOfLine === 'cr') {
        options.endOfLine = endOfLine;
    }
    const insertFinalNewline = properties['insert_final_newline'];
    if (insertFinalNewline === 'true' || insertFinalNewline === 'false') {
        options.insertFinalNewline = insertFinalNewline === 'true';
    }
    return options;
}
/**
 * `overrides` and `ignorePatterns` are config-file schema, not the
 * `FormatConfig` the programmatic API takes - `format()` would silently drop
 * them, so a generator would diverge from `nx format`. Split out here and
 * applied per file by `formatFilesWithOxfmt`.
 */
function splitOxfmtConfig(config) {
    if (config === undefined) {
        return {};
    }
    // Measured: `123` / `"x"` / `[]` / `null` / `true` each exit 1 with
    // "invalid type: ... expected struct Oxfmtrc". Returning `{}` would instead
    // format on bare defaults - the divergence the `error` arm prevents. `[]`
    // needs its own check since `typeof [] === 'object'`. `config` stays
    // `unknown` so the guard does not look dead.
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        return { error: 'the config must be an object' };
    }
    const { overrides: rawOverrides, ignorePatterns: rawIgnorePatterns, ...options } = config;
    // oxfmt reads an explicit `null` as an absent key and formats without
    // complaint, so it is normalised rather than rejected - erroring here would
    // skip the whole batch over a config `nx format` accepts.
    const overrides = rawOverrides ?? undefined;
    const ignorePatterns = rawIgnorePatterns ?? undefined;
    // Shapes oxfmt refuses to load are reported rather than dropped. Quietly
    // ignoring them would leave the batch formatting past exclusions the config
    // asked for, while `nx format` on the same workspace fails outright.
    if (ignorePatterns !== undefined &&
        (!Array.isArray(ignorePatterns) ||
            ignorePatterns.some((pattern) => typeof pattern !== 'string'))) {
        return { error: '"ignorePatterns" must be an array of strings' };
    }
    if (overrides !== undefined &&
        (!Array.isArray(overrides) ||
            overrides.some((override) => override === null ||
                typeof override !== 'object' ||
                // `files` is required by oxfmt, not merely typed: an override that
                // omits it fails the whole config with "missing field `files`".
                override.files === undefined ||
                !isGlobSet(override.files) ||
                !isGlobSet(override.excludeFiles)))) {
        return {
            error: '"overrides" must be an array of { files, excludeFiles } string arrays, each with "files"',
        };
    }
    return {
        options,
        ignorePatterns,
        overrides: Array.isArray(overrides)
            ? overrides.map((override) => {
                // oxfmt matches these against paths relative to the config file,
                // which for a workspace batch is the workspace root.
                const include = compileGlobSet(override?.files);
                const exclude = compileGlobSet(override?.excludeFiles);
                return {
                    matches: (filePath) => include(filePath) && !exclude(filePath),
                    options: (override?.options ?? {}),
                };
            })
            : undefined,
    };
}
/**
 * oxfmt's `GlobSet` is `string[]`. Absent passes: it is legal for
 * `excludeFiles`, and `files` is checked separately by its caller.
 */
function isGlobSet(globs) {
    return (globs === undefined ||
        (Array.isArray(globs) && globs.every((g) => typeof g === 'string')));
}
function compileGlobSet(globs) {
    // Not lenient about a bare string, though prettier allows one: oxfmt's type
    // is `GlobSet = string[]` and its CLI rejects the config with "invalid type:
    // string, expected a sequence". Accepting it would apply an override that
    // `nx format` refuses to run.
    if (!Array.isArray(globs) || globs.length === 0) {
        return () => false;
    }
    const matchers = globs.map((glob) => {
        // oxfmt lifts a separator-less pattern to any depth and reads `./` as
        // anchored to the config's directory; minimatch does neither, so `*.md`
        // would match only at the root - the shape `oxfmt migrate-prettier` emits.
        // See GlobSet::new in crates/oxc_config/src/glob_set.rs.
        const lifted = glob.startsWith('./')
            ? glob.slice(2)
            : glob.includes('/')
                ? glob
                : `**/${glob}`;
        // Under negation oxfmt collapses a *single* leading globstar to one segment:
        // `!**/t.ts` selects as `!*/t.ts`, where minimatch's zero-or-more `**` would
        // exclude every `t.ts`. Interior and doubled leading globstars already agree
        // - measured against 0.60.0, so rewriting those would introduce divergence.
        const pattern = lifted.startsWith('!**/') && !lifted.startsWith('!**/**/')
            ? `!*/${lifted.slice(4)}`
            : lifted;
        // minimatch's `!` handling is left on: oxfmt normalizes then matches with
        // fast-glob, which also treats leading `!` as inversion. A separator-less
        // `!*.ts` is lifted above, so its `!` stops being leading and neither
        // inverts.
        return new minimatch_1.Minimatch(pattern, { dot: true });
    });
    return (filePath) => matchers.some((matcher) => matcher.match(filePath));
}
/**
 * Options from every override matching this file; later ones win. Globs are
 * rooted at the workspace, so a path outside it matches nothing.
 */
function overrideOptionsForFile(overrides, filePath) {
    if (!overrides?.length || filePath === undefined) {
        return undefined;
    }
    let options;
    for (const override of overrides) {
        if (override.matches(filePath)) {
            options = { ...options, ...override.options };
        }
    }
    return options;
}
/**
 * Reimplements oxfmt's own config resolution because `format()` discovers
 * nothing. Tracked at https://github.com/oxc-project/oxc/issues/19922.
 *
 * The nearest config at or above the file's directory wins and *replaces* the
 * one above rather than merging - measured against oxfmt 0.60.0, so merging
 * here would format differently from `nx format:write`.
 *
 * `seedConfig` is a root config that exists only in the tree, so it outranks
 * disk. JSON only - a TypeScript form is reported rather than formatted against
 * whatever it is replacing.
 * There is no JavaScript branch - oxfmt does not discover `oxfmt.config.js`.
 */
async function resolveOxfmtConfigInDir(dir, workspaceRoot, seedConfig, rootConfigNames) {
    const isRoot = path.resolve(dir) === path.resolve(workspaceRoot);
    // oxfmt defines no precedence between two config files in one directory and
    // refuses to run, so choosing one here would format against a config the next
    // `nx format:write` rejects outright. A seed shares the flushed directory
    // with whatever is on disk, and replaces only the name it matches.
    //
    // `rootConfigNames` is the root's post-flush state, which disk cannot see: a
    // staged config is not there yet, and a deleted one still is.
    const candidates = isRoot && rootConfigNames
        ? rootConfigNames
        : exports.oxfmtConfigFiles.filter((name) => (0, node_fs_1.existsSync)(path.join(dir, name)) ||
            (isRoot && seedConfig?.name === name));
    if (candidates.length > 1) {
        return {
            error: `Both '${candidates[0]}' and '${candidates[1]}' found in ${path.relative(workspaceRoot, dir) || '.'} - oxfmt does not define which one wins.`,
        };
    }
    // The seed previews JSON only. Nx generates `.oxfmtrc.json` and never a
    // TypeScript config, so a TS name here means some other generator staged one
    // - and evaluating it means importing it, which tree content cannot stand in
    // for. An older copy on disk is not a fallback: it would format against the
    // options being replaced.
    if (seedConfig && isRoot && !isJsonOxfmtConfig(seedConfig.name)) {
        return {
            error: `Cannot read ${seedConfig.name} before it is written to disk. Use a JSON oxfmt config, or format after the generator has finished.`,
        };
    }
    // The seed is the root config the generator just created, so it only stands
    // in for a config at the root itself.
    if (seedConfig && isJsonOxfmtConfig(seedConfig.name) && isRoot) {
        try {
            return splitOxfmtConfig((0, json_1.parseJson)(seedConfig.content));
        }
        catch (e) {
            return { error: `Could not read ${seedConfig.name}: ${e.message}` };
        }
    }
    // `candidates`, not every supported name: at the root a config the tree
    // deletes is still on disk, and reading it would format against a file the
    // flush is about to remove.
    for (const name of candidates) {
        const configPath = path.join(dir, name);
        if (!(0, node_fs_1.existsSync)(configPath)) {
            continue;
        }
        try {
            if (isJsonOxfmtConfig(name)) {
                return splitOxfmtConfig((0, json_1.parseJson)((0, node_fs_1.readFileSync)(configPath, 'utf-8')));
            }
            // Every discovered name is JSON above or TypeScript here - there is no
            // JavaScript branch, because oxfmt does not discover `oxfmt.config.js`.
            const loaded = (await loadTsOxfmtConfig(configPath));
            return splitOxfmtConfig(loaded?.default ?? loaded);
        }
        catch (e) {
            // Unlike the CLI, oxfmt never sees this file - it is handed options in
            // memory - so nothing else will report that the config is unusable.
            return {
                error: `Could not read ${path.relative(workspaceRoot, configPath)}: ${e.message}`,
            };
        }
    }
    return undefined;
}
function createOxfmtConfigResolver(workspaceRoot, seedConfig, rootConfigNames) {
    const cache = new Map();
    const resolve = async (fileDir) => {
        for (const dir of ancestorsWithin(workspaceRoot, fileDir)) {
            const config = await resolveOxfmtConfigInDir(dir, workspaceRoot, seedConfig, rootConfigNames);
            if (config) {
                return {
                    ...config,
                    dir,
                    ignoreMatcher: config.ignorePatterns?.length
                        ? ignore().add(config.ignorePatterns)
                        : undefined,
                };
            }
        }
        return { dir: workspaceRoot };
    };
    return (fileDir) => {
        const key = path.resolve(fileDir);
        let pending = cache.get(key);
        if (!pending) {
            pending = resolve(key);
            cache.set(key, pending);
        }
        return pending;
    };
}
/**
 * `dir` and every directory between it and `workspaceRoot`, nearest first.
 * Yields nothing when `dir` is outside the workspace.
 */
function* ancestorsWithin(workspaceRoot, dir) {
    const root = path.resolve(workspaceRoot);
    let current = path.resolve(dir);
    if (current !== root && !current.startsWith(root + path.sep)) {
        return;
    }
    while (true) {
        yield current;
        if (current === root) {
            return;
        }
        const parent = path.dirname(current);
        // `dirname` of a filesystem root returns itself; without this a path that
        // somehow escaped the check above would spin forever.
        if (parent === current) {
            return;
        }
        current = parent;
    }
}
/**
 * `ignore` rejects anything not already relative, and callers pass both
 * workspace-relative and absolute paths.
 *
 * Undefined for a path outside the workspace root, including the root
 * itself; the caller reads that as "no ignore rules apply". On Windows a
 * path on another drive comes back looking relative (`D:/...`) - wrong
 * rather than undefined, but no shipped caller does that.
 */
function toRelativeWithin(baseDir, filePath) {
    const relative = path
        .relative(baseDir, path.resolve(baseDir, filePath))
        .split(path.sep)
        .join('/');
    return relative && !relative.startsWith('../') ? relative : undefined;
}
/**
 * The batch's own oxfmt config, by discovery order.
 *
 * Any discovered name is returned; only the JSON form is honoured *as a seed*,
 * and `resolveOxfmtConfigInDir` is what gates that. A `.ts` config still loads
 * normally when it is found on disk.
 */
function findOxfmtConfigInBatch(files) {
    for (const name of exports.oxfmtConfigFiles) {
        const match = files.find((file) => file.path === name);
        if (match) {
            return { name, content: match.content };
        }
    }
    return undefined;
}
/**
 * Nothing is written to disk: staging files inside the workspace would race the
 * daemon's watcher and the project graph mid-generator.
 *
 * A path is absent from the result when oxfmt has no parser for it, an ignore
 * file covers it, or it is already formatted. One unparseable file fails only
 * itself; the rest of the batch still applies.
 */
async function formatFilesWithOxfmt(files, workspaceRoot, seedConfig, 
// Every supported config name the root holds once the tree is flushed. Only a
// Tree-holding caller knows this; without it the root is resolved from disk.
rootConfigNames, 
// Reads a workspace-relative file, `null` when it does not exist. A
// tree-holding caller passes a tree-backed one so ignore files and the root
// `.editorconfig` are read as they will be after the flush; everyone else
// gets disk.
read) {
    const formatted = new Map();
    if (files.length === 0) {
        return { formatted };
    }
    const { format } = await loadOxfmtModule();
    // Resolved from the file's own directory upwards, as the CLI does, cached
    // per directory. A config in the batch is the freshest there is, and for a
    // tree-holding caller may be the only copy. Callers that know which file
    // that is still pass it; this is the fallback.
    const resolveConfig = createOxfmtConfigResolver(workspaceRoot, seedConfig ?? findOxfmtConfigInBatch(files), rootConfigNames);
    // The filenames and the merge rule come from the shared constant so the two
    // consumers cannot drift; the cascade axis is the ancestor-aware checker
    // itself, which both go through. oxfmt honours `.prettierignore` as well as
    // `.gitignore` (measured against its CLI), keeping one matcher per file so a
    // `!` in one cannot re-include what the other excluded.
    // `readFileIfExisting` is not usable here: it returns '' for a missing file,
    // which an empty ignore file also returns.
    const resolveIgnores = (0, ignore_1.createIgnoreChainResolver)(read ??
        ((relativePath) => {
            const absolute = path.join(workspaceRoot, relativePath);
            return (0, node_fs_1.existsSync)(absolute) ? (0, node_fs_1.readFileSync)(absolute, 'utf-8') : null;
        }), ignore_1.OXFMT_IGNORE_OPTIONS.filenames, ignore_1.OXFMT_IGNORE_OPTIONS.merge);
    const { isIgnoredFile } = (0, ignore_1.createAncestorAwareIgnoreChecker)(resolveIgnores);
    // Measured against the CLI: it resolves `.editorconfig` from the directory it
    // runs in and never reads a nested one, unlike the per-file walk it does for
    // `.oxfmtrc.json`. Honouring a nearer file here would be undone by the next
    // `nx format:write`. The root's own file goes through `read`, so one a
    // generator staged (or deleted) is honoured as it will be after the flush.
    let editorConfigChain;
    try {
        editorConfigChain = editorConfigChainFor(workspaceRoot, read);
    }
    catch (e) {
        // Resolved once for the batch, so this sits outside the per-file catch.
        // Bare defaults would format to widths `nx format` does not, so an
        // unreadable file fails every file rather than being formatted without it.
        return { formatted, errors: files.map((f) => `${f.path}: ${e.message}`) };
    }
    const errors = [];
    await Promise.all(files.map(async (file) => {
        try {
            const absolutePath = path.resolve(workspaceRoot, file.path);
            const fileDir = path.dirname(absolutePath);
            const config = await resolveConfig(fileDir);
            if (config.error) {
                // An unreadable config costs the workspace's style *and* its
                // `ignorePatterns`, so formatting on bare defaults would rewrite files the
                // config asks to skip - and `tree.write` is not undone by a warning. Only
                // files under that config are skipped.
                errors.push(config.error);
                return;
            }
            // Inside the try: `ignores()` throws on a path it considers non-relative,
            // and an unhandled rejection would discard the whole batch's formatting. A
            // path outside the workspace cannot be covered by its ignore files.
            const relativePath = toRelativeWithin(workspaceRoot, file.path);
            if (relativePath !== undefined &&
                isIgnored(isIgnoredFile, relativePath, config, absolutePath)) {
                return;
            }
            // Overrides are globs in the config's own file, so they match relative
            // to wherever that config was found rather than to the workspace root.
            const relativeToConfig = toRelativeWithin(config.dir, absolutePath);
            const result = await format(absolutePath, file.content, {
                // Precedence runs .editorconfig < the config's own options < a
                // matching override, which is the order the CLI resolves them in.
                ...editorConfigOptionsForFile(editorConfigChain, absolutePath),
                ...config.options,
                ...overrideOptionsForFile(config.overrides, relativeToConfig),
            });
            if (result.errors?.length) {
                // Most changed files have no oxfmt parser; those are skipped rather than
                // reported, matching the CLI's --no-error-on-unmatched-pattern. Every
                // diagnostic is read, not just [0]: an `Unsupported file type` entry can
                // precede a real one.
                for (const failure of result.errors) {
                    if (failure.message.startsWith(UNSUPPORTED_FILE_TYPE)) {
                        continue;
                    }
                    // `message` alone is context-free ("Unexpected token"); the path
                    // and line live in the codeframe.
                    errors.push(`${file.path}: ${failure.codeframe?.trim() || failure.message}`);
                }
                return;
            }
            if (result.code !== file.content) {
                formatted.set(file.path, result.code);
            }
        }
        catch (e) {
            errors.push(`${file.path}: ${e.message}`);
        }
    }));
    return { formatted, errors: errors.length > 0 ? errors : undefined };
}
