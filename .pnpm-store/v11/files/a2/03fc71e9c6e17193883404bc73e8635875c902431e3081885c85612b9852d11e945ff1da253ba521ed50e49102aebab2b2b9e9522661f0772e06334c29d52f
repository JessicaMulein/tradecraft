"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateProject = validateProject;
exports.normalizeTarget = normalizeTarget;
exports.validateAndNormalizeProjectRootMap = validateAndNormalizeProjectRootMap;
const executor_utils_1 = require("../../../command-line/run/executor-utils");
const fileutils_1 = require("../../../utils/fileutils");
const long_running_target_1 = require("../../../utils/long-running-target");
const output_1 = require("../../../utils/output");
const to_project_name_1 = require("../../../config/to-project-name");
const error_types_1 = require("../../error-types");
const target_merging_1 = require("./target-merging");
const node_fs_1 = require("node:fs");
const git_worktrees_1 = require("../../../utils/git-worktrees");
const path_1 = require("path");
function validateProject(project, 
// name -> project
knownProjects) {
    if (!project.name) {
        try {
            const { name } = (0, fileutils_1.readJsonFile)((0, path_1.join)(project.root, 'package.json'));
            if (!name) {
                throw new Error(`Project at ${project.root} has no name provided.`);
            }
            project.name = name;
        }
        catch {
            throw new error_types_1.ProjectWithNoNameError(project.root);
        }
    }
    else if (knownProjects[project.name] &&
        knownProjects[project.name].root !== project.root) {
        throw new error_types_1.ProjectWithExistingNameError(project.name, project.root);
    }
}
/**
 * Expand's `command` syntactic sugar, replaces tokens in options, and adds information from executor schema.
 * @param target The target to normalize
 * @param project The project that the target belongs to
 * @returns The normalized target configuration
 */
function normalizeTarget(target, project, workspaceRoot, projectsMap, errorMsgKey) {
    target = {
        ...target,
        configurations: {
            ...target.configurations,
        },
    };
    target = (0, target_merging_1.resolveCommandSyntacticSugar)(target, project.root);
    target.options = (0, target_merging_1.resolveNxTokensInOptions)(target.options, project, errorMsgKey);
    for (const configuration in target.configurations) {
        target.configurations[configuration] = (0, target_merging_1.resolveNxTokensInOptions)(target.configurations[configuration], project, `${project.root}:${target}:${configuration}`);
    }
    target.parallelism ??= true;
    if (target.executor && !('continuous' in target)) {
        try {
            const [executorNodeModule, executorName] = (0, executor_utils_1.parseExecutor)(target.executor);
            const { schema } = (0, executor_utils_1.getExecutorInformation)(executorNodeModule, executorName, workspaceRoot, projectsMap);
            if (schema.continuous) {
                target.continuous ??= schema.continuous;
            }
        }
        catch (e) {
            // If the executor is not found, we assume that it is not a valid executor.
            // This means that we should not set the continuous property.
            // We could throw an error here, but it would be better to just ignore it.
        }
    }
    return target;
}
// TODO(v24): remove the legacy target-name cache fallback and its warning.
// Removal needs a second mechanism for plugin-inferred targets, which the
// accompanying migration cannot reach.
/**
 * Whether `target` is cacheable only by way of the legacy name-based fallback:
 * the exact target-name key of `targetDefaults` declares `cache: true`, but an
 * executor key won target-default resolution instead, so the merged target never
 * received it.
 *
 * A `true` result means the user's `cache: true` silently lost, so this doubles
 * as the condition for warning them that the name key is being shadowed.
 */
function isLegacyCachedTarget(targetName, targetDefaults, target) {
    // Resolution already decided `cache`, so the name key isn't shadowed.
    if (target.cache !== undefined) {
        return false;
    }
    if (isLongRunningTarget(targetName, target)) {
        return false;
    }
    // Restricted to shadowing, which is narrower than what pre-23 restored: that
    // derivation matched on target name alone, so a name key dropped as
    // incompatible (its entry declared a foreign executor) was cacheable too.
    // Restoring that as well would mean writing `cache` with no key to name in
    // the warning, and no migration able to retire it. Deliberately not covered.
    if (!findShadowingTargetDefaultKey(targetDefaults, target)) {
        return false;
    }
    return declaresCacheTrue(targetDefaults?.[targetName]);
}
/**
 * Whether the name key declares `cache: true` on an entry that always applies.
 *
 * Filters are deliberately not evaluated. They cannot express a pre-23 config
 * (the filtered array shape postdates the behavior being restored), and a
 * filtered entry declaring `cache` may or may not apply to this project — so
 * rather than guess, a filtered `cache` declares the value unknowable and
 * nothing is restored. Among unfiltered entries the last wins, matching the
 * in-key merge order.
 */
