"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPluginForConfigFile = findPluginForConfigFile;
const devkit_exports_1 = require("nx/src/devkit-exports");
const devkit_internals_1 = require("nx/src/devkit-internals");
const minimatch_1 = require("minimatch");
async function findPluginForConfigFile(tree, pluginName, pathToConfigFile) {
    const nxJson = (0, devkit_exports_1.readNxJson)(tree);
    if (!nxJson.plugins) {
        return;
    }
    const pluginRegistrations = nxJson.plugins.filter((p) => (typeof p === 'string' ? p === pluginName : p.plugin === pluginName));
    for (const plugin of pluginRegistrations) {
        if (typeof plugin === 'string') {
            return plugin;
        }
        if (!plugin.include && !plugin.exclude) {
            return plugin;
        }
        if (plugin.include || plugin.exclude) {
            const resolvedPlugin = await import(pluginName);
            const pluginGlob = resolvedPlugin.createNodes?.[0] ?? resolvedPlugin.createNodesV2?.[0];
            // The file must be one this plugin actually processes (its path matches
            // the plugin's createNodes glob) before the registration's include/exclude
            // filters are applied.
            const matchingConfigFile = !pluginGlob || (0, minimatch_1.minimatch)(pathToConfigFile, pluginGlob, { dot: true })
                ? (0, devkit_internals_1.findMatchingConfigFiles)([pathToConfigFile], plugin.include, plugin.exclude)
                : [];
            if (matchingConfigFile.length) {
                return plugin;
            }
        }
    }
}
