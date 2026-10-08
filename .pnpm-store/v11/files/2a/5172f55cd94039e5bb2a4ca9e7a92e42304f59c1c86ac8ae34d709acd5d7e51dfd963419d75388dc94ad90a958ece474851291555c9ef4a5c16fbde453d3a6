"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTargetDefaultsResults = createTargetDefaultsResults;
exports.readTargetDefaultsForTarget = readTargetDefaultsForTarget;
exports.normalizeTargetDefaults = normalizeTargetDefaults;
const minimatch_1 = require("minimatch");
const path_1 = require("path");
const to_project_name_1 = require("../../../config/to-project-name");
const find_matching_projects_1 = require("../../../utils/find-matching-projects");
const globs_1 = require("../../../utils/globs");
const source_maps_1 = require("./source-maps");
const target_merging_1 = require("./target-merging");
const utils_1 = require("./utils");
/**
 * Builds a synthetic plugin result from nx.json's `targetDefaults`, layered
 * between specified-plugin and default-plugin results during merging.
 *
 * Synthesis sees the two layers separately to avoid re-merging specified
 * results into a parallel rootMap — for each (root, target) where both
 * layers contribute, it computes the eventual executor/command on the
 * fly. That's all the matcher needs; the full target merge happens
 * downstream in the real merge.
 */
