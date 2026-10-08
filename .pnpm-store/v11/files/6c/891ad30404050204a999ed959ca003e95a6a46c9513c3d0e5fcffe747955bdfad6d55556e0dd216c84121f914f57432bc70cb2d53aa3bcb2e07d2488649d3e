"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.afterAllProjectsVersioned = void 0;
const internal_1 = require("@nx/devkit/internal");
const devkit_1 = require("@nx/devkit");
const node_child_process_1 = require("node:child_process");
const node_path_1 = require("node:path");
const jsonc_parser_1 = require("jsonc-parser");
const semver_1 = require("semver");
const release_1 = require("nx/release");
const npm_config_1 = require("../utils/npm-config");
const update_lock_file_1 = require("./utils/update-lock-file");
const chalk = require("chalk");
const semver_2 = require("./utils/semver");
const afterAllProjectsVersioned = async (cwd, { rootVersionActionsOptions, ...opts }) => {
    return {
        changedFiles: await (0, update_lock_file_1.updateLockFile)(cwd, {
            ...opts,
            options: rootVersionActionsOptions,
        }),
        deletedFiles: [],
    };
};
exports.afterAllProjectsVersioned = afterAllProjectsVersioned;
// Cache at the module level to avoid re-detecting the package manager for each instance
let pm;
// Every project in a release receives the same ProjectGraph. Building these
// indexes once avoids turning dependency updates into quadratic graph scans.
const localDependencyProjectsByGraph = new WeakMap();
class JsVersionActions extends release_1.VersionActions {
    constructor() {
        super(...arguments);
        this.validManifestFilenames = ['package.json'];
        this.excludeManifestsFromFormatting = true;
    }
    async readCurrentVersionFromSourceManifest(tree) {
        const sourcePackageJsonPath = (0, node_path_1.join)(this.projectGraphNode.data.root, 'package.json');
        try {
            const packageJson = (0, devkit_1.readJson)(tree, sourcePackageJsonPath);
            return {
                manifestPath: sourcePackageJsonPath,
                currentVersion: packageJson.version,
            };
        }
        catch {
            throw new Error(`Unable to determine the current version for project "${this.projectGraphNode.name}" from ${sourcePackageJsonPath}, please ensure that the "version" field is set within the package.json file`);
        }
    }
    async readCurrentVersionFromRegistry(tree, currentVersionResolverMetadata) {
        const sourcePackageJsonPath = (0, node_path_1.join)(this.projectGraphNode.data.root, 'package.json');
        const packageJson = (0, devkit_1.readJson)(tree, sourcePackageJsonPath);
        const packageName = packageJson.name;
        const metadata = currentVersionResolverMetadata;
        const registryArg = typeof metadata?.registry === 'string' ? metadata.registry : undefined;
        const tagArg = typeof metadata?.tag === 'string' ? metadata.tag : undefined;
        const warnFn = (message) => {
            console.log(chalk.keyword('orange')(message));
        };
        const { registry, tag, registryConfigKey } = await (0, npm_config_1.parseRegistryOptions)(devkit_1.workspaceRoot, {
            packageRoot: this.projectGraphNode.data.root,
            packageJson,
        }, {
            registry: registryArg,
            tag: tagArg,
        }, warnFn);
        let currentVersion = null;
        try {
            // Must be non-blocking async to allow spinner to render
            currentVersion = await new Promise((resolve, reject) => {
                (0, node_child_process_1.exec)(`npm view ${packageName} version --"${registryConfigKey}=${registry}" --tag=${tag}`, {
                    windowsHide: true,
                }, (error, stdout, stderr) => {
                    if (error) {
                        return reject(error);
                    }
                    // Only reject on stderr if it contains actual errors, not just npm warnings
                    // npm 11+ writes "npm warn" messages to stderr even on successful commands
                    if (stderr &&
                        !stderr
                            .trim()
                            .split('\n')
                            .every((line) => line.startsWith('npm warn'))) {
                        return reject(stderr);
                    }
                    return resolve(stdout.trim());
                });
            });
        }
        catch { }
        return {
            currentVersion,
            // Make troubleshooting easier by including the registry and tag data in the log text
            logText: `"${registryConfigKey}=${registry}" tag=${tag}`,
        };
    }
    async readCurrentVersionOfDependency(tree, projectGraph, dependencyProjectName) {
        const sourcePackageJsonPath = (0, node_path_1.join)(this.projectGraphNode.data.root, 'package.json');
        const json = (0, devkit_1.readJson)(tree, sourcePackageJsonPath);
        const dependencyTypes = [
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'optionalDependencies',
        ];
        const dependencyPackageName = projectGraph.nodes[dependencyProjectName]?.data.metadata?.js?.packageName;
        let currentVersion = null;
        let dependencyCollection = null;
        if (dependencyPackageName) {
            for (const depType of dependencyTypes) {
                if (json[depType]?.[dependencyPackageName]) {
                    currentVersion = json[depType][dependencyPackageName];
                    dependencyCollection = depType;
                    break;
                }
            }
        }
        // Resolve catalog references if needed
        if (currentVersion && dependencyPackageName) {
            const catalogManager = (0, internal_1.getCatalogManager)(tree.root);
            if (catalogManager?.isCatalogReference(currentVersion)) {
                currentVersion = catalogManager.resolveCatalogReference(tree, dependencyPackageName, currentVersion);
            }
        }
        return {
            currentVersion,
            dependencyCollection,
        };
    }
    async updateProjectVersion(tree, newVersion) {
        const logMessages = [];
        for (const manifestToUpdate of this.manifestsToUpdate) {
            this.updateManifestValues(tree, manifestToUpdate.manifestPath, [
                { path: ['version'], value: newVersion },
            ]);
            logMessages.push(`✍️  New version ${newVersion} written to manifest: ${manifestToUpdate.manifestPath}`);
        }
        return logMessages;
    }
    async updateProjectDependencies(tree, projectGraph, dependenciesToUpdate, resolveVersionForDependency) {
        if (Object.keys(dependenciesToUpdate).length === 0 &&
            !resolveVersionForDependency) {
            return [];
        }
        const dependencyTypes = [
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'optionalDependencies',
        ];
        const localDependencyProjects = this.getLocalDependencyProjectLookup(projectGraph);
        for (const projectName of Object.keys(dependenciesToUpdate)) {
            if (!projectGraph.nodes[projectName]?.data.metadata?.js?.packageName) {
                throw new Error(`Unable to determine the package name for project "${projectName}" from the project graph metadata, please ensure that the "@nx/js" plugin is installed and the project graph has been built. If the issue persists, please report this issue on https://github.com/nrwl/nx/issues`);
            }
        }
        const resolvedVersions = new Map();
        const resolveVersion = (projectName) => {
            let resolution = resolvedVersions.get(projectName);
            if (!resolution) {
                if (!resolveVersionForDependency) {
                    throw new Error(`No version resolver was provided for dependency project "${projectName}".`);
                }
                resolution = resolveVersionForDependency(projectName);
                resolvedVersions.set(projectName, resolution);
            }
            return resolution;
        };
        const manifestUpdates = [];
        const catalogUpdates = [];
        const catalogManager = (0, internal_1.getCatalogManager)(tree.root);
        for (const manifestToUpdate of this.manifestsToUpdate) {
            const json = (0, devkit_1.readJson)(tree, manifestToUpdate.manifestPath);
            const updates = [];
            const preserveMatchingDependencyRanges = this.finalConfigForProject.preserveMatchingDependencyRanges === true
                ? dependencyTypes
                : this.finalConfigForProject.preserveMatchingDependencyRanges ===
                    false
                    ? []
                    : this.finalConfigForProject.preserveMatchingDependencyRanges ||
                        dependencyTypes;
            for (const depType of dependencyTypes) {
                if (json[depType]) {
                    for (const [dependencyName, currentVersion] of Object.entries(json[depType])) {
                        const targetProject = localDependencyProjects.get(dependencyName);
                        if (!targetProject) {
                            continue;
                        }
                        let version = dependenciesToUpdate[targetProject.projectName];
                        if (version !== undefined) {
                            if (catalogManager?.isCatalogReference(currentVersion)) {
                                // collect the catalog updates so we can update the catalog definitions later
                                const catalogRef = catalogManager.parseCatalogReference(currentVersion);
                                catalogUpdates.push({
                                    packageName: dependencyName,
                                    version,
                                    catalogName: catalogRef.catalogName,
                                });
                                continue;
                            }
                            if (manifestToUpdate.preserveLocalDependencyProtocols &&
                                this.isLocalDependencyProtocol(currentVersion)) {
                                continue;
                            }
                            if (this.isLocalDependencyProtocol(currentVersion)) {
                                version = this.applyVersionPrefix(currentVersion, version);
                            }
                            if (preserveMatchingDependencyRanges.includes(depType) &&
                                !this.isLocalDependencyProtocol(currentVersion)) {
                                // If the dependency is specified using a range, do some additional processing to determine whether to update the version
                                if ((0, semver_2.isValidRange)(currentVersion) &&
                                    !(0, semver_2.isMatchingDependencyRange)(version, currentVersion)) {
                                    throw new Error(`"preserveMatchingDependencyRanges" is enabled for "${depType}" and the new version "${version}" is outside the current range for "${dependencyName}" in manifest "${manifestToUpdate.manifestPath}". Please update the range before releasing.`);
                                }
                                else if ((0, semver_2.isValidRange)(currentVersion)) {
                                    continue;
                                }
                            }
                        }
                        else if (resolveVersionForDependency &&
                            !manifestToUpdate.preserveLocalDependencyProtocols &&
                            this.isLocalDependencyProtocol(currentVersion)) {
                            try {
                                version = await this.resolveLocalDependencySpecifier(dependencyName, currentVersion, targetProject, resolveVersion);
                            }
                            catch (error) {
                                const message = error instanceof Error ? error.message : String(error);
                                throw new Error(`Unable to replace local dependency protocol "${currentVersion}" for "${dependencyName}" in manifest "${manifestToUpdate.manifestPath}". ${message}`);
                            }
                        }
                        if (version !== undefined) {
                            updates.push({
                                path: [depType, dependencyName],
                                value: version,
                            });
                        }
                    }
                }
            }
            manifestUpdates.push({
                manifestPath: manifestToUpdate.manifestPath,
                updates,
            });
        }
        // Resolve every requested version before writing any manifest so one
        // failed resolver cannot leave a partially updated set of manifests.
        const logMessages = [];
        for (const manifestUpdate of manifestUpdates) {
            this.updateManifestValues(tree, manifestUpdate.manifestPath, manifestUpdate.updates);
            if (manifestUpdate.updates.length > 0) {
                const depText = manifestUpdate.updates.length === 1 ? 'dependency' : 'dependencies';
                logMessages.push(`✍️  Updated ${manifestUpdate.updates.length} ${depText} in manifest: ${manifestUpdate.manifestPath}`);
            }
        }
        // Update catalog definitions in the package manager's catalog file
        if (catalogUpdates.length > 0) {
            // catalogManager is guaranteed to be defined when there are catalog updates
            catalogManager.updateCatalogVersions(tree, catalogUpdates);
            const catalogText = catalogUpdates.length === 1 ? 'entry' : 'entries';
            logMessages.push(`✍️  Updated ${catalogUpdates.length} catalog ${catalogText} in ${catalogManager
                .getCatalogDefinitionFilePaths()
                .join(', ')}`);
        }
        return logMessages;
    }
    getLocalDependencyProjectLookup(projectGraph) {
        let lookup = localDependencyProjectsByGraph.get(projectGraph);
        if (lookup) {
            return lookup;
        }
        // This lookup requires the dependency key to match the package name.
        // Package aliases need relationship-specific manifest data that the
        // project graph does not retain. Support is tracked in
        // https://github.com/nrwl/nx/issues/36630.
        lookup = new Map();
        for (const [projectName, node] of Object.entries(projectGraph.nodes)) {
            const packageName = node.data.metadata?.js?.packageName;
            if (!packageName) {
                continue;
            }
            lookup.set(packageName, { projectName });
        }
        localDependencyProjectsByGraph.set(projectGraph, lookup);
        return lookup;
    }
    async resolveLocalDependencySpecifier(dependencyName, versionSpecifier, targetProject, resolveVersion) {
        if (versionSpecifier.startsWith('file:')) {
            const resolvedVersion = await resolveVersion(targetProject.projectName);
            return this.applyVersionPrefix(versionSpecifier, resolvedVersion);
        }
        const range = versionSpecifier.slice('workspace:'.length);
        if (range !== '' &&
            range !== '*' &&
            range !== '^' &&
            range !== '~' &&
            (0, semver_1.validRange)(range) !== null) {
            return range;
        }
        const isRelativePath = range.startsWith('.');
        if (!isRelativePath &&
            range !== '' &&
            range !== '*' &&
            range !== '^' &&
            range !== '~') {
            throw new Error(`The workspace protocol used by "${dependencyName}" is not a supported range or relative workspace path.`);
        }
        const resolvedVersion = await resolveVersion(targetProject.projectName);
        return this.applyVersionPrefix(isRelativePath ? 'workspace:*' : `workspace:${range}`, resolvedVersion);
    }
    applyVersionPrefix(versionSpecifier, resolvedVersion) {
        const configuredPrefix = this.finalConfigForProject.versionPrefix;
        let prefix = '';
        if (configuredPrefix === '~' ||
            configuredPrefix === '^' ||
            configuredPrefix === '=') {
            prefix = configuredPrefix;
        }
        else if (configuredPrefix === 'auto' &&
            versionSpecifier.startsWith('workspace:')) {
            const range = versionSpecifier.slice('workspace:'.length);
            if (range.startsWith('^')) {
                prefix = '^';
            }
            else if (range.startsWith('~')) {
                prefix = '~';
            }
        }
        return `${prefix}${resolvedVersion.replace(/^[~^=]/, '')}`;
    }
    updateManifestValues(tree, manifestPath, updates) {
        if (updates.length === 0) {
            return;
        }
        let content = this.readAndValidateManifest(tree, manifestPath);
        const formattingOptions = this.detectFormattingOptions(content);
        for (const update of updates) {
            content = (0, jsonc_parser_1.applyEdits)(content, (0, jsonc_parser_1.modify)(content, update.path, update.value, { formattingOptions }));
        }
        this.validateManifestUpdates(content, manifestPath, updates);
        tree.write(manifestPath, content);
    }
    readAndValidateManifest(tree, manifestPath) {
        const content = tree.read(manifestPath, 'utf-8');
        try {
            // Match readJson's support for comments and trailing commas while
            // retaining the original text for targeted edits.
            (0, devkit_1.parseJson)(content);
        }
        catch (error) {
            throw new Error(`Cannot parse ${manifestPath}: ${error.message}`);
        }
        return content;
    }
    validateManifestUpdates(content, manifestPath, updates) {
        const manifest = (0, devkit_1.parseJson)(content);
        for (const update of updates) {
            let actualValue = manifest;
            for (const pathSegment of update.path) {
                if (actualValue === null ||
                    typeof actualValue !== 'object' ||
                    !(pathSegment in actualValue)) {
                    actualValue = undefined;
                    break;
                }
                actualValue = actualValue[pathSegment];
            }
            if (actualValue !== update.value) {
                throw new Error(`Cannot update ${manifestPath}: "${update.path.join('.')}" resolves to ${JSON.stringify(actualValue)} instead of ${JSON.stringify(update.value)} after editing. The manifest may contain duplicate keys.`);
            }
        }
    }
    detectFormattingOptions(content) {
        const indentation = content.match(/^[\t ]+(?=")/m)?.[0] ?? '  ';
        const insertSpaces = !indentation.includes('\t');
        return {
            insertSpaces,
            tabSize: insertSpaces ? indentation.length : 1,
        };
    }
    // NOTE: The TODOs were carried over from the original implementation, they are not yet implemented
    isLocalDependencyProtocol(versionSpecifier) {
        const localPackageProtocols = [
            'file:', // all package managers
            'workspace:', // not npm
            // TODO: Support portal protocol at the project graph level before enabling here
            // 'portal:', // modern yarn only
        ];
        // Not using a supported local protocol
        if (!localPackageProtocols.some((protocol) => versionSpecifier.startsWith(protocol))) {
            return false;
        }
        // Supported by all package managers
        if (versionSpecifier.startsWith('file:')) {
            return true;
        }
        // Determine specific package manager in use
        if (!pm) {
            pm = (0, devkit_1.detectPackageManager)();
            // pmVersion = getPackageManagerVersion(pm);
        }
        if (pm === 'npm' && versionSpecifier.startsWith('workspace:')) {
            throw new Error(`The "workspace:" protocol is not yet supported by npm (https://github.com/npm/rfcs/issues/765). Please ensure you have a valid setup according to your package manager before attempting to release packages.`);
        }
        // TODO: Support portal protocol at the project graph level before enabling here
        // if (
        //   version.startsWith('portal:') &&
        //   (pm !== 'yarn' || lt(pmVersion, '2.0.0'))
        // ) {
        //   throw new Error(
        //     `The "portal:" protocol is only supported by yarn@2.0.0 and above. Please ensure you have a valid setup according to your package manager before attempting to release packages.`
        //   );
        // }
        return true;
    }
}
exports.default = JsVersionActions;
