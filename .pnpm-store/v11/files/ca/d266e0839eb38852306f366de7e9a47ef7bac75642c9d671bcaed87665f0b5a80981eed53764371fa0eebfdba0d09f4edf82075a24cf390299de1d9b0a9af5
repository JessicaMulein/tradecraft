"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectNameInNodePropsManager = exports.UsageRef = exports.RootRef = exports.NameRef = void 0;
exports.isNameRef = isNameRef;
exports.isRootRef = isRootRef;
exports.isUsageRef = isUsageRef;
const globs_1 = require("../../../utils/globs");
const split_target_1 = require("../../../utils/split-target");
/**
 * Sentinel placed in `inputs` / `dependsOn` for a pending project-name
 * reference. `RootRef` carries the referenced project's root (resolved
 * via nameMap lookup); `UsageRef` carries the raw written name (for
 * forward refs, promoted to `RootRef` in place when the name is
 * identified). `targetPart` preserves the `:target` suffix from
 * `dependsOn` strings.
 */
class NameRef {
    constructor(value, targetPart) {
        this.value = value;
        this.targetPart = targetPart;
    }
}
exports.NameRef = NameRef;
class RootRef extends NameRef {
}
exports.RootRef = RootRef;
class UsageRef extends NameRef {
}
exports.UsageRef = UsageRef;
function isNameRef(value) {
    return value instanceof NameRef;
}
function isRootRef(value) {
    return value instanceof RootRef;
}
function isUsageRef(value) {
    return value instanceof UsageRef;
}
/**
 * Replaces project-name refs in plugin results with in-place sentinels,
 * then resolves them after all merging is done.
 *
 * Tracking by array position breaks once `'...'` spreads shuffle indices,
 * so each ref becomes a sentinel object. Merges copy sentinels by
 * reference — one sentinel can end up in many arrays (e.g. a pattern
 * target's dependsOn applied to every matching target) — so the final
 * pass sweeps the merged rootMap and resolves every sentinel where it
 * actually sits. Sentinels in arrays dropped by a full-replace are never
 * visited and vanish with their array.
 */