function createTargetDefaultsResults(specifiedPluginRootMap, defaultPluginRootMap, nxJsonConfiguration, specifiedSourceMaps) {
    const targetDefaultsConfig = nxJsonConfiguration.targetDefaults;
    if (!targetDefaultsConfig) {
        return [];
    }
    // The nested-array shape keeps target/executor/glob as map keys, so there
    // is nothing to disambiguate against the rootMaps — normalization simply
    // wraps each key's value into an array of entries.
    const targetDefaults = normalizeTargetDefaults(targetDefaultsConfig);
    if (Object.keys(targetDefaults).length === 0) {
        return [];
    }
    // `projectNodesByName` and `rootToName` are only consulted when an entry
    // has a `filter.projects` filter — that's the only matcher branch that
    // needs either the project name or its node. Source-plugin attribution is
    // root-keyed via `resolveSourcePlugin`, not name-keyed, so it doesn't
    // need either map. Skip both builds in the common no-filter path.
    const needsProjectNodes = Object.values(targetDefaults).some((entries) => entries.some((e) => e.filter?.projects !== undefined));
    const needsSourcePlugin = Object.values(targetDefaults).some((entries) => entries.some((e) => e.filter?.plugin !== undefined));
    const projectNodes = needsProjectNodes
        ? buildProjectNodesAndRootToName(specifiedPluginRootMap, defaultPluginRootMap)
        : undefined;
    // Bucketed by the resolving `targetDefaults` key and the matching entry's
    // array index, so each array element becomes its own synthetic result with an
    // element-specific `file`. A given (root, target) resolves from exactly one
    // key, and that key's entries merge downstream in ascending index order
    // (document order, later winning) — matching the in-key merge the reader does.
    const syntheticProjectsByKeyIndex = {};
    const allRoots = new Set([
        ...Object.keys(specifiedPluginRootMap),
        ...Object.keys(defaultPluginRootMap),
    ]);
    for (const root of allRoots) {
        const specifiedTargets = specifiedPluginRootMap[root]?.targets ?? {};
        const defaultTargets = defaultPluginRootMap[root]?.targets ?? {};
        const projectName = projectNodes?.rootToName.get(root);
        const projectNode = projectName
            ? projectNodes.projectNodesByName[projectName]
            : undefined;
        for (const targetName of (0, utils_1.uniqueKeysInObjects)(specifiedTargets, defaultTargets)) {
            const effective = effectiveTargetForLookup(specifiedTargets[targetName], defaultTargets[targetName], root);
            if (!effective)
                continue;
            const sourcePlugin = needsSourcePlugin
                ? resolveSourcePlugin(root, targetName, defaultTargets[targetName], specifiedSourceMaps)
                : undefined;
            const syntheticTargets = buildSyntheticTargetsForRoot(targetName, root, effective, targetDefaults, projectName, projectNode, sourcePlugin);
            for (const { key, index, target } of syntheticTargets) {
                const byIndex = (syntheticProjectsByKeyIndex[key] ??= {});
                const projectsForEntry = (byIndex[index] ??= {});
                projectsForEntry[root] ??= { root, targets: {} };
                projectsForEntry[root].targets[targetName] = target;
            }
        }
    }
    // One synthetic result per matching array element, each carrying a `file`
    // that points at that element so source maps attribute fields to
    // `nx.json#targetDefaults.<key>[<index>]` (or `.<key>` for the object form).
    // Emitted in ascending index order within a key so the downstream merge
    // layers a key's entries in document order, later winning.
    const results = [];
    for (const key of Object.keys(syntheticProjectsByKeyIndex)) {
        const isArrayForm = Array.isArray(targetDefaultsConfig[key]);
        const indices = Object.keys(syntheticProjectsByKeyIndex[key])
            .map(Number)
            .sort((a, b) => a - b);
        for (const index of indices) {
            results.push([
                source_maps_1.TARGET_DEFAULTS_PLUGIN_NAME,
                targetDefaultSourceFile(key, isArrayForm ? index : undefined),
                { projects: syntheticProjectsByKeyIndex[key][index] },
            ]);
        }
    }
    return results;
}
// Encode the originating nx.json location into a synthetic result's `file`,
// reusing the `file` field as a location id rather than widening
// `SourceInformation` to carry a separate path. The object value form has no
// meaningful index (`nx.json#targetDefaults.build`); the array form points at
// the specific element (`nx.json#targetDefaults.build[3]`).
function targetDefaultSourceFile(key, index) {
    const location = index === undefined ? key : `${key}[${index}]`;
    return `nx.json#targetDefaults.${location}`;
}
function effectiveTargetForLookup(specifiedTarget, defaultTarget, root) {
    const resolvedSpecified = specifiedTarget
        ? (0, target_merging_1.resolveCommandSyntacticSugar)(specifiedTarget, root)
        : undefined;
    const resolvedDefault = defaultTarget
        ? (0, target_merging_1.resolveCommandSyntacticSugar)(defaultTarget, root)
        : undefined;
    if (resolvedSpecified && resolvedDefault) {
        if (!(0, target_merging_1.isCompatibleTarget)(resolvedSpecified, resolvedDefault)) {
            return effectiveFromWinner(resolvedDefault, true);
        }
        return {
            executor: resolvedDefault.executor ?? resolvedSpecified.executor,
            command: resolvedDefault.command ?? resolvedSpecified.command,
            options: runCommandsCommandIdentity(resolvedDefault) ??
                runCommandsCommandIdentity(resolvedSpecified),
            replacesSpecified: false,
        };
    }
    if (resolvedSpecified) {
        return effectiveFromWinner(resolvedSpecified, false);
    }
    if (resolvedDefault) {
        return effectiveFromWinner(resolvedDefault, false);
    }
    return undefined;
}
function effectiveFromWinner(target, replacesSpecified) {
    return {
        executor: target.executor,
        command: target.command,
        options: runCommandsCommandIdentity(target),
        replacesSpecified,
    };
}
// run-commands command identity lives in `options.command`/`options.commands`,
// not the top-level `command`. Returns just those fields (when present) for a
// run-commands target so the synthetic can be stamped to stay compatible with
// the winning target downstream (#36067). Undefined for any other executor.
function runCommandsCommandIdentity(target) {
    if (target.executor !== 'nx:run-commands')
        return undefined;
    const { command, commands } = target.options ?? {};
    if (command === undefined && commands === undefined)
        return undefined;
    return {
        ...(command !== undefined ? { command } : {}),
        ...(commands !== undefined ? { commands } : {}),
    };
}
// Whether an entry states what the target runs. run-commands identity lives in
// these two option keys, which are also what the identity stamp overwrites.
function authorsCommandIdentity(target) {
    return (target.options?.command !== undefined ||
        target.options?.commands !== undefined);
}
/**
 * Returns one synthetic defaults target per matching `targetDefaults` entry for
 * `targetName` at `root` (empty when no defaults apply). Emitting per entry
 * rather than a single pre-merged target lets source maps attribute fields to
 * the specific array element they came from; the entries merge downstream in
 * document order. A synthetic normally stamps the effective executor/command
 * (and the winner's run-commands options identity) so neither merge neighbor
 * can incompatible-replace it and drop its contributions; an entry naming its
 * own command keeps that command instead, per {@link authorsCommandIdentity}.
 *
 * @param effective The shape the real merge will land on. Used as the executor
 *   filter context and, in most cases, as the identity stamped onto the
 *   synthetic.
 */
