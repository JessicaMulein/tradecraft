"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkFilesAreInputs = checkFilesAreInputs;
exports.checkFilesAreOutputs = checkFilesAreOutputs;
exports.getTaskRawInputs = getTaskRawInputs;
exports.getTaskOutputs = getTaskOutputs;
exports._resetContextForTesting = _resetContextForTesting;
const path_1 = require("path");
const nx_json_1 = require("../config/nx-json");
const native_1 = require("../native");
const project_graph_1 = require("../project-graph/project-graph");
const create_task_graph_1 = require("../tasks-runner/create-task-graph");
const utils_1 = require("../tasks-runner/utils");
const path_2 = require("../utils/path");
const project_graph_utils_1 = require("../utils/project-graph-utils");
const split_target_1 = require("../utils/split-target");
const workspace_root_1 = require("../utils/workspace-root");
const hash_plan_inspector_1 = require("./hash-plan-inspector");
const task_hasher_1 = require("./task-hasher");
let cachedContext = null;
function getContext(seed) {
    // Only a fulfilled context is cached — caching a rejected promise would
    // poison the resolver for the rest of the process after one transient failure.
    return (cachedContext ??= loadContext(seed).catch((e) => {
        cachedContext = null;
        throw e;
    }));
}
async function loadContext(seed) {
    const projectGraph = seed?.projectGraph ?? (await (0, project_graph_1.createProjectGraphAsync)());
    const nxJson = seed?.nxJson ?? (0, nx_json_1.readNxJson)(workspace_root_1.workspaceRoot) ?? {};
    let inspector = null;
    const getInspector = () => 
    // As with the context itself, a rejection is not cached.
    (inspector ??= initInspector(projectGraph, nxJson).catch((e) => {
        inspector = null;
        throw e;
    }));
    return { projectGraph, nxJson, getInspector };
}
async function initInspector(projectGraph, nxJson) {
    const inspector = new hash_plan_inspector_1.HashPlanInspector(projectGraph, workspace_root_1.workspaceRoot, nxJson);
    await inspector.init();
    return inspector;
}
const identityCache = new Map();
const hashInputsCache = new Map();
const outputsCache = new Map();
const taskGraphCache = new Map();
const depsOutputsCache = new Map();
// ── Internal resolution helpers ──────────────────────────────────────────────
function resolveIdentity(taskId, projectGraph) {
    const cached = identityCache.get(taskId);
    if (cached)
        return cached;
    const [project, target, configuration] = (0, split_target_1.splitTarget)(taskId, projectGraph);
    if (!project || !target) {
        throw new Error(`Invalid taskId "${taskId}" — expected "project:target[:configuration]"`);
    }
    const projectNode = projectGraph.nodes[project];
    if (!projectNode) {
        throw new Error(`Invalid taskId "${taskId}" — project "${project}" does not exist in the project graph.`);
    }
    const targetConfig = projectNode.data?.targets?.[target];
    if (!targetConfig) {
        throw new Error(`Invalid taskId "${taskId}" — project "${project}" has no target "${target}".`);
    }
    // Substituting defaultConfiguration for a configuration that does not exist
    // would answer confidently about a *different* task — and configurations
    // routinely change `outputPath`, so the answer could be wrong in either
    // direction. `nx run` errors here; so do we.
    if (configuration &&
        !(0, project_graph_utils_1.projectHasTargetAndConfiguration)(projectNode, target, configuration)) {
        const available = Object.keys(targetConfig.configurations ?? {});
        throw new Error(`Invalid taskId "${taskId}" — target "${target}" of project "${project}" has no configuration "${configuration}".` +
            (available.length
                ? ` Available configurations: ${available.join(', ')}.`
                : ' It has no configurations.'));
    }
    const effectiveConfiguration = configuration ?? targetConfig.defaultConfiguration;
    const identity = {
        project,
        target,
        configuration: effectiveConfiguration,
        canonicalTaskId: (0, utils_1.createTaskId)(project, target, effectiveConfiguration),
        projectNode,
    };
    identityCache.set(taskId, identity);
    return identity;
}
async function getRawInputs(taskId, { projectGraph, getInspector }) {
    if (hashInputsCache.has(taskId)) {
        return hashInputsCache.get(taskId) ?? null;
    }
    const { project, target, configuration, canonicalTaskId } = resolveIdentity(taskId, projectGraph);
    const inspector = await getInspector();
    // `null` means "this task is absent from the hash plan" — any other failure
    // is a real error and propagates to the caller.
    const planResult = inspector.inspectTaskInputs({
        project,
        target,
        configuration,
    });
    const result = planResult[canonicalTaskId] ?? null;
    hashInputsCache.set(taskId, result);
    return result;
}
function getOutputs(taskId, projectGraph) {
    const cached = outputsCache.get(taskId);
    if (cached !== undefined)
        return cached;
    const { project, target, configuration, projectNode } = resolveIdentity(taskId, projectGraph);
    const outputs = (0, utils_1.getOutputsForTargetAndConfiguration)({ project, target, configuration }, {}, projectNode).map(path_2.normalizePath);
    outputsCache.set(taskId, outputs);
    return outputs;
}
/**
 * Configured outputs that `getOutputsForTargetAndConfiguration` dropped because
 * an `{options.x}` token had no value to interpolate. The resolver discards them
 * silently, so they have to be recovered from the target configuration.
 */
