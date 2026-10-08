"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImplementationResolutionError = exports.SchemaResolutionError = void 0;
exports.getImplementationFactory = getImplementationFactory;
exports.resolveImplementation = resolveImplementation;
exports.resolveSchema = resolveSchema;
const fs_1 = require("fs");
const path_1 = require("path");
const resolve_exports_1 = require("resolve.exports");
const register_1 = require("../plugins/js/utils/register");
const packages_1 = require("../plugins/js/utils/packages");
const typescript_1 = require("../plugins/js/utils/typescript");
const find_project_for_path_1 = require("../project-graph/utils/find-project-for-path");
const fileutils_1 = require("../utils/fileutils");
const package_json_1 = require("../utils/package-json");
const path_2 = require("../utils/path");
const workspace_root_1 = require("../utils/workspace-root");
/**
 * Thrown when the schema file of an executor or generator cannot be resolved.
 */
class SchemaResolutionError extends Error {
    constructor(schemaPath, directory, options) {
        super(`Could not resolve schema "${schemaPath}" from "${directory}".`, options);
        this.schemaPath = schemaPath;
        this.directory = directory;
        this.name = 'SchemaResolutionError';
    }
}
exports.SchemaResolutionError = SchemaResolutionError;
/**
 * Thrown when the implementation module of an executor or generator cannot be
 * resolved.
 */
class ImplementationResolutionError extends Error {
    constructor(implementationModulePath, directory, options) {
        super(`Could not resolve "${implementationModulePath}" from "${directory}".`, options);
        this.implementationModulePath = implementationModulePath;
        this.directory = directory;
        this.name = 'ImplementationResolutionError';
    }
}
exports.ImplementationResolutionError = ImplementationResolutionError;
/**
 * This function is used to get the implementation factory of an executor or generator.
 * @param implementation path to the implementation
 * @param directory path to the directory
 * @returns a function that returns the implementation
 */
function getImplementationFactory(implementation, directory, packageName, projects) {
    const [implementationModulePath, implementationExportName] = implementation.split('#');
    return () => {
        const modulePath = resolveImplementation(implementationModulePath, directory, packageName, projects);
        // Route .ts entrypoints through loadTsFile so the native-strip ->
        // swc/ts-node fallback chain runs. Plain require() bypasses the matcher
        // set and bubbles errors like extensionless `./schema` imports (strict
        // ESM resolution failures) straight to the CLI. JS entrypoints use
        // requireWithTsconfigFallback so workspace-alias imports still resolve.
        const module = /\.[cm]?ts$/.test(modulePath)
            ? (0, register_1.loadTsFile)(modulePath)
            : (0, register_1.requireWithTsconfigFallback)(modulePath);
        return implementationExportName
            ? module[implementationExportName]
            : (module.default ?? module);
    };
}
/**
 * This function is used to resolve the implementation of an executor or generator.
 * @param implementationModulePath
 * @param directory
 * @returns path to the implementation
 */