class ProjectNameInNodePropsManager {
    constructor(getNameMap) {
        this.pendingByName = new Map();
        // name → root for every name a project has ever been identified by, so refs
        // to a since-renamed name still bind to the right root (see createRef).
        this.nameHistory = new Map();
        this.getNameMap = getNameMap ?? (() => ({}));
    }
    // Replaces each project-name ref in `inputs`/`dependsOn` with a sentinel.
    // Call after `identifyProjectWithRoot` for the batch so same-batch forward
    // refs resolve straight to RootRefs.
    registerNameRefs(pluginResultProjects) {
        if (!pluginResultProjects)
            return;
        for (const ownerRoot in pluginResultProjects) {
            const project = pluginResultProjects[ownerRoot];
            if (!project?.targets)
                continue;
            for (const targetName in project.targets) {
                const targetConfig = project.targets[targetName];
                if (!targetConfig || typeof targetConfig !== 'object')
                    continue;
                if (Array.isArray(targetConfig.inputs)) {
                    this.processInputs(targetConfig.inputs);
                }
                if (Array.isArray(targetConfig.dependsOn)) {
                    this.processDependsOn(targetConfig.dependsOn, project.targets, project.name);
                }
            }
        }
    }
    processInputs(inputs) {
        for (let i = 0; i < inputs.length; i++) {
            const entry = inputs[i];
            if (isNameRef(entry))
                continue;
            if (!entry || typeof entry !== 'object')
                continue;
            if (!('projects' in entry))
                continue;
            const element = entry;
            const projects = element.projects;
            if (isNameRef(projects))
                continue;
            if (typeof projects === 'string') {
                if (projects === 'self' || projects === 'dependencies')
                    continue;
                element.projects = this.createRef(projects);
            }
            else if (Array.isArray(projects)) {
                this.processProjectsArray(projects);
            }
        }
    }
    processDependsOn(dependsOn, ownerTargets, ownerName) {
        for (let i = 0; i < dependsOn.length; i++) {
            const dep = dependsOn[i];
            if (isNameRef(dep))
                continue;
            if (typeof dep === 'string') {
                // `^target` and same-project targets aren't cross-project refs.
                if (dep.startsWith('^') || (ownerTargets && dep in ownerTargets)) {
                    continue;
                }
                const [maybeProject, ...rest] = (0, split_target_1.splitTargetFromConfigurations)(dep, this.getNameMap(), { silent: true, currentProject: ownerName });
                if (rest.length === 0)
                    continue;
                const targetPart = rest.join(':');
                dependsOn[i] = this.createRef(maybeProject, targetPart);
                continue;
            }
            if (!dep || typeof dep !== 'object' || !('projects' in dep))
                continue;
            const element = dep;
            const projects = element.projects;
            if (isNameRef(projects)) {
                continue;
            }
            if (typeof projects === 'string') {
                if (projects === '*' ||
                    projects === 'self' ||
                    projects === 'dependencies') {
                    continue;
                }
                element.projects = this.createRef(projects);
            }
            else if (Array.isArray(projects)) {
                this.processProjectsArray(projects);
            }
        }
    }
    processProjectsArray(projects) {
        for (let j = 0; j < projects.length; j++) {
            const name = projects[j];
            if (isNameRef(name))
                continue;
            if (typeof name !== 'string')
                continue;
            if ((0, globs_1.isGlobPattern)(name))
                continue;
            projects[j] = this.createRef(name);
        }
    }
    // Builds a sentinel and registers it. When `referencedName` isn't in the
    // current name map, fall back to the rename history: a batch may reference a
    // project by a name that a project earlier in the same batch already renamed
    // (refs register after the whole batch merges), and the old name still
    // identifies the same root.
    createRef(referencedName, targetPart) {
        const referencedRoot = this.getNameMap()[referencedName]?.root ??
            this.nameHistory.get(referencedName);
        const ref = referencedRoot !== undefined
            ? new RootRef(referencedRoot, targetPart)
            : new UsageRef(referencedName, targetPart);
        if (ref instanceof UsageRef) {
            let set = this.pendingByName.get(referencedName);
            if (!set) {
                set = new Set();
                this.pendingByName.set(referencedName, set);
            }
            set.add(ref);
        }
        return ref;
    }
    // Records `name` → `root` and promotes any waiting UsageRef sentinels to
    // RootRef by prototype swap. Sentinel identity across spread copies means
    // one promotion updates every array the sentinel reached.
    identifyProjectWithRoot(root, name) {
        // Every name a root has ever gone by, including pre-rename names. A later
        // ref to a stale name resolves to the root it identified at the time.
        // (If two roots use the same name over a graph construction, the later
        // one wins — matching how the live name map would have resolved it.)
        this.nameHistory.set(name, root);
        const pending = this.pendingByName.get(name);
        if (!pending)
            return;
        this.pendingByName.delete(name);
        for (const ref of pending) {
            if (!(ref instanceof UsageRef))
                continue;
            Object.setPrototypeOf(ref, RootRef.prototype);
            ref.value = root;
        }
    }
    // Resolves every sentinel in the merged rootMap in place. Sweeping the
    // final config (rather than writing through back-references held by the
    // sentinels) covers sentinels that merges copied into arrays other than
    // the one they were created in, e.g. a pattern target's dependsOn applied
    // to every matching target. Called once after all plugin results have
    // been merged.
    applySubstitutions(rootMap) {
        const nameByRoot = {};
        for (const root in rootMap) {
            nameByRoot[root] = rootMap[root]?.name;
        }
        for (const root in rootMap) {
            const targets = rootMap[root]?.targets;
            if (!targets)
                continue;
            for (const targetName in targets) {
                const targetConfig = targets[targetName];
                if (!targetConfig || typeof targetConfig !== 'object')
                    continue;
                if (Array.isArray(targetConfig.inputs)) {
                    this.substituteInArray(targetConfig.inputs, nameByRoot);
                }
                if (Array.isArray(targetConfig.dependsOn)) {
                    this.substituteInArray(targetConfig.dependsOn, nameByRoot);
                }
            }
        }
        this.pendingByName.clear();
        this.nameHistory.clear();
    }
    substituteInArray(entries, nameByRoot) {
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (isNameRef(entry)) {
                const finalName = this.resolveFinalName(entry, nameByRoot);
                if (finalName !== undefined) {
                    entries[i] =
                        entry.targetPart !== undefined
                            ? `${finalName}:${entry.targetPart}`
                            : finalName;
                }
                continue;
            }
            if (!entry || typeof entry !== 'object' || !('projects' in entry)) {
                continue;
            }
            const element = entry;
            if (isNameRef(element.projects)) {
                const finalName = this.resolveFinalName(element.projects, nameByRoot);
                if (finalName !== undefined) {
                    element.projects = finalName;
                }
            }
            else if (Array.isArray(element.projects)) {
                const projects = element.projects;
                for (let j = 0; j < projects.length; j++) {
                    const name = projects[j];
                    if (!isNameRef(name))
                        continue;
                    const finalName = this.resolveFinalName(name, nameByRoot);
                    if (finalName !== undefined) {
                        projects[j] = finalName;
                    }
                }
            }
        }
    }
    resolveFinalName(ref, nameByRoot) {
        if (ref instanceof RootRef) {
            return nameByRoot[ref.value];
        }
        // Unpromoted forward ref — best effort, fall back to the written name.
        return this.getNameMap()[ref.value]?.name ?? ref.value;
    }
}
exports.ProjectNameInNodePropsManager = ProjectNameInNodePropsManager;
