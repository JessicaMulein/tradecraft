import { NxJsonConfiguration } from '../../config/nx-json';
import { ProjectGraphExternalNode } from '../../config/project-graph';
import { ProjectConfiguration } from '../../config/workspace-json-project-json';
import { AggregateCreateNodesError, MergeNodesError, MultipleProjectsWithSameNameError, ProjectsWithNoNameError, WorkspaceValidityError } from '../error-types';
import type { LoadedNxPlugin } from '../plugins/loaded-nx-plugin';
import { CreateNodesResult } from '../plugins/public-api';
import type { ConfigurationSourceMaps } from './project-configuration/source-maps';
export { mergeTargetConfigurations } from './project-configuration/target-merging';
export { readTargetDefaultsForTarget } from './project-configuration/target-defaults';
export type ConfigurationResult = {
    /**
     * A map of project configurations, keyed by project root.
     */
    projects: {
        [projectRoot: string]: ProjectConfiguration;
    };
    /**
     * Node Name -> Node info
     */
    externalNodes: Record<string, ProjectGraphExternalNode>;
    /**
     * Project Root -> Project Name
     */
    projectRootMap: Record<string, string>;
    sourceMaps: ConfigurationSourceMaps;
    /**
     * The list of files that were used to create project configurations
     */
    matchingProjectFiles: string[];
};
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
export declare function createProjectConfigurationsWithPlugins(root: string, nxJson: NxJsonConfiguration, projectFiles: {
    specifiedPluginFiles: string[][];
    defaultPluginFiles: string[][];
}, plugins: {
    specifiedPlugins: LoadedNxPlugin[];
    defaultPlugins: LoadedNxPlugin[];
}): Promise<ConfigurationResult>;
export type CreateNodesResultEntry = readonly [
    plugin: string,
    file: string,
    result: CreateNodesResult,
    pluginIndex?: number
];
export type MergeError = AggregateCreateNodesError | MergeNodesError | ProjectsWithNoNameError | MultipleProjectsWithSameNameError | WorkspaceValidityError;
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
export declare function mergeCreateNodesResults(specifiedResults: CreateNodesResultEntry[][], defaultResults: CreateNodesResultEntry[][], nxJsonConfiguration: NxJsonConfiguration, workspaceRoot: string, errors: MergeError[]): {
    projectRootMap: Record<string, ProjectConfiguration>;
    externalNodes: Record<string, ProjectGraphExternalNode>;
    rootMap: Record<string, string>;
    configurationSourceMaps: ConfigurationSourceMaps;
};
export declare function findMatchingConfigFiles(projectFiles: string[], include: string[], exclude: string[]): string[];