function resolveImplementation(implementationModulePath, directory, packageName, projects) {
    const validImplementations = ['', '.js', '.ts'].map((x) => implementationModulePath + x);
    if (!directory.includes('node_modules')) {
        // It might be a local plugin where the implementation path points to the
        // outputs which might not exist or can be stale. We prioritize finding
        // the implementation from the source over the outputs.
        for (const maybeImplementation of validImplementations) {
            const maybeImplementationFromSource = tryResolveFromSource(maybeImplementation, directory, packageName, projects);
            if (maybeImplementationFromSource) {
                return maybeImplementationFromSource;
            }
        }
    }
    for (const maybeImplementation of validImplementations) {
        const maybeImplementationPath = (0, path_1.join)(directory, maybeImplementation);
        if ((0, fs_1.existsSync)(maybeImplementationPath)) {
            return maybeImplementationPath;
        }
        try {
            return require.resolve(maybeImplementation, {
                paths: [directory],
            });
        }
        catch { }
    }
    throw new ImplementationResolutionError(implementationModulePath, directory);
}
function resolveSchema(schemaPath, directory, packageName, projects) {
    if (!directory.includes('node_modules')) {
        // It might be a local plugin where the schema path points to the outputs
        // which might not exist or can be stale. We prioritize finding the schema
        // from the source over the outputs.
        const schemaPathFromSource = tryResolveFromSource(schemaPath, directory, packageName, projects);
        if (schemaPathFromSource) {
            return schemaPathFromSource;
        }
    }
    const maybeSchemaPath = (0, path_1.join)(directory, schemaPath);
    if ((0, fs_1.existsSync)(maybeSchemaPath)) {
        return maybeSchemaPath;
    }
    try {
        return require.resolve(schemaPath, {
            paths: [directory],
        });
    }
    catch (e) {
        throw new SchemaResolutionError(schemaPath, directory, { cause: e });
    }
}
let projectRootMappings;
function getProjectForDirectory(directory, projects) {
    projectRootMappings ??=
        (0, find_project_for_path_1.createProjectRootMappingsFromProjectConfigurations)(projects);
    const projectName = (0, find_project_for_path_1.findProjectForPath)((0, path_1.relative)(workspace_root_1.workspaceRoot, directory), projectRootMappings);
    return projectName ? projects[projectName] : null;
}
/**
 * Reads the JS package metadata (package name and exports) for a project
 * directly from its `package.json`. Used as a fallback when a project's graph
 * metadata doesn't include the JS metadata.
 */
function readJsPackageMetadata(project) {
    const packageJsonPath = (0, path_1.join)(workspace_root_1.workspaceRoot, project.root, 'package.json');
    if (!(0, fs_1.existsSync)(packageJsonPath)) {
        return null;
    }
    try {
        const packageJson = (0, fileutils_1.readJsonFile)(packageJsonPath);
        return (0, package_json_1.getMetadataFromPackageJson)(packageJson, false).js;
    }
    catch {
        return null;
    }
}
let packageMetadata;
function tryResolveFromSource(path, directory, packageName, projects) {
    packageMetadata ??= (0, packages_1.getWorkspacePackagesMetadata)(projects);
    let localProject = packageMetadata.packageToProjectMap[packageName];
    // The `packageName` might be a path to the collection rather than an actual
    // package name (e.g. when a generator/executor collection is referenced by
    // path). In that case, `directory` points inside the local project, so we
    // find the project that contains it.
    localProject ??= getProjectForDirectory(directory, projects);
    if (!localProject) {
        return null;
    }
    const js = localProject.metadata?.js ??
        readJsPackageMetadata(localProject);
    if (!js) {
        return null;
    }
    const name = js.packageName;
    const exports = js.packageExports;
    try {
        const fromExports = (0, resolve_exports_1.resolve)({ name, exports }, path, {
            conditions: (0, typescript_1.getRootTsConfigResolveExportsConditions)(),
        });
        if (fromExports && fromExports.length) {
            for (const exportPath of fromExports) {
                if ((0, fs_1.existsSync)((0, path_1.join)(directory, exportPath))) {
                    return (0, path_1.join)(directory, exportPath);
                }
            }
        }
    }
    catch { }
    /**
     * Fall back to try to "guess" the source by checking the path in some common directories:
     * - the root of the project
     * - the src directory
     * - the src/lib directory
     */
    const segments = (0, path_2.normalizePath)(path).replace(/^\.\//, '').split('/');
    for (let i = 1; i < segments.length; i++) {
        const possiblePaths = [
            (0, path_1.join)(directory, ...segments.slice(i)),
            (0, path_1.join)(directory, 'src', ...segments.slice(i)),
            (0, path_1.join)(directory, 'src', 'lib', ...segments.slice(i)),
        ];
        for (const possiblePath of possiblePaths) {
            if ((0, fs_1.existsSync)(possiblePath)) {
                return possiblePath;
            }
        }
    }
    return null;
}