function declaresCacheTrue(value) {
    if (!value) {
        return false;
    }
    const entries = Array.isArray(value) ? value : [value];
    let declared;
    for (const entry of entries) {
        // `nx.json` is hand-edited; a null or scalar entry would throw here.
        if (!entry || typeof entry !== 'object')
            continue;
        if (entry.cache === undefined)
            continue;
        if (entry.filter)
            return false;
        declared = entry.cache;
    }
    return declared === true;
}
/**
 * The normalization-time half of the pre-23 `longRunningTask` guard, which kept
 * `cacheableOperations` from ever making these cacheable. Its remaining clause
 * — `task.overrides['watch']` — is a runtime invocation override with no target
 * equivalent, so it has no counterpart here.
 */
function isLongRunningTarget(targetName, target) {
    return !!target.continuous || (0, long_running_target_1.isLongRunningTargetName)(targetName);
}
/**
 * The `targetDefaults` key that beat the target-name key for `target`. Only an
 * executor key can: key precedence puts the exact target name ahead of every
 * glob, so nothing else outranks it. Undefined when the name key lost for
 * another reason (e.g. its entry declared a foreign executor and was dropped as
 * incompatible) — see {@link isLegacyCachedTarget} for why that case is left
 * alone even though pre-23 restored it.
 *
 * `hasOwnProperty` rather than a lookup: an executor named `__proto__` resolves
 * through the prototype chain to a truthy object, which would report a key the
 * user never wrote.
 */
function findShadowingTargetDefaultKey(targetDefaults, target) {
    return target.executor &&
        targetDefaults &&
        Object.prototype.hasOwnProperty.call(targetDefaults, target.executor)
        ? target.executor
        : undefined;
}
/**
 * Emits a single grouped warning for every (shadowing key, target-name key)
 * pair that relied on the deprecated fallback. Grouping matters because the
 * same pair recurs in every affected project — a per-target warning would
 * print hundreds of identical lines in a large workspace.
 */
