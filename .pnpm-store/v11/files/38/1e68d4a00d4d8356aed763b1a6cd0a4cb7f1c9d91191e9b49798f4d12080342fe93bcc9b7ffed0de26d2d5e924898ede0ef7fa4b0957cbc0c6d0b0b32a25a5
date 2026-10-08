"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTargetDefaultsForTarget = exports.mergeTargetConfigurations = void 0;
exports.createProjectConfigurationsWithPlugins = createProjectConfigurationsWithPlugins;
exports.mergeCreateNodesResults = mergeCreateNodesResults;
exports.findMatchingConfigFiles = findMatchingConfigFiles;
const workspace_root_1 = require("../../utils/workspace-root");
const project_nodes_manager_1 = require("./project-configuration/project-nodes-manager");
const target_normalization_1 = require("./project-configuration/target-normalization");
const minimatch_1 = require("minimatch");
const perf_hooks_1 = require("perf_hooks");
const delayed_spinner_1 = require("../../utils/delayed-spinner");
const plugin_progress_text_1 = require("../../utils/plugin-progress-text");
const progress_topics_1 = require("../../utils/progress-topics");
const error_types_1 = require("../error-types");
const target_defaults_1 = require("./project-configuration/target-defaults");
var target_merging_1 = require("./project-configuration/target-merging");
Object.defineProperty(exports, "mergeTargetConfigurations", { enumerable: true, get: function () { return target_merging_1.mergeTargetConfigurations; } });
const target_merging_2 = require("./project-configuration/target-merging");
var target_defaults_2 = require("./project-configuration/target-defaults");
Object.defineProperty(exports, "readTargetDefaultsForTarget", { enumerable: true, get: function () { return target_defaults_2.readTargetDefaultsForTarget; } });
/**
 * Transforms a list of project paths into a map of project configurations.
 *
 * Plugins are run in parallel, then results are merged in a single ordered pass:
 *   specified plugins → synthetic target defaults → default plugins
 *
 * This ordering ensures '...' spread tokens in default plugin configs
 * (project.json, package.json) expand against accumulated values from
 * specified plugins and target defaults.
 *
 * @param root The workspace root
 * @param nxJson The NxJson configuration
 * @param projectFiles Plugin config files, separated by plugin set
 * @param plugins The plugins separated into specified and default sets
 */