function getUnresolvedOutputs(taskId, projectGraph) {
    const { target, configuration, projectNode } = resolveIdentity(taskId, projectGraph);
    const targetConfig = projectNode.data.targets[target];
    const options = {
        ...targetConfig.options,
        ...(configuration
            ? targetConfig.configurations?.[configuration]
            : undefined),
    };
    return (targetConfig.outputs ?? []).filter((output) => [...output.matchAll(/\{options\.([^}]+)\}/g)].some(([, key]) => {
        const value = key.split('.').reduce((acc, k) => acc?.[k], options);
        return value === undefined;
    }));
}
function getTaskGraph(taskId, projectGraph) {
    const cached = taskGraphCache.get(taskId);
    if (cached)
        return cached;
    const { project, target, configuration } = resolveIdentity(taskId, projectGraph);
    const taskGraph = (0, create_task_graph_1.createTaskGraph)(projectGraph, {}, [project], [target], configuration, {}, false);
    taskGraphCache.set(taskId, taskGraph);
    return taskGraph;
}
function getDepsOutputs(taskId, { projectGraph, nxJson }) {
    if (depsOutputsCache.has(taskId))
        return depsOutputsCache.get(taskId);
    const { project, target } = resolveIdentity(taskId, projectGraph);
    const result = (0, task_hasher_1.getInputs)({ target: { project, target } }, projectGraph, nxJson)
        .depsOutputs ?? [];
    depsOutputsCache.set(taskId, result);
    return result;
}
function collectUpstreamTaskIds(taskGraph, rootTaskId, transitive) {
    const direct = taskGraph.dependencies[rootTaskId] ?? [];
    if (!transitive)
        return [...direct];
    const collected = new Set();
    const walk = (id) => {
        for (const dep of taskGraph.dependencies[id] ?? []) {
            if (collected.has(dep))
                continue;
            collected.add(dep);
            walk(dep);
        }
    };
    walk(rootTaskId);
    return [...collected];
}
/**
 * Matches a single path against a task's whole output pattern list using the
 * native glob engine (`globset`) that the task runner's expand_outputs also
 * builds on: non-glob patterns match themselves and anything nested under them,
 * and negated (`!`-prefixed) patterns act as exclusions over the full set.
 */
