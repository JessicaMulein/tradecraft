"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTsConfig = readTsConfig;
exports.readTsConfigFromTree = readTsConfigFromTree;
exports.createTreeParseConfigHost = createTreeParseConfigHost;
exports.extendsResolutionFailed = extendsResolutionFailed;
exports.getRootTsConfigPathInTree = getRootTsConfigPathInTree;
exports.getRelativePathToRootTsConfig = getRelativePathToRootTsConfig;
exports.getRootTsConfigPath = getRootTsConfigPath;
exports.getRootTsConfigFileName = getRootTsConfigFileName;
exports.addTsConfigPath = addTsConfigPath;
exports.resolvePathsBaseUrl = resolvePathsBaseUrl;
exports.readTsConfigPaths = readTsConfigPaths;
const devkit_1 = require("@nx/devkit");
const fs_1 = require("fs");
const path_1 = require("path");
const ensure_typescript_1 = require("./ensure-typescript");
let tsModule;
function readTsConfig(tsConfigPath, sys) {
    if (!tsModule) {
        tsModule = require('typescript');
    }
    // A tree-backed `sys` (readTsConfigFromTree) reads via `FsTree.read`, which
    // re-roots an absolute path and breaks, so only absolutize the default sys.
    const usingDefaultSys = !sys || sys === tsModule.sys;
    sys ??= tsModule.sys;
    // Resolve to absolute so `${configDir}` in `paths` expands to absolute
    // values. A relative basePath produces the TS5090 "no baseUrl" error.
    //
    // Don't also pass `configPath` as `configFileName` (5th arg). It doesn't
    // affect `${configDir}`, only shifts emit output paths (dist/src vs dist).
    const configPath = usingDefaultSys ? (0, path_1.resolve)(tsConfigPath) : tsConfigPath;
    const readResult = tsModule.readConfigFile(configPath, sys.readFile);
    return tsModule.parseJsonConfigFileContent(readResult.config, sys, (0, path_1.dirname)(configPath));
}
function readTsConfigFromTree(tree, tsConfigPath) {
    if (!tsModule) {
        tsModule = (0, ensure_typescript_1.ensureTypescript)();
    }
    const tsSysFromTree = {
        ...tsModule.sys,
        readFile: (path) => tree.read(path, 'utf-8'),
    };
    return readTsConfig(tsConfigPath, tsSysFromTree);
}
/**
 * A TypeScript host, backed by the devkit `Tree`, that resolves `extends` the
 * way real `tsc` does. The naive `{ ...ts.sys, readFile: (p) => tree.read(p) }`
 * host resolves less than `tsc`:
 *  - A package-form `extends` (e.g. `@tsconfig/node14/tsconfig.json`) is
 *    realpath-absolutized by TypeScript; `Tree.read`/`Tree.exists` re-root an
 *    absolute path under the workspace, so the base reads as nothing and its
 *    options silently vanish from the merged result (the failure surfaces only
 *    as a TS5083/TS6053 in `errors`, which callers discard).
 *  - An extension-less `extends` resolves against `process.cwd()` when
 *    existence comes from `ts.sys`; Nx never chdirs to the workspace root, so it
 *    resolves only when the command runs from the root.
 *
 * This host maps absolute paths under `tree.root` back to tree-relative for the
 * tree lookups and falls through to `fs` for paths that resolve outside the
 * workspace (a pnpm store or a `link:`/`file:` target). Resolution is anchored
 * to `tree.root` rather than the working directory: TypeScript resolves a
 * package-form base as a relative path and hands it to `realpath`, and
 * `ts.sys.realpath` would resolve it against `process.cwd()`, so a workspace
 * whose root is not an ancestor of the working directory would read a
 * same-named package from the wrong tree.
 *
 * `readDirectory` is a no-op: the source-file scan is skipped because callers
 * read only the merged `options`, never the file list. A config that resolves
 * its inputs through `include` (or the default glob) then reports a TS18003
 * unless it also carries `files` or `references`, so `errors.length > 0` is not
 * a usable signal; match specific codes (TS5083/TS6053) instead.
 */