async function createProjectConfigurationsWithPlugins(root = workspace_root_1.workspaceRoot, nxJson, projectFiles, plugins) {
    perf_hooks_1.performance.mark('build-project-configs:start');
    let spinner;
    const inProgressPlugins = new Set();
    const getSpinnerText = () => spinner
        ? (0, plugin_progress_text_1.formatPluginProgressText)('Creating project graph nodes', inProgressPlugins)
        : '';
    const specifiedCreateNodesPlugins = plugins.specifiedPlugins.filter((plugin) => plugin.createNodes?.[0]);
    const defaultCreateNodesPlugins = plugins.defaultPlugins.filter((plugin) => plugin.createNodes?.[0]);
    const allCreateNodesPlugins = [
        ...specifiedCreateNodesPlugins,
        ...defaultCreateNodesPlugins,
    ];
    const allProjectFiles = [
        ...projectFiles.specifiedPluginFiles,
        ...projectFiles.defaultPluginFiles,
    ];
    const specifiedCount = specifiedCreateNodesPlugins.length;
    spinner = new delayed_spinner_1.DelayedSpinner(getSpinnerText(), {
        progressTopic: progress_topics_1.ProgressTopics.GraphConstruction,
    });
    const results = [];
    const errors = [];
    // We iterate over plugins first - this ensures that plugins specified first take precedence.
    for (const [index, { index: pluginIndex, createNodes: createNodesTuple, include, exclude, name: pluginName, },] of allCreateNodesPlugins.entries()) {
        const [, createNodes] = createNodesTuple;
        const matchingConfigFiles = findMatchingConfigFiles(allProjectFiles[index], include, exclude);
        inProgressPlugins.add(pluginName);
        let r = createNodes(matchingConfigFiles, {
            nxJsonConfiguration: nxJson,
            workspaceRoot: root,
        })
            .catch((e) => {
            const error = (0, error_types_1.isAggregateCreateNodesError)(e)
                ? // This is an expected error if something goes wrong while processing files.
                    e
                : // This represents a single plugin erroring out with a hard error.
                    new error_types_1.AggregateCreateNodesError([[null, e]], []);
            if (pluginIndex !== undefined) {
                error.pluginIndex = pluginIndex;
            }
            (0, error_types_1.formatAggregateCreateNodesError)(error, pluginName);
            // This represents a single plugin erroring out with a hard error.
            errors.push(error);
            // The plugin didn't return partial results, so we return an empty array.
            return error.partialResults.map((r) => [pluginName, r[0], r[1], index]);
        })
            .finally(() => {
            inProgressPlugins.delete(pluginName);
            spinner.setMessage(getSpinnerText());
        });
        results.push(r);
    }
    return Promise.all(results).then((results) => {
        spinner?.cleanup();
        // Split results into specified and default plugin sets
        const specifiedResults = results.slice(0, specifiedCount);
        const defaultResults = results.slice(specifiedCount);
        const { projectRootMap, externalNodes, rootMap, configurationSourceMaps } = mergeCreateNodesResults(specifiedResults, defaultResults, nxJson, root, errors);
        perf_hooks_1.performance.mark('build-project-configs:end');
        perf_hooks_1.performance.measure('build-project-configs', 'build-project-configs:start', 'build-project-configs:end');
        const allProjectFilesFlat = [
            ...projectFiles.specifiedPluginFiles.flat(),
            ...projectFiles.defaultPluginFiles.flat(),
        ];
        if (errors.length === 0) {
            return {
                projects: projectRootMap,
                externalNodes,
                projectRootMap: rootMap,
                sourceMaps: configurationSourceMaps,
                matchingProjectFiles: allProjectFilesFlat,
            };
        }
        else {
            throw new error_types_1.ProjectConfigurationsError(errors, {
                projects: projectRootMap,
                externalNodes,
                projectRootMap: rootMap,
                sourceMaps: configurationSourceMaps,
                matchingProjectFiles: allProjectFilesFlat,
            });
        }
    });
}
/**
 * Runs a single plugin batch through two passes:
 *
 * 1. Every project node in every plugin result is handed to `mergeFn`,
 *    which merges it into the manager's rootMap. Any failure is
 *    collected into `errors`; processing keeps going. External nodes
 *    are accumulated onto the shared `externalNodes` record.
 * 2. After every project in the batch has been merged, name-reference
 *    sentinels for the batch are registered against the manager's
 *    rootMap, so sentinels point at the target objects that actually
 *    received the merges.
 *
 * The two passes can't be collapsed: a sentinel registered too early
 * would point at the pre-merge object, and a later project in the same
 * batch may still rename a project the sentinel refers to. Splitting
 * the registration into a second pass also lets forward references
 * inside the same batch resolve eagerly.
 */
