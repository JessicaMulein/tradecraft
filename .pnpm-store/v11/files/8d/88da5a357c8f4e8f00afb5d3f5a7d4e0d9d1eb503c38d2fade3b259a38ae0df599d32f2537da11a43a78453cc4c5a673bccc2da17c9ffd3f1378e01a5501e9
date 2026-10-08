"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveNxPlugin = resolveNxPlugin;
exports.resolveLocalNxPlugin = resolveLocalNxPlugin;
exports.getPluginPathAndName = getPluginPathAndName;
exports.resetResolvePluginCache = resetResolvePluginCache;
const tslib_1 = require("tslib");
const path = tslib_1.__importStar(require("node:path"));
const node_fs_1 = require("node:fs");
const resolve_exports_1 = require("resolve.exports");
const packages_1 = require("../../plugins/js/utils/packages");
const typescript_1 = require("../../plugins/js/utils/typescript");
const fileutils_1 = require("../../utils/fileutils");
const logger_1 = require("../../utils/logger");
const path_1 = require("../../utils/path");
const workspace_root_1 = require("../../utils/workspace-root");
const find_project_for_path_1 = require("../utils/find-project-for-path");
const retrieve_workspace_files_1 = require("../utils/retrieve-workspace-files");
const TS_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.cts', '.mts']);
let projectsWithoutInference;
let projectsWithoutInferencePromise = null;
async function resolveNxPlugin(moduleName, root, paths) {
    // Default plugins (see `getDefaultPlugins` in `get-plugins.ts`) are passed
    // as absolute file paths to compiled bundles inside `nx` itself; they are
    // never workspace-local. Skip the project load entirely for them to avoid
    // recursing through `retrieveProjectConfigurationsWithoutPluginInference`,
    // which itself triggers default-plugin loading.
    if (!path.isAbsolute(moduleName)) {
        let resolvedFromNode;
        try {
            resolvedFromNode = require.resolve(moduleName, { paths });
        }
        catch { }
        // Load projects if Node couldn't resolve (so the local fallback can run)
        // OR if Node resolved to a workspace-internal path (a symlinked workspace
        // package whose source-first lookup should win over the symlinked dist).
        if (!resolvedFromNode ||
            isWorkspaceLocalResolution(resolvedFromNode, root)) {
            projectsWithoutInferencePromise ??=
                (0, retrieve_workspace_files_1.retrieveProjectConfigurationsWithoutPluginInference)(root);
            projectsWithoutInference ??= await projectsWithoutInferencePromise;
        }
    }
    const { pluginPath, name, shouldRegisterTSTranspiler } = getPluginPathAndName(moduleName, paths, projectsWithoutInference, root);
    return { pluginPath, name, shouldRegisterTSTranspiler };
}
/**
 * Distinguishes a symlinked workspace package (where `require.resolve`
 * follows the package-manager symlink into the workspace source tree) from
 * a truly-installed dependency under `node_modules/`. The former needs the
 * source-first lookup to bypass the dist that Node would otherwise return.
 */
