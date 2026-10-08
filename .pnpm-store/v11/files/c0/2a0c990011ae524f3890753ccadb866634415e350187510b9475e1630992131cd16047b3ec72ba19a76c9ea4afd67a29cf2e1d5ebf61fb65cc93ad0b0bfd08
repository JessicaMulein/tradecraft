import { ProjectConfiguration } from '../../../config/workspace-json-project-json';
import type { ConfigurationSourceMaps, SourceInformation } from './source-maps';
export { validateProject } from './target-normalization';
export declare function mergeProjectConfigurationIntoRootMap(projectRootMap: Record<string, ProjectConfiguration>, project: ProjectConfiguration, configurationSourceMaps?: ConfigurationSourceMaps, sourceInformation?: SourceInformation, skipTargetNormalization?: boolean, deferSpreadsWithoutBase?: boolean): {
    nameChanged: boolean;
};
/**
 * The existing target names a glob-pattern target key merges onto. This maps
 * atomized targets to the glob pattern the same way targetDefaults does.
 * Returns an empty array for a non-glob key or a pattern matching nothing;
 * the merge treats those as literal target names.
 */
export declare function findMatchingTargetNames(pattern: string, targetNames: string[]): string[];
export declare function readProjectConfigurationsFromRootMap(projectRootMap: Record<string, ProjectConfiguration>): Record<string, ProjectConfiguration>;
export declare function createRootMap(projectRootMap: Record<string, ProjectConfiguration>): Record<string, string>;
/**
 * Owns the rootMap (root → ProjectConfiguration) and nameMap
 * (name → ProjectConfiguration), coordinating merges with the
 * {@link ProjectNameInNodePropsManager} for deferred name substitutions.
 *
 * The nameMap entries are the *same object references* as the rootMap
 * entries, so when a merge adds targets to a rootMap entry the nameMap
 * entry automatically has them too — no copying, no staleness.
 */
export declare class ProjectNodesManager {
    private rootMap;
    private nameMap;
    private nameSubstitutionManager;
    constructor();
    getRootMap(): Record<string, ProjectConfiguration>;
    /**
     * Merges a project into the rootMap, updates the nameMap, and notifies
     * the substitution manager if the name changed at this root.
     */
    mergeProjectNode(project: ProjectConfiguration, configurationSourceMaps?: ConfigurationSourceMaps, sourceInformation?: SourceInformation): void;
    /**
     * Inserts project-name sentinels into `inputs` and `dependsOn` on the
     * merged objects in this manager's rootMap. Walking the merged entries —
     * not the plugin results — matters because a spread-produced array is a
     * fresh instance, and because sentinels written into plugin-result arrays
     * would corrupt them for any later merge that re-reads the results.
     */
    registerNameRefs(pluginResultProjects?: Record<string, Omit<ProjectConfiguration, 'root'> & Partial<ProjectConfiguration>>): void;
    /**
     * Applies all pending name substitutions. Call once after all plugin
     * results have been merged.
     */
    applySubstitutions(): void;
}