function mergeCreateNodesResultsFromSinglePlugin(pluginResults, mergeFn, nodesManager, externalNodes, errors) {
    mergeSinglePluginResults(pluginResults, mergeFn, externalNodes, errors);
    registerNameRefsFromSinglePlugin(pluginResults, nodesManager, errors);
}
function mergeSinglePluginResults(pluginResults, mergeFn, externalNodes, errors) {
    for (const result of pluginResults) {
        const [pluginName, file, nodes, pluginIndex] = result;
        const { projects: projectNodes, externalNodes: pluginExternalNodes } = nodes;
        const sourceInfo = [file, pluginName];
        for (const root in projectNodes) {
            if (!projectNodes[root])
                continue;
            const project = { root, ...projectNodes[root] };
            try {
                mergeFn(project, sourceInfo);
            }
            catch (error) {
                errors.push(new error_types_1.MergeNodesError({ file, pluginName, error, pluginIndex }));
            }
        }
        Object.assign(externalNodes, pluginExternalNodes);
    }
}
function registerNameRefsFromSinglePlugin(pluginResults, nodesManager, errors) {
    for (const result of pluginResults) {
        const [pluginName, file, nodes, pluginIndex] = result;
        const { projects: projectNodes } = nodes;
        try {
            nodesManager.registerNameRefs(projectNodes);
        }
        catch (error) {
            errors.push(new error_types_1.MergeNodesError({ file, pluginName, error, pluginIndex }));
        }
    }
}
/**
 * Merges create nodes results into a single rootMap.
 *
 * Every layer merges into the manager through the same source-map-aware
 * merge, in precedence order:
 *
 *   specified plugins → synthetic target defaults → default plugins
 *
 * so field-level provenance is decided by the merge itself for all three
 * layers — whichever layer a field's final value came from owns its
 * attribution, and `'...'` spreads in default-plugin configs resolve against
 * the accumulated specified + target-defaults base.
 *
 * Target-default synthesis needs the *merged* shape of the default layer
 * (to predict each target's eventual executor/command) before that layer
 * merges into the manager. To get it, default results are first staged into
 * a throwaway intermediate rootMap with unresolvable `'...'` spreads
 * deferred. The staging output feeds only `createTargetDefaultsResults`; the
 * default plugins then merge into the manager from their original results.
 */
function mergeCreateNodesResults(specifiedResults, defaultResults, nxJsonConfiguration, workspaceRoot, errors) {
    perf_hooks_1.performance.mark('createNodes:merge - start');
    const nodesManager = new project_nodes_manager_1.ProjectNodesManager();
    const externalNodes = {};
    const configurationSourceMaps = {};
    const mergeToManager = (project, sourceInfo) => nodesManager.mergeProjectNode(project, configurationSourceMaps, sourceInfo);
    for (const pluginResults of specifiedResults) {
        mergeCreateNodesResultsFromSinglePlugin(pluginResults, mergeToManager, nodesManager, externalNodes, errors);
    }
    // Without target defaults there is nothing to synthesize, and the staging
    // pass exists only to feed synthesis — skip straight to the default-plugin
    // merge.
    if (Object.keys(nxJsonConfiguration.targetDefaults ?? {}).length > 0) {
        // Throwaway staging area: the default layer's merged shape (unresolvable
        // `'...'` spreads deferred), read only by target-default synthesis. The
        // default plugins merge into the manager from their original results, not
        // from this map. No source maps are kept for it — synthesis attributes
        // targets without them (a default plugin can never be named by a
        // `filter.plugin`); the real default merge writes the manager's.
        const intermediateDefaultRootMap = {};
        // The rootMap merge adopts input arrays/objects by reference and grows
        // them in place (e.g. `mergeMetadata`), so staging works on deep clones —
        // handing it the plugin results themselves would corrupt them before the
        // real merge below reads them.
        const mergeToIntermediate = (project, sourceInfo) => {
            (0, project_nodes_manager_1.mergeProjectConfigurationIntoRootMap)(intermediateDefaultRootMap, (0, target_merging_2.deepClone)(project), undefined, sourceInfo, false, true);
        };
        // Stage the default layer for synthesis. Merge errors are discarded and
        // external nodes land in a scratch object — the same results merge into
        // the manager below, where both surface once with proper plugin context.
        // The discard is safe because every merge throw is base-independent in
        // both its condition and its reachability: each throw's condition reads
        // only the plugin's own config, and the spread-ambiguity throws fire even
        // when a key is dropped by a base-owns-key shortcut, because those
        // shortcuts eagerly validate the dropped value (`assertNoIntegerLikeSpreadKey`).
        // So a given config raises the same error in this pass and the real merge
        // below despite their bases differing.
        // Name references are NOT registered here: `applySubstitutions` sweeps only
        // the manager's `rootMap`, so sentinels registered against this throwaway
        // rootMap would never be visited and would never resolve.
        const stagingErrors = [];
        const stagingExternalNodes = {};
        for (const pluginResults of defaultResults) {
            mergeSinglePluginResults(pluginResults, mergeToIntermediate, stagingExternalNodes, stagingErrors);
        }
        const targetDefaultsResults = (0, target_defaults_1.createTargetDefaultsResults)(nodesManager.getRootMap(), intermediateDefaultRootMap, nxJsonConfiguration, configurationSourceMaps);
        if (targetDefaultsResults.length > 0) {
            mergeCreateNodesResultsFromSinglePlugin(targetDefaultsResults, mergeToManager, nodesManager, externalNodes, errors);
        }
    }
    // Merge the default plugins into the manager on top of the specified + TD
    // base, from their original results. This is the same source-map-aware path
    // the other layers take, so every field a default plugin wins — including
    // fields it overrides on a specified/TD target — is attributed to it by the
    // merge itself, `'...'` spreads resolve against the real base (keys a spread
    // lets the base win keep their base attribution), and identity provenance
    // follows the node-ownership rules in `recordTargetIdentitySourceMapInfo` /
    // `getMergeValueResult`.
    for (const pluginResults of defaultResults) {
        mergeCreateNodesResultsFromSinglePlugin(pluginResults, mergeToManager, nodesManager, externalNodes, errors);
    }
    const projectRootMap = nodesManager.getRootMap();
    try {
        nodesManager.applySubstitutions();
        (0, target_normalization_1.validateAndNormalizeProjectRootMap)(workspaceRoot, projectRootMap, nxJsonConfiguration, configurationSourceMaps);
    }
    catch (error) {
        let _errors = error instanceof AggregateError ? error.errors : [error];
        for (const e of _errors) {
            if ((0, error_types_1.isProjectsWithNoNameError)(e) ||
                (0, error_types_1.isMultipleProjectsWithSameNameError)(e) ||
                (0, error_types_1.isWorkspaceValidityError)(e)) {
                errors.push(e);
            }
            else {
                throw e;
            }
        }
    }
    const rootMap = (0, project_nodes_manager_1.createRootMap)(projectRootMap);
    perf_hooks_1.performance.mark('createNodes:merge - end');
    perf_hooks_1.performance.measure('createNodes:merge', 'createNodes:merge - start', 'createNodes:merge - end');
    return { projectRootMap, externalNodes, rootMap, configurationSourceMaps };
}
/**
 * Creates a matcher function for the given patterns. Globs are compiled once
 * here so matching a file list only runs the pre-parsed regex per file, instead
 * of recompiling every pattern on each call.
 * @param patterns Array of glob patterns (can include negation patterns starting with '!')
 * @param emptyValue Value to return when patterns array is empty
 * @returns A function that checks if a file matches the patterns
 */