function buildSyntheticTargetsForRoot(targetName, root, effective, targetDefaults, projectName, projectNode, sourcePlugin) {
    const resolved = resolveTargetDefaultMatches(targetDefaults, targetName, {
        executor: effective.executor,
        projectName,
        projectNode,
        sourcePlugin,
        command: effective.command,
    });
    if (!resolved)
        return [];
    const synthetics = [];
    for (const { index, config } of resolved.matches) {
        // Read before desugaring, which synthesises an executor for `command`.
        const authoredExecutor = config.executor;
        const synthetic = (0, target_merging_1.resolveCommandSyntacticSugar)((0, target_merging_1.deepClone)(config), root);
        // Compatibility guard, per entry: an entry incompatible with the effective
        // target shape (e.g. it sets a foreign `executor`) would wholesale-replace
        // the inferred/specified target during the real merge. Drop just that
        // entry rather than corrupt the target; compatible siblings still apply.
        if (!(0, target_merging_1.isCompatibleTarget)({ executor: effective.executor, command: effective.command }, synthetic)) {
            continue;
        }
        // Stamping over an entry that names its own command would discard it
        // (#36700), so the stamp is limited to the replacing path it was added
        // for (#36142).
        const wouldOverwriteAuthoredCommand = effective.options !== undefined && authorsCommandIdentity(synthetic);
        if (effective.replacesSpecified || !wouldOverwriteAuthoredCommand) {
            // Pre-stamp executor/command from the effective shape so the
            // synthetic can't be incompatible-replaced during the real merge.
            if (effective.executor !== undefined) {
                synthetic.executor = effective.executor;
            }
            if (effective.command !== undefined) {
                synthetic.command = effective.command;
            }
            // run-commands compatibility keys off options.command/commands, not the
            // top-level command. Stamp the winner's so the synthetic stays compatible
            // when the winning target uses the options.commands form (#36067). Both
            // keys are cleared first, since `isCompatibleTarget` reads `command` in
            // preference to `commands` and a leftover one would defeat the stamp.
            if (effective.options !== undefined) {
                const { command, commands, ...rest } = synthetic.options ?? {};
                synthetic.options = { ...rest, ...effective.options };
            }
        }
        else if (authoredExecutor === undefined) {
            // Unstamped, an executor desugaring synthesised for the `command`
            // shorthand reads as a rival run-commands target and replaces the one
            // this entry should merge into.
            delete synthetic.executor;
        }
        synthetics.push({ key: resolved.key, index, target: synthetic });
    }
    return synthetics;
}
/**
 * Public reader that resolves the target defaults applying to a given
 * target. Accepts the nested map shape (a value is either a plain config
 * object or an array of filtered entries).
 *
 * When called without project/plugin context, filtered entries that require
 * a `projects` or `plugin` filter cannot match and are skipped — only
 * catch-all entries (and `executor`-filtered entries when an executor is
 * supplied) contribute.
 *
 * Normalization runs per call. It is just an array-wrap of each key's value
 * (cheap relative to graph construction), and `targetDefaults` is mutable and
 * read through this exported entry point — caching by object identity would
 * return stale matches when a caller edits a key between reads.
 */
