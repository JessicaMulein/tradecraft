import { NormalizedTargetDefaults, NxJsonConfiguration, TargetDefaults } from '../../../config/nx-json';
import { ProjectConfiguration, TargetConfiguration } from '../../../config/workspace-json-project-json';
import type { ProjectGraphProjectNode } from '../../../config/project-graph';
import type { CreateNodesResult } from '../../plugins/public-api';
import { ConfigurationSourceMaps } from './source-maps';
type CreateNodesResultEntry = readonly [
    plugin: string,
    file: string,
    result: CreateNodesResult,
    pluginIndex?: number
];
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
export declare function createTargetDefaultsResults(specifiedPluginRootMap: Record<string, ProjectConfiguration>, defaultPluginRootMap: Record<string, ProjectConfiguration>, nxJsonConfiguration: NxJsonConfiguration, specifiedSourceMaps?: ConfigurationSourceMaps): CreateNodesResultEntry[];
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
export declare function readTargetDefaultsForTarget(targetName: string, targetDefaults: TargetDefaults | undefined, executor?: string, opts?: {
    projectName?: string;
    projectNode?: ProjectGraphProjectNode;
    sourcePlugin?: string;
    command?: string;
}): Partial<TargetConfiguration> | null;
/**
 * Normalize the public `targetDefaults` map to the internal shape: every
 * key's value becomes an array of entries (a bare object → a single catch-all
 * entry).
 */
export declare function normalizeTargetDefaults(raw: TargetDefaults | undefined): NormalizedTargetDefaults;
export {};
