"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectNameCompletions = getProjectNameCompletions;
exports.getProjectNamesWithTarget = getProjectNamesWithTarget;
exports.completeProjectTarget = completeProjectTarget;
exports.completeGenerator = completeGenerator;
exports.getGeneratorPluginCompletions = getGeneratorPluginCompletions;
exports.getGeneratorsForPlugin = getGeneratorsForPlugin;
exports.getTargetNameCompletions = getTargetNameCompletions;
exports.getTargetNamesForProject = getTargetNamesForProject;
const path_1 = require("path");
const workspace_root_1 = require("../../utils/workspace-root");
const project_graph_1 = require("../../project-graph/project-graph");
const fileutils_1 = require("../../utils/fileutils");
const local_plugins_1 = require("../../utils/plugins/local-plugins");
/** Stale graphs are intentionally tolerated — do not "fix" by triggering
 *  a recompute. readCachedProjectGraph throws if no cache exists; we
 *  swallow because completion must always degrade silently. */
function getCachedProjectGraph() {
    try {
        return (0, project_graph_1.readCachedProjectGraph)();
    }
    catch {
        return null;
    }
}
/** Project names matching `current`. */
function getProjectNameCompletions(current) {
    const graph = getCachedProjectGraph();
    if (!graph?.nodes) {
        return [];
    }
    const names = Object.keys(graph.nodes);
    if (!current) {
        return names;
    }
    return names.filter((name) => name.startsWith(current));
}
/** Projects that declare `targetName`, matching `current`. */
function getProjectNamesWithTarget(current, targetName) {
    const graph = getCachedProjectGraph();
    if (!graph?.nodes) {
        return [];
    }
    const matches = [];
    for (const [name, node] of Object.entries(graph.nodes)) {
        if (node?.data?.targets?.[targetName]) {
            if (!current || name.startsWith(current)) {
                matches.push(name);
            }
        }
    }
    return matches;
}
/** Two-stage `project[:target]` — stage 1 emits `project:` (nospace), stage 2 emits `project:target`. */
function completeProjectTarget(current) {
    const colonIdx = current.indexOf(':');
    if (colonIdx === -1) {
        return getProjectNameCompletions(current).map((p) => `${p}:`);
    }
    const projectName = current.slice(0, colonIdx);
    const targetPrefix = current.slice(colonIdx + 1);
    return getTargetNamesForProject(targetPrefix, projectName).map((t) => `${projectName}:${t}`);
}
/** Generator completion. Stage 1 (`nx g <TAB>`) emits plugin names (with `:`)
 *  and bare generator names (for `nx g application`); stage 2 emits
 *  `plugin:generator`. */
function completeGenerator(current) {
    const colonIdx = current.indexOf(':');
    if (colonIdx !== -1) {
        const pluginName = current.slice(0, colonIdx);
        const generatorPrefix = current.slice(colonIdx + 1);
        return getGeneratorsForPlugin(pluginName, generatorPrefix).map((g) => `${pluginName}:${g}`);
    }
    // No prefix on the plugin map — we need every plugin to enumerate bare
    // generator names; dedup bare names across plugins.
    const all = collectPluginDirs();
    const result = [];
    const bare = new Set();
    for (const [name, entry] of all) {
        if (!current || name.startsWith(current)) {
            result.push(`${name}:`);
        }
        for (const gen of readGeneratorNames(entry.dir, entry.field)) {
            if (!current || gen.startsWith(current)) {
                bare.add(gen);
            }
        }
    }
    for (const gen of bare) {
        result.push(gen);
    }
    return result;
}
/** Plugin names matching `current` — installed npm plugins + workspace-local
 *  plugin projects, only those declaring a generator collection. */
function getGeneratorPluginCompletions(current) {
    return [...collectPluginDirs(current).keys()];
}
/** Generator names in a single plugin, matching `current`. */
function getGeneratorsForPlugin(pluginName, current) {
    const entry = collectPluginDirs(pluginName).get(pluginName);
    if (!entry) {
        return [];
    }
    const generators = readGeneratorNames(entry.dir, entry.field);
    if (!current) {
        return generators;
    }
    return generators.filter((g) => g.startsWith(current));
}
/** plugin name → { dir, generators-collection path }. Workspace-local
 *  plugins win over same-named installed ones. `prefix` skips non-matching
 *  installed deps before reading their package.json. */
function collectPluginDirs(prefix = '') {
    const dirs = new Map();
    // Installed plugins: root package.json deps, resolved under node_modules.
    const rootPkg = readJsonSafe((0, path_1.join)(workspace_root_1.workspaceRoot, 'package.json'));
    if (rootPkg) {
        const deps = {
            ...(rootPkg.dependencies ?? {}),
            ...(rootPkg.devDependencies ?? {}),
        };
        for (const dep of Object.keys(deps)) {
            if (prefix && !dep.startsWith(prefix))
                continue;
            const dir = (0, path_1.join)(workspace_root_1.workspaceRoot, 'node_modules', dep);
            const pkg = readJsonSafe((0, path_1.join)(dir, 'package.json'));
            const field = pkg?.generators ?? pkg?.schematics;
            if (typeof field === 'string')
                dirs.set(dep, { dir, field });
        }
    }
    // Workspace-local plugin projects — shared helper with utils/plugins.
    // Local entries overwrite same-named installed ones (the local one is what
    // the user is developing).
    const graph = getCachedProjectGraph();
    const projectRoots = Object.values(graph?.nodes ?? {})
        .map((n) => n?.data?.root)
        .filter((r) => typeof r === 'string' && r.length > 0);
    for (const [name, entry] of (0, local_plugins_1.findLocalPluginsWithGenerators)(projectRoots)) {
        if (prefix && !name.startsWith(prefix))
            continue;
        dirs.set(name, entry);
    }
    return dirs;
}
/**
 * Reads the non-hidden generator names from the `generators`/`schematics`
 * JSON at `field`, relative to the plugin's `pluginDir`.
 */
function readGeneratorNames(pluginDir, field) {
    const generatorsJson = readJsonSafe((0, path_1.join)(pluginDir, field));
    if (!generatorsJson) {
        return [];
    }
    const collection = generatorsJson.generators ?? generatorsJson.schematics ?? {};
    return Object.keys(collection).filter((k) => !collection[k]?.hidden);
}
function readJsonSafe(path) {
    try {
        return (0, fileutils_1.readJsonFile)(path);
    }
    catch {
        return null;
    }
}
/** Unique target names across the workspace, matching `current`. */
function getTargetNameCompletions(current) {
    const graph = getCachedProjectGraph();
    if (!graph?.nodes)
        return [];
    const targetSet = new Set();
    for (const node of Object.values(graph.nodes)) {
        for (const target of Object.keys(node?.data?.targets ?? {})) {
            targetSet.add(target);
        }
    }
    const targets = [...targetSet];
    return current ? targets.filter((t) => t.startsWith(current)) : targets;
}
/** Target names for a single project, matching `current`. Falls back to
 *  workspace-wide if the project isn't in the graph — covers the
 *  `project:t<TAB>` case where the user is still typing the project name. */
function getTargetNamesForProject(current, projectName) {
    const graph = getCachedProjectGraph();
    if (!graph?.nodes)
        return [];
    const node = graph.nodes[projectName];
    if (!node)
        return getTargetNameCompletions(current);
    const targets = Object.keys(node?.data?.targets ?? {});
    return current ? targets.filter((t) => t.startsWith(current)) : targets;
}