function isOutput(taskId, path, projectGraph) {
    const patterns = getOutputs(taskId, projectGraph);
    return (0, native_1.matchOutputPaths)(patterns, [(0, path_2.normalizePath)(path)])[0];
}
function matchesDependentTaskOutputs(taskId, path, ctx) {
    const normalized = (0, path_2.normalizePath)(path);
    const depsOutputs = getDepsOutputs(taskId, ctx);
    if (depsOutputs.length === 0)
        return false;
    const taskGraph = getTaskGraph(taskId, ctx.projectGraph);
    const { canonicalTaskId } = resolveIdentity(taskId, ctx.projectGraph);
    if (!taskGraph.tasks[canonicalTaskId])
        return false;
    for (const { dependentTasksOutputFiles, transitive } of depsOutputs) {
        const glob = (0, path_2.normalizePath)(dependentTasksOutputFiles);
        if (!(0, native_1.matchGlobPaths)([glob], [normalized])[0])
            continue;
        const upstreamIds = collectUpstreamTaskIds(taskGraph, canonicalTaskId, !!transitive);
        for (const upstreamId of upstreamIds) {
            if (isOutput(upstreamId, normalized, ctx.projectGraph))
                return true;
        }
    }
    return false;
}
/**
 * Coerces a caller-supplied path to the workspace-relative, forward-slashed
 * form the hash plan and output patterns are expressed in. A path outside the
 * workspace stays outside (`../…`) and simply matches nothing — it cannot be a
 * declared input or output, so "unmatched" is the true answer rather than an
 * error.
 */
function toWorkspaceRelativePath(candidatePath) {
    // Backslash separators must be split *before* anchoring: on POSIX a backslash
    // is an ordinary filename character, so `dep\..\..` would ride through
    // join/relative as one opaque segment and only become a live `..` traversal
    // after the swap. Swapped directly rather than via normalizePath, which also
    // strips a Windows drive letter: isAbsolute accepts the drive-less form too,
    // but relative() then resolves it against the cwd's drive, so a path on
    // another drive (`D:\…`) could be relativized to *inside* the workspace — a
    // Windows-only fail-open no POSIX test can catch.
    const forwardSlashed = candidatePath.replace(/\\/g, '/');
    // Anchoring a relative path to the workspace root before relativizing it back
    // resolves any `..` segments. Left in, they would traverse *through* a pattern
    // that globset had already matched — `dist/libs/dep/../../../secrets.env`
    // matching an output of `dist/libs/dep`.
    const absolute = (0, path_1.isAbsolute)(forwardSlashed)
        ? forwardSlashed
        : (0, path_1.join)(workspace_root_1.workspaceRoot, forwardSlashed);
    return (0, path_2.normalizePath)((0, path_1.relative)(workspace_root_1.workspaceRoot, absolute));
}
/**
 * The task's hash inputs, or an error. A task missing from its own hash plan is
 * a failure to *determine* the inputs — reporting every file as unmatched would
 * tell a sandbox-violation consumer that all of them are illegal.
 */
async function requireRawInputs(taskId, ctx) {
    const raw = await getRawInputs(taskId, ctx);
    if (!raw) {
        throw new Error(`Could not determine the inputs of task "${taskId}" — it is not present in its own hash plan.`);
    }
    return raw;
}
function classifyInput(taskId, candidate, raw, ctx) {
    // `environment`, `runtime` and `external` hold names rather than paths, so
    // they are matched against the value exactly as the caller supplied it.
    if (raw.environment.includes(candidate.value))
        return 'environment';
    if (raw.runtime.includes(candidate.value))
        return 'runtime';
    if (raw.external.includes(candidate.value))
        return 'external';
    const path = toWorkspaceRelativePath(candidate.path);
    if (raw.files.includes(path))
        return 'files';
    if (raw.depOutputs.includes(path))
        return 'depOutputs';
    return matchesDependentTaskOutputs(taskId, path, ctx)
        ? 'dependentTasksOutputFiles'
        : null;
}
/**
 * Check which values are legitimate inputs for the given task. A value matches
 * when it is:
 *   - a declared environment variable, runtime input, or external dependency;
 *   - a file in the task's declared input file list;
 *   - a file in the task's materialized `depOutputs` (upstream has run);
 *   - a file matching a `dependentTasksOutputFiles` glob declared on the task
 *     that lies inside the declared outputs of an upstream task in the task
 *     graph (static — works even when upstream tasks have not yet run).
 *
 * `categories` records the rule each matched value satisfied. Paths may be
 * workspace-relative or absolute; absolute ones are relativized against the
 * workspace root, and a path outside the workspace simply matches nothing. A
 * caller resolving paths against a cwd passes an {@link InputCandidate} so that
 * names are still matched verbatim.
 */