function createTreeParseConfigHost(tree) {
    if (!tsModule) {
        tsModule = (0, ensure_typescript_1.ensureTypescript)();
    }
    // Classify with `relative` rather than a string prefix: it normalizes
    // separators, so an absolute path TypeScript hands over with forward slashes
    // still matches a `tree.root` carrying platform separators, and it respects
    // the segment boundary, so a sibling of the root (`/repo/core-utils` for
    // `/repo/core`) is not taken for a path inside it.
    const isOutsideRoot = (path) => {
        if (!(0, path_1.isAbsolute)(path)) {
            return false;
        }
        const rel = (0, path_1.relative)(tree.root, path);
        return rel === '..' || rel.startsWith(`..${path_1.sep}`) || (0, path_1.isAbsolute)(rel);
    };
    const toTreePath = (path) => (0, path_1.isAbsolute)(path) ? (0, path_1.relative)(tree.root, path) || '.' : path;
    // `ts.sys` gates `readFile`/`fileExists` on `isFile`, so a directory is never
    // read as a config file. Both branches mirror that, which lets an
    // extension-less `extends` ("./config") that collides with a same-named
    // directory fall through to its `.json` sibling. Out-of-root, a bare
    // `existsSync` answers true for a directory and `readFileSync` on it throws
    // EISDIR (TS5012, which the extends-failure guard does not catch); in-root,
    // `tree.exists` also answers true for a directory, so `fileExists` gates on
    // `tree.isFile`.
    const isFileOnDisk = (path) => {
        try {
            return (0, fs_1.statSync)(path).isFile();
        }
        catch {
            return false;
        }
    };
    const isDirectoryOnDisk = (path) => {
        try {
            return (0, fs_1.statSync)(path).isDirectory();
        }
        catch {
            return false;
        }
    };
    return {
        ...tsModule.sys,
        readDirectory: () => [],
        getCurrentDirectory: () => tree.root,
        // A relative path anchored to the workspace instead of `process.cwd()`; an
        // absolute one still goes through `ts.sys` so a symlinked in-root
        // `node_modules` entry resolves to its real (out-of-root) target.
        realpath: (path) => tsModule.sys.realpath((0, path_1.isAbsolute)(path) ? path : (0, path_1.join)(tree.root, path)),
        readFile: (path) => isOutsideRoot(path)
            ? isFileOnDisk(path)
                ? (0, fs_1.readFileSync)(path, 'utf-8')
                : undefined
            : (tree.read(toTreePath(path), 'utf-8') ?? undefined),
        fileExists: (path) => {
            if (isOutsideRoot(path)) {
                return isFileOnDisk(path);
            }
            const treePath = toTreePath(path);
            return tree.exists(treePath) && tree.isFile(treePath);
        },
        directoryExists: (path) => {
            if (isOutsideRoot(path)) {
                return isDirectoryOnDisk(path);
            }
            const treePath = toTreePath(path);
            return tree.exists(treePath) && !tree.isFile(treePath);
        },
    };
}
/**
 * Whether a `ParsedCommandLine` produced with `createTreeParseConfigHost` failed
 * to resolve an `extends` target: TS5083 (the base resolved but could not be
 * read) or TS6053 (the base could not be resolved at all). Because the host
 * resolves what real `tsc` resolves, this only fires for a config whose extends
 * chain `tsc` cannot read either. The no-op `readDirectory` also adds a TS18003
 * whenever the config resolves inputs through `include` and carries neither
 * `files` nor `references`, so `errors.length > 0` is not a usable signal; match
 * these two codes.
 */
function extendsResolutionFailed(errors) {
    // 5083: Cannot read file '{0}'. 6053: File '{0}' not found.
    return errors.some((error) => error.code === 5083 || error.code === 6053);
}
function getRootTsConfigPathInTree(tree) {
    for (const path of ['tsconfig.base.json', 'tsconfig.json']) {
        if (tree.exists(path)) {
            return path;
        }
    }
    return 'tsconfig.base.json';
}
function getRelativePathToRootTsConfig(tree, targetPath) {
    return (0, devkit_1.offsetFromRoot)(targetPath) + getRootTsConfigPathInTree(tree);
}
function getRootTsConfigPath() {
    const tsConfigFileName = getRootTsConfigFileName();
    return tsConfigFileName ? (0, path_1.join)(devkit_1.workspaceRoot, tsConfigFileName) : null;
}
function getRootTsConfigFileName(tree) {
    for (const tsConfigName of ['tsconfig.base.json', 'tsconfig.json']) {
        const pathExists = tree
            ? tree.exists(tsConfigName)
            : (0, fs_1.existsSync)((0, path_1.join)(devkit_1.workspaceRoot, tsConfigName));
        if (pathExists) {
            return tsConfigName;
        }
    }
    return null;
}
function addTsConfigPath(tree, importPath, lookupPaths) {
    (0, devkit_1.updateJson)(tree, getRootTsConfigPathInTree(tree), (json) => {
        json.compilerOptions ??= {};
        const c = json.compilerOptions;
        c.paths ??= {};
        if (c.paths[importPath]) {
            throw new Error(`You already have a library using the import path "${importPath}". Make sure to specify a unique one.`);
        }
        c.paths[importPath] = lookupPaths.map(ensureRelativePath);
        return json;
    });
}
function ensureRelativePath(p) {
    if (p.startsWith('./') || p.startsWith('../') || p.startsWith('/')) {
        return p;
    }
    return `./${p}`;
}
/**
 * When `baseUrl` is not set and `paths` are inherited via `extends`,
 * tools like `tsconfig-paths` resolve from the loaded file's directory
 * instead of the file where `paths` is defined. This walks the `extends`
 * chain to find the correct resolution base.
 *
 * Returns the directory that `paths` values should be resolved relative to.
 * Walks the tsconfig `extends` chain to find where `paths` is defined, then
 * looks for the applicable `baseUrl` from that point toward the root of the
 * chain (ignoring child overrides that don't apply to the paths-defining
 * tsconfig). When no `baseUrl` applies, returns the directory of the
 * tsconfig that defines `paths`.
 */