function readTargetDefaultsForTarget(targetName, targetDefaults, executor, opts) {
    if (!targetDefaults)
        return null;
    return resolveTargetDefault(normalizeTargetDefaults(targetDefaults), targetName, {
        executor,
        projectName: opts?.projectName,
        projectNode: opts?.projectNode,
        sourcePlugin: opts?.sourcePlugin,
        command: opts?.command,
    });
}
/**
 * Resolve the merged target default for `targetName` against the normalized
 * map. Two levels of lookup:
 *
 * 1. **Outer key selection** — preserves the long-standing record-shape
 *    precedence: the executor key (when the target has that executor and the
 *    key exists) wins, then the exact target-name key, then glob keys
 *    (longest first). Keys are tried in that order and the first key with *any*
 *    matching entry wins — even one contributing an empty config, so an empty
 *    `{}` catch-all still wins and does not fall through. A key whose entries
 *    all fail their `filter` contributes nothing and falls through to the next,
 *    matching the record matcher's "key must apply" behavior.
 * 2. **Inner accumulate-and-merge** — within the selected key's array, every
 *    entry whose `filter` matches is merged in document order via
 *    `mergeTargetConfigurations`, so later matches override earlier ones
 *    field by field. An entry with no `filter` is a catch-all that always
 *    matches.
 */
function resolveTargetDefault(normalized, targetName, ctx) {
    for (const key of orderedMatchingKeys(normalized, targetName, ctx.executor)) {
        const merged = mergeMatchingEntries(normalized[key], ctx);
        if (merged)
            return merged;
    }
    return null;
}
/**
 * For synthesis: the matching entries — with their original array indices — of
 * the first key that has any match (same key precedence as
 * {@link resolveTargetDefault}). Unlike that reader, the entries are NOT merged
 * here: each becomes its own synthetic node so source maps attribute fields to
 * the specific `targetDefaults` array element they came from, and the in-key
 * merge happens downstream in document (index) order.
 */
function resolveTargetDefaultMatches(normalized, targetName, ctx) {
    for (const key of orderedMatchingKeys(normalized, targetName, ctx.executor)) {
        const entries = normalized[key];
        const matches = [];
        for (let index = 0; index < entries.length; index++) {
            if (!entryFilterMatches(entries[index].filter, ctx))
                continue;
            matches.push({ index, config: stripFilter(entries[index]) });
        }
        if (matches.length > 0) {
            return { key, matches };
        }
    }
    return null;
}
/**
 * The candidate map keys for `targetName`, in record-shape precedence order
 * (highest first): executor key, exact name key, then glob keys longest
 * first (the longest glob is the most specific match). Yields lazily so the
 * glob scan is skipped entirely when an exact key already resolves a match.
 */
function* orderedMatchingKeys(normalized, targetName, executor) {
    if (executor && normalized[executor]) {
        yield executor;
    }
    if (normalized[targetName] && targetName !== executor) {
        yield targetName;
    }
    const globKeys = Object.keys(normalized)
        .filter((key) => key !== targetName &&
        key !== executor &&
        (0, globs_1.isGlobPattern)(key) &&
        (0, minimatch_1.minimatch)(targetName, key))
        .sort((a, b) => b.length - a.length);
    yield* globKeys;
}
/**
 * Merge every entry in `entries` whose `filter` matches `ctx`, in document
 * order with later matches winning. Returns null when no entry matched.
 */
function mergeMatchingEntries(entries, ctx) {
    let acc = null;
    for (const entry of entries) {
        if (!entryFilterMatches(entry.filter, ctx))
            continue;
        const config = stripFilter(entry);
        // Later matches merge on top, earlier entry as base. Unresolvable `'...'`
        // spreads are deferred by default so they survive for the downstream
        // merge against the plugin-provided target.
        acc = acc === null ? config : (0, target_merging_1.mergeTargetConfigurations)(config, acc);
    }
    return acc;
}
/**
 * Test a single entry's `filter` against the resolution context. A missing
 * filter is a catch-all (always matches). Otherwise every present criterion
 * (`projects`, `plugin`, `executor`) must agree.
 */
function entryFilterMatches(filter, ctx) {
    if (!filter)
        return true;
    if (filter.projects) {
        // No project context: a `projects` filter can't match, and passing the
        // absent node to `findMatchingProjects` would dereference undefined.
        if (!ctx.projectName || !ctx.projectNode) {
            return false;
        }
        const matched = (0, find_matching_projects_1.findMatchingProjects)([...filter.projects], {
            [ctx.projectName]: ctx.projectNode,
        });
        if (!matched.length) {
            return false;
        }
    }
    if (filter.plugin && filter.plugin !== ctx.sourcePlugin) {
        return false;
    }
    if (filter.executor && filter.executor !== ctx.executor) {
        return false;
    }
    return true;
}
/** Removes the `filter` namespace, leaving the merge payload. */
function stripFilter(entry) {
    const { filter, ...rest } = entry;
    return rest;
}
/**
 * Normalize the public `targetDefaults` map to the internal shape: every
 * key's value becomes an array of entries (a bare object → a single catch-all
 * entry).
 */
