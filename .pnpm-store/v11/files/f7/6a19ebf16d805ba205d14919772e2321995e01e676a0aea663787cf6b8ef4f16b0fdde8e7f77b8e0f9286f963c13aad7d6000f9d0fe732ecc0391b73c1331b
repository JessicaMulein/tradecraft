"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findLocalPluginsWithGenerators = findLocalPluginsWithGenerators;
exports.getLocalWorkspacePlugins = getLocalWorkspacePlugins;
const fs_1 = require("fs");
const path_1 = require("path");
const fileutils_1 = require("../fileutils");
const workspace_root_1 = require("../workspace-root");
const plugin_capabilities_1 = require("./plugin-capabilities");
/**
 * Sync, lightweight scan: for each given project root, read its package.json
 * and yield it as a plugin if it declares a `generators`/`schematics`
 * collection. Used by tab completion which cannot afford the heavier
 * {@link getLocalWorkspacePlugins} (that one loads each plugin's JS to
 * walk its capabilities).
 *
 * `projectRoots` are paths relative to `workspaceRoot`.
 */
function findLocalPluginsWithGenerators(projectRoots) {
    const plugins = new Map();
    for (const root of projectRoots) {
        if (!root)
            continue;
        const dir = (0, path_1.join)(workspace_root_1.workspaceRoot, root);
        let pkg = null;
        try {
            pkg = (0, fileutils_1.readJsonFile)((0, path_1.join)(dir, 'package.json'));
        }
        catch {
            continue;
        }
        const field = pkg?.generators ?? pkg?.schematics;
        if (pkg?.name && typeof field === 'string') {
            plugins.set(pkg.name, { dir, field });
        }
    }
    return plugins;
}
async function getLocalWorkspacePlugins(projectsConfiguration, nxJson) {
    const plugins = new Map();
    for (const project of Object.values(projectsConfiguration.projects)) {
        const packageJsonPath = (0, path_1.join)(workspace_root_1.workspaceRoot, project.root, 'package.json');
        if ((0, fs_1.existsSync)(packageJsonPath)) {
            const packageJson = (0, fileutils_1.readJsonFile)(packageJsonPath);
            const includeRuntimeCapabilities = nxJson?.plugins?.some((p) => (typeof p === 'string' ? p : p.plugin).startsWith(packageJson.name));
            const capabilities = await (0, plugin_capabilities_1.getPluginCapabilities)(workspace_root_1.workspaceRoot, packageJson.name, projectsConfiguration.projects, includeRuntimeCapabilities);
            if (capabilities &&
                (Object.keys(capabilities.executors ?? {}).length ||
                    Object.keys(capabilities.generators ?? {}).length ||
                    capabilities.projectGraphExtension ||
                    capabilities.projectInference)) {
                plugins.set(packageJson.name, {
                    ...capabilities,
                    name: packageJson.name,
                });
            }
        }
    }
    return plugins;
}
