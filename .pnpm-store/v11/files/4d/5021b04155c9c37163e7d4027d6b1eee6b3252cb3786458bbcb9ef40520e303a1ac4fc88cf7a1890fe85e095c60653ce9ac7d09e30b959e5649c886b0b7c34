"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = copyWorkspaceModules;
const devkit_1 = require("@nx/devkit");
const internal_1 = require("@nx/devkit/internal");
const node_fs_1 = require("node:fs");
const path_1 = require("path");
const fs_1 = require("fs");
const strip_glob_to_base_dir_1 = require("../../utils/strip-glob-to-base-dir");
const workspace_module_sections_1 = require("../../utils/workspace-module-sections");
// Sections of a copied module's own manifest whose workspace-module deps are
// rewritten to file: and recursed into. pnpm installs a transitive dependency's
// regular, optional, and auto-installed peer deps (a workspace peer is linked
// and recorded under the depending importer's dependencies in the lockfile), but
// never its devDependencies. A workspace-module peer is moved into dependencies,
// since pnpm rejects a file: spec under peerDependencies (mirrors the app-level
// move in prune-lockfile).
const TRANSITIVE_INSTALL_SECTIONS = [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
];
// Resolve `catalog:` references in a copied module manifest to the version the
// workspace pinned. Only the sections pnpm installs for a `file:` directory
// dependency are resolved: a copied module's devDependencies are never
// installed, so a `catalog:` there is inert (pnpm leaves it untouched), and
// resolving it would abort the whole deploy build if that catalog entry does
// not exist. Returns whether anything changed.
function resolveCatalogReferences(packageJson, manager) {
    if (!manager) {
        return false;
    }
    let modified = false;
    for (const section of TRANSITIVE_INSTALL_SECTIONS) {
        const deps = packageJson[section];
        if (!deps) {
            continue;
        }
        for (const [name, version] of Object.entries(deps)) {
            if (!manager.isCatalogReference(version)) {
                continue;
            }
            const resolved = manager.resolveCatalogReference(devkit_1.workspaceRoot, name, version);
            if (!resolved) {
                throw new Error(`Could not resolve catalog reference for package ${name}@${version}.`);
            }
            deps[name] = resolved;
            modified = true;
        }
    }
    return modified;
}
async function copyWorkspaceModules(schema, context) {
    devkit_1.logger.log('Copying Workspace Modules to Build Directory...');
    const outputDirectory = getOutputDir(schema, context);
    const packageJson = getPackageJson(schema, context);
    createWorkspaceModules(outputDirectory);
    handleWorkspaceModules(outputDirectory, packageJson, context.projectGraph);
    devkit_1.logger.log('Success!');
    return { success: true };
}
function handleWorkspaceModules(outputDirectory, packageJson, projectGraph) {
    if (!workspace_module_sections_1.WORKSPACE_MODULE_INSTALL_SECTIONS.some((section) => packageJson[section])) {
        return;
    }
    const workspaceModules = (0, internal_1.getWorkspacePackagesFromGraph)(projectGraph);
    const catalogManager = (0, internal_1.getCatalogManager)(devkit_1.workspaceRoot);
    // Only the pnpm prune path ships non-workspace local-path targets, so only
    // pnpm manifests get their file:/link: specs relocated.
    const isPnpmWorkspace = (0, devkit_1.detectPackageManager)(devkit_1.workspaceRoot) === 'pnpm';
    const processedModules = new Set();
    const workspaceModulesDir = (0, path_1.join)(outputDirectory, 'workspace_modules');
    function calculateRelativePath(fromPkgName, toPkgName) {
        const fromPath = (0, path_1.join)(workspaceModulesDir, fromPkgName);
        const toPath = (0, path_1.join)(workspaceModulesDir, toPkgName);
        const relativePath = (0, path_1.relative)(fromPath, toPath);
        // Ensure forward slashes for file: protocol (Windows compatibility)
        return relativePath.split(path_1.sep).join('/');
    }
    function processModule(pkgName) {
        if (processedModules.has(pkgName)) {
            devkit_1.logger.verbose(`Skipping ${pkgName} (already processed).`);
            return;
        }
        if (!workspaceModules.has(pkgName)) {
            return;
        }
        processedModules.add(pkgName);
        devkit_1.logger.verbose(`Copying ${pkgName}.`);
        const workspaceModuleProject = workspaceModules.get(pkgName);
        const workspaceModuleRoot = workspaceModuleProject.data.root;
        // data.root is workspace-root-relative in the graph, but may arrive
        // absolute; normalize so the local-path relocation math is in
        // workspace-root space.
        const moduleWsRelativeRoot = (0, path_1.isAbsolute)(workspaceModuleRoot)
            ? (0, path_1.relative)(devkit_1.workspaceRoot, workspaceModuleRoot).split(path_1.sep).join('/')
            : workspaceModuleRoot;
        const newWorkspaceModulePath = (0, path_1.join)(workspaceModulesDir, pkgName);
        // Copy the module, from the workspace root rather than the process cwd: a
        // graph root arrives workspace-relative in the common case.
        (0, node_fs_1.mkdirSync)(newWorkspaceModulePath, { recursive: true });
        (0, node_fs_1.cpSync)((0, path_1.join)(devkit_1.workspaceRoot, moduleWsRelativeRoot), newWorkspaceModulePath, {
            filter: (src) => !src.includes('node_modules'),
            recursive: true,
        });
        devkit_1.logger.verbose(`Copied ${pkgName} successfully.`);
        // Read the copied module's package.json to process its dependencies
        const copiedPackageJsonPath = (0, path_1.join)(newWorkspaceModulePath, 'package.json');
        let copiedPackageJson;
        try {
            copiedPackageJson = JSON.parse((0, node_fs_1.readFileSync)(copiedPackageJsonPath, 'utf-8'));
        }
        catch (e) {
            devkit_1.logger.warn(`Could not read package.json for ${pkgName}: ${e.message}`);
            return;
        }
        // The standalone dist ships no catalog definition, so resolve any
        // `catalog:` references to the version the workspace pinned.
        let packageJsonModified = resolveCatalogReferences(copiedPackageJson, catalogManager);
        // Rewrite sibling workspace-module deps to file: paths and recurse. A peer
        // is moved into dependencies (pnpm rejects a file: spec under
        // peerDependencies), dropping its now-orphaned optional/required marker.
        for (const section of TRANSITIVE_INSTALL_SECTIONS) {
            const deps = copiedPackageJson[section];
            if (!deps) {
                continue;
            }
            for (const depName of Object.keys(deps)) {
                if (workspaceModules.has(depName)) {
                    const fileSpec = `file:${calculateRelativePath(pkgName, depName)}`;
                    if (section === 'peerDependencies') {
                        (0, internal_1.movePeerDependencyToDependencies)(copiedPackageJson, depName, fileSpec);
                    }
                    else {
                        deps[depName] = fileSpec;
                    }
                    packageJsonModified = true;
                    processModule(depName);
                    continue;
                }
                // A non-workspace file:/link: dep must keep resolving after the module
                // moves. pnpm reads a non-importer manifest file: spec relative to the
                // package dir but a link: spec relative to the install root, so each
                // rebases onto a different base (pnpm-only; see isPnpmWorkspace).
                if (!isPnpmWorkspace) {
                    continue;
                }
                const spec = deps[depName];
                const relocation = (0, internal_1.relocatePrunedLocalPathSpec)(spec, moduleWsRelativeRoot, spec.startsWith('link:') ? '' : `workspace_modules/${pkgName}`);
                if (!relocation) {
                    continue;
                }
                if (relocation.reason) {
                    (0, internal_1.warnUnshippableLocalPathSpec)(`"${spec}" in ${pkgName}`, relocation.reason);
                }
                if (section === 'peerDependencies') {
                    // Moved even when the target cannot ship: pnpm rejects the spec here
                    // either way.
                    (0, internal_1.movePeerDependencyToDependencies)(copiedPackageJson, depName, relocation.spec);
                    packageJsonModified = true;
                }
                else if (!relocation.reason) {
                    deps[depName] = relocation.spec;
                    packageJsonModified = true;
                }
            }
        }
        (0, internal_1.dropEmptyPeerDependencySections)(copiedPackageJson);
        if (packageJsonModified) {
            (0, node_fs_1.writeFileSync)(copiedPackageJsonPath, JSON.stringify(copiedPackageJson, null, 2));
            devkit_1.logger.verbose(`Updated package.json for ${pkgName}.`);
        }
    }
    // Seed from every section the app declares a workspace module in. Copied
    // modules recurse over production sections only (see processModule).
    // processModule dedups via processedModules, so a module listed in several
    // sections is copied once.
    for (const section of workspace_module_sections_1.WORKSPACE_MODULE_INSTALL_SECTIONS) {
        const deps = packageJson[section];
        if (!deps) {
            continue;
        }
        for (const pkgName of Object.keys(deps)) {
            processModule(pkgName);
        }
    }
}
function createWorkspaceModules(outputDirectory) {
    (0, node_fs_1.mkdirSync)((0, path_1.join)(outputDirectory, 'workspace_modules'), { recursive: true });
}
function getPackageJson(schema, context) {
    const target = (0, devkit_1.parseTargetString)(schema.buildTarget, context);
    const project = context.projectGraph.nodes[target.project].data;
    const packageJsonPath = (0, path_1.join)(devkit_1.workspaceRoot, project.root, 'package.json');
    if (!(0, node_fs_1.existsSync)(packageJsonPath)) {
        throw new Error(`${packageJsonPath} does not exist.`);
    }
    const packageJson = (0, devkit_1.readJsonFile)(packageJsonPath);
    return packageJson;
}
function getOutputDir(schema, context) {
    let outputDir = schema.outputPath;
    if (outputDir) {
        outputDir = normalizeOutputPath(outputDir);
        if ((0, node_fs_1.existsSync)(outputDir)) {
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
    if (!(0, node_fs_1.existsSync)(outputDir)) {
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