function resolvePathsBaseUrl(tsconfigPath) {
    const chain = [];
    const queue = [tsconfigPath];
    while (queue.length > 0) {
        const absolute = (0, path_1.resolve)(queue.shift());
        const dir = (0, path_1.dirname)(absolute);
        try {
            const raw = (0, devkit_1.readJsonFile)(absolute);
            chain.push({ dir, raw });
            const exts = raw.extends
                ? Array.isArray(raw.extends)
                    ? raw.extends
                    : [raw.extends]
                : [];
            for (const ext of exts) {
                const resolved = resolveExtendsPath(ext, dir);
                if (resolved) {
                    queue.push(resolved);
                }
            }
        }
        catch {
            // skip unreadable files
        }
    }
    // Find where paths is defined.
    let pathsIndex = -1;
    for (let i = 0; i < chain.length; i++) {
        if (chain[i].raw.compilerOptions?.paths &&
            Object.keys(chain[i].raw.compilerOptions.paths).length > 0) {
            pathsIndex = i;
            break;
        }
    }
    // Find the applicable baseUrl: search from the paths-defining tsconfig
    // toward the root. Child overrides before the paths-defining tsconfig
    // are ignored — they don't apply to the paths that were written for a
    // different baseUrl context.
    const searchStart = pathsIndex >= 0 ? pathsIndex : 0;
    for (let i = searchStart; i < chain.length; i++) {
        if (chain[i].raw.compilerOptions?.baseUrl) {
            return (0, path_1.resolve)(chain[i].dir, chain[i].raw.compilerOptions.baseUrl);
        }
    }
    return pathsIndex >= 0
        ? chain[pathsIndex].dir
        : (0, path_1.dirname)((0, path_1.resolve)(tsconfigPath));
}
/**
 * Resolves a tsconfig `extends` entry to an absolute path.
 * Handles relative paths, absolute paths, and package names
 * (e.g., `@tsconfig/node20/tsconfig.json` or `@tsconfig/strictest`).
 * Mirrors TypeScript's resolution: relative/absolute paths are resolved
 * directly (with `.json` fallback), package names use `require.resolve`
 * with a `tsconfig.json` fallback for bare package names.
 */
function resolveExtendsPath(ext, fromDir) {
    if (ext.startsWith('.') || (0, path_1.isAbsolute)(ext)) {
        let resolved = (0, path_1.resolve)(fromDir, ext);
        if ((0, fs_1.existsSync)(resolved))
            return resolved;
        if (!resolved.endsWith('.json')) {
            resolved += '.json';
            if ((0, fs_1.existsSync)(resolved))
                return resolved;
        }
        return null;
    }
    // Package name — try as-is, then with /tsconfig.json appended
    try {
        return require.resolve(ext, { paths: [fromDir] });
    }
    catch {
        try {
            return require.resolve(`${ext}/tsconfig.json`, { paths: [fromDir] });
        }
        catch {
            return null;
        }
    }
}
function readTsConfigPaths(tsConfig) {
    tsConfig ??= getRootTsConfigPath();
    try {
        let config;
        if (typeof tsConfig === 'string') {
            if (!tsModule) {
                tsModule = (0, ensure_typescript_1.ensureTypescript)();
            }
            const configFile = tsModule.readConfigFile(tsConfig, tsModule.sys.readFile);
            // Stub `readDirectory` to skip the source-file scan — only `paths` is consumed.
            const parseConfigHost = {
                ...tsModule.sys,
                readDirectory: () => [],
            };
            config = tsModule.parseJsonConfigFileContent(configFile.config, parseConfigHost, (0, path_1.dirname)(tsConfig));
        }
        else {
            config = tsConfig;
        }
        return config.options?.paths ?? null;
    }
    catch (e) {
        return null;
    }
}