function normalizeTargetDefaults(raw) {
    if (!raw)
        return {};
    const normalized = {};
    for (const key of Object.keys(raw)) {
        normalized[key] = normalizeTargetDefaultValue(raw[key]);
    }
    return normalized;
}
function normalizeTargetDefaultValue(value) {
    if (Array.isArray(value))
        return value;
    // A bare config object is functionally a one-element array.
    return [value ?? {}];
}
function resolveSourcePlugin(root, targetName, defaultTarget, specifiedSourceMaps) {
    // `filter.plugin` ("targets originated by X") can only name a plugin from
    // nx.json's `plugins` — the specified set. When the default layer authors
    // the target's identity (its merged config carries an executor or command,
    // which the merge lets win), the originator is a default plugin and the
    // target has no matchable source plugin; no source maps are needed to see
    // that. Otherwise the specified layer's executor/command attribution names
    // the originator. The top-level `targets.<name>` node key is deliberately
    // NOT used as a fallback: it tracks ownership, so a later plugin augmenting
    // the target would mis-attribute it. The trade-off is that a target with
    // neither an executor nor a command (a rare, non-runnable shape) resolves to
    // no source plugin and won't match a `filter.plugin` default — accepted,
    // since every runnable target carries one of these keys.
    if (defaultTarget &&
        (defaultTarget.executor !== undefined ||
            defaultTarget.command !== undefined)) {
        return undefined;
    }
    const sourceMap = specifiedSourceMaps?.[root];
    for (const identityKey of ['executor', 'command']) {
        const plugin = sourceMap?.[`${(0, source_maps_1.targetSourceMapKey)(targetName)}.${identityKey}`]?.[1];
        if (plugin && plugin !== source_maps_1.TARGET_DEFAULTS_PLUGIN_NAME) {
            return plugin;
        }
    }
    return undefined;
}
// Builds a name → MatcherProjectNode view for `findMatchingProjects` to
// consult, across both layered rootMaps. Tags are unioned across layers. A
// full `mergeProjectConfigurationIntoRootMap` would be overkill — the matcher
// only needs `data.root`/`data.tags`.
function buildProjectNodesAndRootToName(specifiedPluginRootMap, defaultPluginRootMap) {
    const projectNodesByName = {};
    const rootToName = new Map();
    const roots = new Set([
        ...Object.keys(specifiedPluginRootMap),
        ...Object.keys(defaultPluginRootMap),
    ]);
    for (const root of roots) {
        const specifiedCfg = specifiedPluginRootMap[root];
        const defaultCfg = defaultPluginRootMap[root];
        // Synthesis runs before name inference, so an unnamed `project.json` has no
        // `name` yet. Derive it the same way normalization will — `toProjectName`
        // on the `project.json` path — so `projects:`/`tag:` filters resolve
        // instead of silently no-opping for the common unnamed-`project.json` case.
        // We don't gate on the file existing: if it truly doesn't, the project has
        // no valid name and the graph errors downstream anyway; here the derived
        // name is only used for filtering. Default-plugin name wins over specified,
        // matching the real merge's layering.
        const name = defaultCfg?.name ??
            specifiedCfg?.name ??
            (0, to_project_name_1.toProjectName)((0, path_1.join)(root, 'project.json'));
        const tags = Array.from(new Set([...(specifiedCfg?.tags ?? []), ...(defaultCfg?.tags ?? [])]));
        rootToName.set(root, name);
        if (projectNodesByName[name]) {
            const existingTags = projectNodesByName[name].data.tags ?? [];
            projectNodesByName[name].data.tags = Array.from(new Set([...existingTags, ...tags]));
        }
        else {
            // `findMatchingProjects` only reads `data.root`/`data.tags`; the name
            // is carried by the map key and `rootToName`.
            projectNodesByName[name] = { data: { root, tags } };
        }
    }
    return { projectNodesByName, rootToName };
}
