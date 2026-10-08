"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = pruneLockfileExecutor;
exports.resolveCatalogReferences = resolveCatalogReferences;
const devkit_1 = require("@nx/devkit");
const fs_1 = require("fs");
const path_1 = require("path");
const internal_1 = require("@nx/devkit/internal");
const strip_glob_to_base_dir_1 = require("../../utils/strip-glob-to-base-dir");
const workspace_module_sections_1 = require("../../utils/workspace-module-sections");
async function pruneLockfileExecutor(schema, context) {
    devkit_1.logger.log('Pruning lockfile...');
    const outputDirectory = getOutputDir(schema, context);
    const packageJson = resolveCatalogReferences(getPackageJson(schema, context));
    mergeAllowScripts(packageJson);
    const packageManager = (0, devkit_1.detectPackageManager)(devkit_1.workspaceRoot);
    const { project } = (0, devkit_1.parseTargetString)(schema.buildTarget, context);
    const projectRoot = context.projectGraph.nodes[project].data.root;
    (0, internal_1.generatePrunedDeployOutput)(packageJson, context.projectGraph, projectRoot, {
        outputDirectory,
        packageManager,
        workspaceRoot: devkit_1.workspaceRoot,
    });
    rewriteWorkspaceModuleSpecifiers(packageJson, context.projectGraph);
    (0, fs_1.writeFileSync)((0, path_1.join)(outputDirectory, 'package.json'), JSON.stringify(packageJson, null, 2));
    devkit_1.logger.log(`Pruned deploy output written to ${outputDirectory}`);
    return {
        success: true,
    };
}
// Point every workspace-module dependency at its copied directory so the
// standalone output installs them as pnpm `file:` directory dependencies.
// pnpm rejects a `file:` spec under peerDependencies, so a peer-declared
// workspace module is moved into dependencies instead (an optional peer
// becomes required, which is moot since the module is always copied in). Gate
// strictly on graph membership: a `file:`/`link:` spec to a non-workspace
// local path (e.g. a vendored tarball) is left alone, since
// copy-workspace-modules only ever copies actual workspace projects.
function rewriteWorkspaceModuleSpecifiers(packageJson, graph) {
    const workspacePackages = (0, internal_1.getWorkspacePackagesFromGraph)(graph);
    for (const section of workspace_module_sections_1.WORKSPACE_MODULE_INSTALL_SECTIONS) {
        const deps = packageJson[section];
        if (!deps) {
            continue;
        }
        for (const pkgName of Object.keys(deps)) {
            if (!workspacePackages.has(pkgName)) {
                continue;
            }
            const fileSpec = `file:./workspace_modules/${pkgName}`;
            if (section === 'peerDependencies') {
                (0, internal_1.movePeerDependencyToDependencies)(packageJson, pkgName, fileSpec);
            }
            else {
                deps[pkgName] = fileSpec;
            }
        }
    }
    (0, internal_1.dropEmptyPeerDependencySections)(packageJson);
}
/**
 * npm reads the `allowScripts` install-script allowlist only from the install
 * root, but `npm approve-scripts` writes it to the workspace root, so it never
 * lives in the project package.json the prune output is built from. Carry the
 * root allowlist over, with project-level entries preserved and winning on
 * conflict. Mirrors the `pnpm.allowBuilds` handling in createPackageJson.
 */
function mergeAllowScripts(packageJson) {
    const rootPackageJson = (0, devkit_1.readJsonFile)((0, path_1.join)(devkit_1.workspaceRoot, 'package.json'));
    if (!rootPackageJson.allowScripts) {
        return;
    }
    packageJson.allowScripts = {
        ...rootPackageJson.allowScripts,
        ...packageJson.allowScripts,
    };
}
function resolveCatalogReferences(packageJson) {
    const manager = (0, internal_1.getCatalogManager)(devkit_1.workspaceRoot);
    if (!manager) {
        return packageJson;
    }
    const sections = [
        'dependencies',
        'optionalDependencies',
        'devDependencies',
        'peerDependencies',
    ];
    const resolved = { ...packageJson };
    for (const section of sections) {
        const deps = packageJson[section];
        if (!deps) {
            continue;
        }
        const resolvedDeps = { ...deps };
        for (const [packageName, version] of Object.entries(deps)) {
            if (!manager.isCatalogReference(version)) {
                continue;
            }
            const resolvedVersion = manager.resolveCatalogReference(devkit_1.workspaceRoot, packageName, version);
            if (!resolvedVersion) {
                throw new Error(`Could not resolve catalog reference for package ${packageName}@${version}.`);
            }
            resolvedDeps[packageName] = resolvedVersion;
        }
        resolved[section] = resolvedDeps;
    }
    return resolved;
}
function getPackageJson(schema, context) {
    const target = (0, devkit_1.parseTargetString)(schema.buildTarget, context);
    const project = context.projectGraph.nodes[target.project].data;
    const packageJsonPath = (0, path_1.join)(devkit_1.workspaceRoot, project.root, 'package.json');
    if (!(0, fs_1.existsSync)(packageJsonPath)) {
        throw new Error(`${packageJsonPath} does not exist.`);
    }
    const packageJson = (0, devkit_1.readJsonFile)(packageJsonPath);
    return packageJson;
}
function getOutputDir(schema, context) {
    let outputDir = schema.outputPath;
    if (outputDir) {
        outputDir = normalizeOutputPath(outputDir);
        if ((0, fs_1.existsSync)(outputDir)) {
            return outputDir;
        }
    }
    const target = (0, devkit_1.parseTargetString)(schema.buildTarget, context);
    const project = context.projectGraph.nodes[target.project].data;
    const buildTarget = project.targets[target.target];
    let maybeOutputPath = buildTarget.outputs?.[0] ??
        buildTarget.options.outputPath ??
        buildTarget.options.outputDir;
    if (!maybeOutputPath) {
        throw new Error(`Could not infer an output directory from the '${schema.buildTarget}' target. Please provide 'outputPath'.`);
    }
    maybeOutputPath = (0, internal_1.interpolate)(maybeOutputPath, {
        workspaceRoot: devkit_1.workspaceRoot,
        projectRoot: project.root,
        projectName: project.name,
        options: {
            ...(buildTarget.options ?? {}),
        },
    });
    outputDir = normalizeOutputPath(maybeOutputPath);
    if (!(0, fs_1.existsSync)(outputDir)) {
        throw new Error(`The output directory '${outputDir}' inferred from the '${schema.buildTarget}' target does not exist.\nPlease ensure a build has run first, and that the path is correct. Otherwise, please provide 'outputPath'.`);
    }
    return outputDir;
}
function normalizeOutputPath(outputPath) {
    outputPath = (0, strip_glob_to_base_dir_1.stripGlobToBaseDir)(outputPath);
    if (!outputPath.startsWith(devkit_1.workspaceRoot)) {
        outputPath = (0, path_1.join)(devkit_1.workspaceRoot, outputPath);
    }
    if (!(0, fs_1.lstatSync)(outputPath).isDirectory()) {
        outputPath = (0, path_1.dirname)(outputPath);
    }
    return outputPath;
}