function isWorkspaceLocalResolution(resolvedPath, root) {
    const normalizedRoot = path.normalize(root);
    const normalizedPath = path.normalize(resolvedPath);
    return (normalizedPath.startsWith(normalizedRoot + path.sep) &&
        !normalizedPath.includes(path.sep + 'node_modules' + path.sep));
}
function isPackageResolutionError(e) {
    const code = e.code;
    return (code === 'MODULE_NOT_FOUND' || code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
}
function readPluginMainFromProjectConfiguration(plugin) {
    const { main } = Object.values(plugin.targets).find((x) => [
        '@nx/js:tsc',
        '@nrwl/js:tsc',
        '@nx/js:swc',
        '@nrwl/js:swc',
        '@nx/node:package',
        '@nrwl/node:package',
    ].includes(x.executor))?.options ||
        plugin.targets?.build?.options ||
        {};
    return main;
}
function resolveLocalNxPlugin(importPath, projects, root = workspace_root_1.workspaceRoot) {
    return lookupLocalPlugin(importPath, projects, root);
}
function getPluginPathAndName(moduleName, paths, projects, root) {
    let pluginPath;
    // Resolve local workspace plugins from source first so the workspace's
    // `customConditions`/`development` exports condition wins over the built
    // `dist` artifact that Node's resolver would otherwise pick up via the
    // `default` condition (Node ignores TypeScript custom conditions). Skipped
    // when `projects` weren't loaded — the caller already determined that the
    // import isn't a workspace package.
    const localPlugin = projects
        ? resolveLocalNxPlugin(moduleName, projects, root)
        : null;
    if (localPlugin) {
        pluginPath = tryResolveLocalPluginFromSource(moduleName, localPlugin, root);
        if (!pluginPath && getSubpathOfLocalPackage(moduleName, localPlugin)) {
            throwUnresolvableLocalPluginError(moduleName, localPlugin, root);
        }
    }
    if (!pluginPath) {
        try {
            pluginPath = require.resolve(moduleName, { paths });
        }
        catch (e) {
            if (localPlugin && isPackageResolutionError(e)) {
                throwUnresolvableLocalPluginError(moduleName, localPlugin, root);
            }
            if (e.code !== 'MODULE_NOT_FOUND') {
                throw e;
            }
            if (localPlugin) {
                throwUnresolvableLocalPluginError(moduleName, localPlugin, root);
            }
            logger_1.logger.error(`Plugin listed in \`nx.json\` not found: ${moduleName}`);
            throw e;
        }
    }
    const ext = path.extname(pluginPath);
    // Directory paths fall through to Node's `package.json` `main` resolution
    // which may land on a TS file; only opt out of TS transpiler registration
    // when the resolved path is unambiguously JS.
    const shouldRegisterTSTranspiler = ext === '' || TS_SOURCE_EXTENSIONS.has(ext);
    const packageJsonPath = path.join(pluginPath, 'package.json');
    const { name } = !['.ts', '.js'].some((x) => path.extname(moduleName) === x) && // Not trying to point to a ts or js file
        (0, node_fs_1.existsSync)(packageJsonPath) // plugin has a package.json
        ? (0, fileutils_1.readJsonFile)(packageJsonPath) // read name from package.json
        : { name: moduleName };
    return { pluginPath, name, shouldRegisterTSTranspiler };
}
function getSubpathOfLocalPackage(moduleName, plugin) {
    const packageName = plugin.projectConfig.metadata?.js?.packageName;
    if (!packageName || !moduleName.startsWith(packageName + '/')) {
        return null;
    }
    return '.' + moduleName.slice(packageName.length);
}
function tryResolveLocalPluginFromSource(moduleName, plugin, root) {
    if (plugin.resolvedFile) {
        return plugin.resolvedFile;
    }
    const subpath = getSubpathOfLocalPackage(moduleName, plugin);
    if (subpath) {
        return resolveSubpathFromExports(plugin.projectConfig, plugin.path, subpath, root);
    }
    const main = readPluginMainFromProjectConfiguration(plugin.projectConfig);
    return main ? path.join(root, main) : null;
}
function throwUnresolvableLocalPluginError(moduleName, plugin, root) {
    const subpath = getSubpathOfLocalPackage(moduleName, plugin);
    const packageName = plugin.projectConfig.metadata?.js?.packageName;
    if (subpath) {
        throw new Error(`Unable to resolve local plugin "${moduleName}". The import targets ` +
            `the subpath "${subpath}" of the local package "${packageName}", but ` +
            `the package's "exports" map has no resolvable entry for "${subpath}", ` +
            `or none of the matched paths exist on disk. Check the "exports" field ` +
            `in "${path.relative(root, path.join(plugin.path, 'package.json'))}" ` +
            `and ensure the source file referenced by "${subpath}" exists.`);
    }
    throw new Error(`Unable to resolve local plugin "${moduleName}". The local package ` +
        `"${packageName ?? moduleName}" does not declare a build target with ` +
        `a "main" source path, and Node could not resolve it either.`);
}
function resolveSubpathFromExports(projectConfig, projectPath, subpath, root) {
    const packageExports = projectConfig.metadata?.js?.packageExports;
    if (!packageExports) {
        return null;
    }
    const pkg = {
        name: projectConfig.metadata.js.packageName,
        exports: packageExports,
    };
    try {
        const matches = (0, resolve_exports_1.resolve)(pkg, subpath, {
            conditions: (0, typescript_1.getRootTsConfigResolveExportsConditions)(root),
        });
        if (!matches || !matches.length) {
            return null;
        }
        for (const match of matches) {
            const candidate = path.join(projectPath, match);
            if ((0, node_fs_1.existsSync)(candidate)) {
                return candidate;
            }
        }
    }
    catch (e) {
        logger_1.logger.verbose(`Failed to resolve subpath "${subpath}" of local plugin via package.json exports`, e);
    }
    return null;
}
function lookupLocalPlugin(importPath, projects, root = workspace_root_1.workspaceRoot) {
    const match = findNxProjectForImportPath(importPath, projects, root);
    if (!match) {
        return null;
    }
    let resolvedFile;
    if (match.tsPathFile) {
        const candidate = path.join(root, match.tsPathFile);
        if (path.extname(candidate) && (0, node_fs_1.existsSync)(candidate)) {
            resolvedFile = candidate;
        }
    }
    return {
        path: path.join(root, match.projectConfig.root),
        projectConfig: match.projectConfig,
        resolvedFile,
    };
}
let packageEntryPointsToProjectMap;
let wildcardEntryPointsToProjectMap;
function findNxProjectForImportPath(importPath, projects, root = workspace_root_1.workspaceRoot) {
    const tsConfigPaths = readTsConfigPaths(root);
    const possibleTsPaths = tsConfigPaths[importPath]?.map((p) => (0, path_1.normalizePath)(path.relative(root, path.join(root, p)))) ?? [];
    const projectRootMappings = new Map();
    if (possibleTsPaths.length) {
        const projectNameMap = new Map();
        for (const projectRoot in projects) {
            const project = projects[projectRoot];
            projectRootMappings.set(project.root, project.name);
            projectNameMap.set(project.name, project);
        }
        for (const tsConfigPath of possibleTsPaths) {
            const nxProject = (0, find_project_for_path_1.findProjectForPath)(tsConfigPath, projectRootMappings);
            if (nxProject) {
                return {
                    projectConfig: projectNameMap.get(nxProject),
                    tsPathFile: tsConfigPath,
                };
            }
        }
    }
    if (!packageEntryPointsToProjectMap && !wildcardEntryPointsToProjectMap) {
        ({
            entryPointsToProjectMap: packageEntryPointsToProjectMap,
            wildcardEntryPointsToProjectMap,
        } = (0, packages_1.getWorkspacePackagesMetadata)(projects));
    }
    if (packageEntryPointsToProjectMap[importPath]) {
        return { projectConfig: packageEntryPointsToProjectMap[importPath] };
    }
    const project = (0, packages_1.matchImportToWildcardEntryPointsToProjectMap)(wildcardEntryPointsToProjectMap, importPath);
    if (project) {
        return { projectConfig: project };
    }
    logger_1.logger.verbose('Unable to find local plugin', possibleTsPaths, projectRootMappings);
    return null;
}
let tsconfigPaths;
function readTsConfigPaths(root = workspace_root_1.workspaceRoot) {
    if (!tsconfigPaths) {
        const tsconfigPath = ['tsconfig.base.json', 'tsconfig.json']
            .map((x) => path.join(root, x))
            .filter((x) => (0, node_fs_1.existsSync)(x))[0];
        if (!tsconfigPath) {
            // Workspaces that wire up packages purely through package-manager
            // workspaces + package.json exports have no root tsconfig — they simply
            // have no tsconfig path mappings. Local plugin lookup must fall through
            // to the package-metadata matching in `findNxProjectForImportPath`
            // instead of failing the whole plugin load.
            tsconfigPaths = {};
            return tsconfigPaths;
        }
        const { compilerOptions } = (0, fileutils_1.readJsonFile)(tsconfigPath);
        tsconfigPaths = compilerOptions?.paths;
    }
    return tsconfigPaths ?? {};
}
/**
 * Drops the cached workspace-layout snapshot local-plugin resolution relies on
 * (project configs, tsconfig paths, package entry points). Kept for the life
 * of the process, it goes stale when a new local plugin is added — the plugin
 * then resolves to the workspace root (a directory) and fails to import.
 */
function resetResolvePluginCache() {
    projectsWithoutInference = undefined;
    projectsWithoutInferencePromise = null;
    packageEntryPointsToProjectMap = undefined;
    wildcardEntryPointsToProjectMap = undefined;
    tsconfigPaths = undefined;
    (0, retrieve_workspace_files_1.clearProjectsWithoutPluginInferenceCache)();
}