async function checkFilesAreInputs(taskId, files) {
    const ctx = await getContext();
    // Resolve the task and its hash plan eagerly, so an unknown task or an
    // undeterminable plan errors even when the file list is empty — rather than
    // being reported as "none of these files are inputs".
    resolveIdentity(taskId, ctx.projectGraph);
    const raw = await requireRawInputs(taskId, ctx);
    const matched = [];
    const unmatched = [];
    const categories = new Map();
    // Results are keyed by value, so a value given two path forms could land in
    // both matched and unmatched at once. Exact duplicates are collapsed instead.
    const seenPaths = new Map();
    for (const file of files) {
        const candidate = typeof file === 'string' ? { value: file, path: file } : file;
        const seenPath = seenPaths.get(candidate.value);
        if (seenPath !== undefined) {
            if (seenPath !== candidate.path) {
                throw new Error(`Value "${candidate.value}" was given conflicting path forms "${seenPath}" and "${candidate.path}".`);
            }
            continue;
        }
        seenPaths.set(candidate.value, candidate.path);
        const category = classifyInput(taskId, candidate, raw, ctx);
        if (category) {
            matched.push(candidate.value);
            categories.set(candidate.value, category);
        }
        else {
            unmatched.push(candidate.value);
        }
    }
    return { matched, unmatched, categories };
}
/**
 * Check which files match the output globs declared for the given task.
 * Uses the same path-matching logic as the task runner (directory containment
 * + glob matching through the native `globset` engine), including negated
 * (`!`-prefixed) patterns acting as exclusions over the whole pattern set.
 *
 * Paths may be workspace-relative or absolute; absolute ones are relativized
 * against the workspace root. An output pattern whose `{options.*}` token has no
 * value resolves to nothing — exactly as the task runner drops it — so a file it
 * would have covered is reported `unmatched`, like any other non-output.
 *
 * That last case makes `unmatched` two answers in one: "not an output" and
 * "the outputs could not be determined". A consumer judging sandbox violations
 * cannot tell them apart, and would call the second one illegal. `getTaskOutputs`
 * already computes the `unresolved` list this would need; surfacing it here is
 * deliberately deferred until a consumer's contract asks for the distinction.
 */
async function checkFilesAreOutputs(taskId, files) {
    const ctx = await getContext();
    // Validate taskId eagerly so callers always get an error for an unknown or
    // malformed task, even when the file list is empty.
    resolveIdentity(taskId, ctx.projectGraph);
    const patterns = getOutputs(taskId, ctx.projectGraph);
    const results = (0, native_1.matchOutputPaths)(patterns, files.map(toWorkspaceRelativePath));
    const matched = [];
    const unmatched = [];
    files.forEach((file, i) => {
        if (results[i]) {
            matched.push(file);
        }
        else {
            unmatched.push(file);
        }
    });
    return { matched, unmatched };
}
// ── Renderer helpers (used by `nx show target`) ──────────────────────────────
/**
 * Returns the full hash inputs for a task (files + runtime + env + depOutputs
 * + external). Used internally by the `nx show target --inputs` renderer.
 */
async function getTaskRawInputs(taskId, seed) {
    const ctx = await getContext(seed);
    return getRawInputs(taskId, ctx);
}
/**
 * Returns the outputs declared for a task, resolved against its effective
 * configuration. Used internally by the `nx show target --outputs` renderer.
 */
async function getTaskOutputs(taskId, seed) {
    const ctx = await getContext(seed);
    const resolved = getOutputs(taskId, ctx.projectGraph);
    return {
        resolved,
        expanded: (0, native_1.expandOutputs)(workspace_root_1.workspaceRoot, resolved),
        unresolved: getUnresolvedOutputs(taskId, ctx.projectGraph),
    };
}
// ── Test utilities ───────────────────────────────────────────────────────────
/**
 * Resets all module-level caches. Call this in `beforeEach` when testing so
 * each test gets a fresh context load. Not part of the public API.
 * @internal
 */
function _resetContextForTesting() {
    cachedContext = null;
    identityCache.clear();
    hashInputsCache.clear();
    outputsCache.clear();
    taskGraphCache.clear();
    depsOutputsCache.clear();
}