function createMatcher(patterns, emptyValue) {
    if (!patterns || patterns.length === 0) {
        return () => emptyValue;
    }
    const hasNegationPattern = patterns.some((p) => p.startsWith('!'));
    if (hasNegationPattern) {
        // Patterns are processed in order, with later matches overriding earlier
        // ones; a leading negation starts from "matches everything".
        const compiled = patterns.map((pattern) => {
            const isNegation = pattern.startsWith('!');
            return {
                isNegation,
                matcher: new minimatch_1.Minimatch(isNegation ? pattern.substring(1) : pattern, {
                    dot: true,
                }),
            };
        });
        const initialMatch = patterns[0].startsWith('!');
        return (file) => {
            let isMatch = initialMatch;
            for (const { isNegation, matcher } of compiled) {
                if (matcher.match(file)) {
                    isMatch = !isNegation;
                }
            }
            return isMatch;
        };
    }
    const compiled = patterns.map((p) => new minimatch_1.Minimatch(p, { dot: true }));
    return (file) => compiled.some((m) => m.match(file));
}
function findMatchingConfigFiles(projectFiles, include, exclude) {
    // projectFiles already comes from multiGlobWithWorkspaceContext for the
    // plugin's createNodes pattern, so only include/exclude filters remain here.
    // Empty include means include everything, empty exclude means exclude nothing
    const includes = createMatcher(include, true);
    const excludes = createMatcher(exclude, false);
    return projectFiles.filter((file) => includes(file) && !excludes(file));
}
