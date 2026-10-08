import { ProjectConfiguration } from '../../../config/workspace-json-project-json';
/**
 * Sentinel placed in `inputs` / `dependsOn` for a pending project-name
 * reference. `RootRef` carries the referenced project's root (resolved
 * via nameMap lookup); `UsageRef` carries the raw written name (for
 * forward refs, promoted to `RootRef` in place when the name is
 * identified). `targetPart` preserves the `:target` suffix from
 * `dependsOn` strings.
 */
export declare abstract class NameRef {
    value: string;
    targetPart: string | undefined;
    constructor(value: string, targetPart: string | undefined);
}
export declare class RootRef extends NameRef {
}
export declare class UsageRef extends NameRef {
}
export declare function isNameRef(value: unknown): value is NameRef;
export declare function isRootRef(value: unknown): value is RootRef;
export declare function isUsageRef(value: unknown): value is UsageRef;
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
export declare class ProjectNameInNodePropsManager {
    private getNameMap;
    private pendingByName;
    private nameHistory;
    constructor(getNameMap?: () => Record<string, ProjectConfiguration>);
    registerNameRefs(pluginResultProjects?: Record<string, Omit<ProjectConfiguration, 'root'> & Partial<ProjectConfiguration>>): void;
    private processInputs;
    private processDependsOn;
    private processProjectsArray;
    private createRef;
    identifyProjectWithRoot(root: string, name: string): void;
    applySubstitutions(rootMap: Record<string, ProjectConfiguration>): void;
    private substituteInArray;
    private resolveFinalName;
}
