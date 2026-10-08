import { type NxJsonConfiguration, type TargetConfiguration, type TargetDefaultEntry, type TargetDefaultFilter, type TargetDefaults, type Tree } from 'nx/src/devkit-exports';
import { readTargetDefaultsForTarget as readTargetDefaultsForTargetFromNx } from 'nx/src/devkit-internals';
/**
 * Upsert a `targetDefaults` entry on the provided `nxJson`. Mutates
 * `nxJson` in place and returns it so the caller can chain or batch
 * other edits before persisting via `updateNxJson` exactly once.
 *
 * The input is the logical {@link TargetDefaultEntry} shape
 * (`{ target?, executor?, projects?, plugin?, ...config }`). The `projects` /
 * `plugin` filter is *context* describing what the caller is configuring, used
 * to pick which existing entry to merge into — it is never authored as a new
 * filtered entry. For the key (`target` ?? `executor`):
 *
 * - No value yet → create the generic (plain object) value.
 * - Only a generic value → merge into it.
 * - A filtered entry matching the context filter exists → merge into that one
 *   (so a caller updating a project the user already scoped a default for edits
 *   that scoped entry rather than clobbering the workspace baseline).
 * - Otherwise → merge into the generic, creating one if needed.
 *
 * A lone unfiltered entry is always stored as a plain object, never a
 * single-element array. The entry must set at least one of `target` /
 * `executor`.
 */
export declare function upsertTargetDefault(tree: Tree, nxJson: NxJsonConfiguration, options: TargetDefaultEntry): NxJsonConfiguration;
/**
 * Find a `targetDefaults` entry by its logical locator tuple
 * `(target, executor, projects, plugin)`. Locator keys default to
 * `undefined`, matching only entries that also leave them unset — same
 * semantics as `upsertTargetDefault`.
 *
 * Throws when called with an empty locator (no `target`, `executor`,
 * `projects`, or `plugin`). An empty locator is almost always a bug — the
 * caller intended to find a specific entry but forgot to populate the lookup.
 */
export declare function findTargetDefault(targetDefaults: TargetDefaults | undefined, locator: Pick<TargetDefaultEntry, 'target' | 'executor' | 'projects' | 'plugin'>): TargetDefaultEntry | undefined;
/**
 * Shape-level test: whether a `targetDefaults` key is a plain target name
 * rather than executor-shaped (`a:b`) or a glob. Executor strings are not
 * required to contain `:`, so a plain-named key can still resolve as an
 * executor key when some target's effective executor equals it; callers
 * needing that guarantee must exclude executor collisions themselves.
 */
export declare function isExactTargetNameKey(key: string): boolean;
/**
 * The subset of a project graph node that the `projects` narrowing reads —
 * names come from the map keys, `root`/`tags` drive `findMatchingProjects`.
 * Mirrors `MatcherProjectNode` without importing it, so the signature stays
 * stable across the supported nx version range.
 */
type ContextProjectNode = {
    data: {
        root: string;
        tags?: string[];
    };
};
/**
 * What the caller is updating, used to pick which `targetDefaults` entries the
 * callback runs against. At least one of `executor` / `projects` is required.
 */
export interface UpdateTargetDefaultContext {
    /**
     * Visit only entries that resolve to this executor — matched against the map
     * key (executor-keyed form), an entry's `executor` field, or its
     * `filter.executor`. When omitted, entries are not filtered by executor.
     */
    executor?: string;
    /**
     * Project nodes the update is scoped to, keyed by project name. When set, a
     * project-filtered entry is visited only if its `filter.projects` covers
     * *every* one of these projects; unfiltered entries always match. When
     * omitted, project filters are not a constraint and every (executor-matching)
     * entry is visited — the workspace-wide case.
     */
    projects?: Record<string, ContextProjectNode>;
}
/**
 * Describes the entry a callback invocation is operating on, so the callback
 * can tell the executor-keyed form from the target-keyed form and read the
 * entry's filter.
 */
export interface UpdateTargetDefaultEntryInfo {
    /** The `targetDefaults` map key the entry lives under. */
    key: string;
    /** Logical target name — `undefined` for executor-keyed entries. */
    target?: string;
    /** Executor the entry resolves to (from the key, `executor` field, or filter). */
    executor?: string;
    /** The entry's filter, present only for filtered array entries. */
    filter?: TargetDefaultFilter;
}
/**
 * Called once per matching entry. Receives the entry's flat config (everything
 * but `filter`) and may mutate it in place. Return a new config to replace the
 * entry's payload, return `null` to drop the entry, or return nothing to keep
 * the (possibly mutated) config.
 */
export type UpdateTargetDefaultCallback = (config: Partial<TargetConfiguration>, info: UpdateTargetDefaultEntryInfo) => Partial<TargetConfiguration> | null | void;
/**
 * Walk the `targetDefaults` entries matching `context` and run `callback`
 * against each, mutating `nxJson` in place and returning it. This is the
 * read-modify-write counterpart to {@link upsertTargetDefault}, meant for
 * generators and migrations that need to edit *existing* defaults across both
 * value forms (plain object and filtered array) without re-implementing the
 * normalize → edit → collapse dance by hand.
 *
 * Matching, per the `context`:
 * - `executor` selects entries that reference it as the map key, an `executor`
 *   config field, or `filter.executor`.
 * - `projects` narrows to entries whose `filter.projects` covers the scoped
 *   projects (unfiltered entries always match). With no `projects` context,
 *   project filters are ignored and every executor-matching entry is visited.
 *
 * Removal and collapsing follow the storage-form rules:
 * - Array entry whose callback returns `null` → dropped from the array.
 * - An array that collapses to a single unfiltered entry → stored as the plain
 *   object form; an emptied array → the whole key is deleted.
 * - Object-form value whose callback returns `null` → the whole key is deleted.
 * - An emptied `targetDefaults` map → removed from `nxJson` entirely.
 *
 * Throws when neither `executor` nor `projects` is provided — an empty context
 * would match everything and is almost always a bug.
 */
export declare function updateTargetDefault(nxJson: NxJsonConfiguration, context: UpdateTargetDefaultContext, callback: UpdateTargetDefaultCallback): NxJsonConfiguration;
export declare function readTargetDefaultsForTarget(targetName: string, targetDefaults: TargetDefaults | undefined, executor?: string, opts?: Parameters<typeof readTargetDefaultsForTargetFromNx>[3]): Partial<TargetConfiguration> | null;
export declare function addBuildTargetDefaults(tree: Tree, executorName: string, buildTargetName?: string, extraInputs?: TargetConfiguration['inputs']): void;
export declare function addE2eCiTargetDefaults(tree: Tree, e2ePlugin: string, buildTarget: string, pathToE2EConfigFile: string): Promise<void>;
export {};