function warnAboutLegacyCachedTargets(legacyCacheReads) {
    if (legacyCacheReads.size === 0) {
        return;
    }
    const bodyLines = [];
    for (const [shadowingKey, targetKeys] of legacyCacheReads) {
        for (const targetKey of targetKeys) {
            bodyLines.push(`  - "${shadowingKey}" does not set "cache", so it was read from "${targetKey}"`);
        }
    }
    bodyLines.push('', 'An executor key applies to every target that resolves through it, so exclude any continuous target before setting "cache" on one — a target that is both cacheable and continuous is rejected.', 'Target defaults resolve to a single key rather than merging, so an executor key hides the target name key entirely.', 'Set "cache" on the executor key to keep these targets cacheable — reading it from the target name key is deprecated and will be removed in Nx 24.');
    output_1.output.warn({
        title: 'Some targets are only cacheable through a deprecated fallback.',
        bodyLines,
    });
}
function normalizeTargets(project, sourceMaps, nxJsonConfiguration, workspaceRoot, 
/**
 * Project configurations keyed by project name
 */
projects, 
/**
 * Shadowing `targetDefaults` key -> target name keys its `cache` was read
 * from. Accumulated across projects so the deprecation warns once per pair.
 */
legacyCacheReads) {
    const targetErrorMessage = [];
    for (const targetName in project.targets) {
        project.targets[targetName] = normalizeTarget(project.targets[targetName], project, workspaceRoot, projects, [project.root, targetName].join(':'));
        const target = project.targets[targetName];
        const targetDefaults = nxJsonConfiguration.targetDefaults;
        if (isLegacyCachedTarget(targetName, targetDefaults, target)) {
            target.cache = true;
            // Always defined: `isLegacyCachedTarget` returns false without it.
            const shadowingKey = findShadowingTargetDefaultKey(targetDefaults, target);
            const targetKeys = legacyCacheReads.get(shadowingKey) ?? new Set();
            targetKeys.add(targetName);
            legacyCacheReads.set(shadowingKey, targetKeys);
        }
        if (
        // If the target has no executor or command, it doesn't do anything
        !target.executor &&
            !target.command) {
            // But it may have dependencies that do something
            if (target.dependsOn && target.dependsOn.length > 0) {
                target.executor = 'nx:noop';
            }
            else {
                // If it does nothing, and has no depenencies,
                // we can remove it.
                delete project.targets[targetName];
            }
        }
        if (target.cache && target.continuous) {
            targetErrorMessage.push(`- "${targetName}" has both "cache" and "continuous" set to true. Continuous targets cannot be cached. Please remove the "cache" property.`);
        }
    }
    if (targetErrorMessage.length > 0) {
        targetErrorMessage.unshift(`Errors detected in targets of project "${project.name}":`);
        throw new error_types_1.WorkspaceValidityError(targetErrorMessage.join('\n'));
    }
}
function validateAndNormalizeProjectRootMap(workspaceRoot, projectRootMap, nxJsonConfiguration, sourceMaps = {}) {
    // Name -> Project, used to validate that all projects have unique names
    const projects = {};
    // If there are projects that have the same name, that is an error.
    // This object tracks name -> (all roots of projects with that name)
    // to provide better error messaging.
    const conflicts = new Map();
    const projectRootsWithNoName = [];
    const validityErrors = [];
    const legacyCacheReads = new Map();
    for (const root in projectRootMap) {
        const project = projectRootMap[root];
        // We're setting `// targets` as a comment `targets` is empty due to Project Crystal.
        // Strip it before returning configuration for usage.
        if (project['// targets'])
            delete project['// targets'];
        // We initially did this in the project.json plugin, but
        // that resulted in project.json files without names causing
        // the resulting project to change names from earlier plugins...
        if (!project.name) {
            const projectJsonPath = (0, path_1.join)(workspaceRoot, project.root, 'project.json');
            if ((0, node_fs_1.existsSync)(projectJsonPath)) {
                // The project.json plugin may not have run (e.g. when a single
                // plugin is run in isolation via `addPlugin` from a generator), so
                // prefer the name declared in project.json before deriving one from
                // the directory name.
                let nameFromProjectJson;
                try {
                    nameFromProjectJson =
                        (0, fileutils_1.readJsonFile)(projectJsonPath).name;
                }
                catch { }
                project.name =
                    nameFromProjectJson ?? (0, to_project_name_1.toProjectName)((0, path_1.join)(root, 'project.json'));
            }
        }
        try {
            validateProject(project, projects);
            projects[project.name] = project;
        }
        catch (e) {
            if ((0, error_types_1.isProjectWithNoNameError)(e)) {
                projectRootsWithNoName.push(e.projectRoot);
            }
            else if ((0, error_types_1.isProjectWithExistingNameError)(e)) {
                const rootErrors = conflicts.get(e.projectName) ?? [
                    projects[e.projectName].root,
                ];
                rootErrors.push(e.projectRoot);
                conflicts.set(e.projectName, rootErrors);
            }
            else {
                throw e;
            }
        }
    }
    for (const root in projectRootMap) {
        const project = projectRootMap[root];
        try {
            normalizeTargets(project, sourceMaps, nxJsonConfiguration, workspaceRoot, projects, legacyCacheReads);
        }
        catch (e) {
            if (e instanceof error_types_1.WorkspaceValidityError) {
                validityErrors.push(e);
            }
            else {
                throw e;
            }
        }
    }
    warnAboutLegacyCachedTargets(legacyCacheReads);
    const errors = [];
    if (conflicts.size > 0) {
        // Only on the way to throwing, so a workspace without duplicates never
        // pays for reading git's worktree registry.
        const worktreeAdvice = (0, git_worktrees_1.analyzeWorktreeConflicts)(workspaceRoot, conflicts);
        errors.push(new error_types_1.MultipleProjectsWithSameNameError(conflicts, projects, worktreeAdvice ?? undefined));
    }
    if (projectRootsWithNoName.length > 0) {
        errors.push(new error_types_1.ProjectsWithNoNameError(projectRootsWithNoName, projects));
    }
    if (validityErrors.length > 0) {
        errors.push(...validityErrors);
    }
    if (errors.length > 0) {
        throw new AggregateError(errors);
    }
    return projectRootMap;
}
