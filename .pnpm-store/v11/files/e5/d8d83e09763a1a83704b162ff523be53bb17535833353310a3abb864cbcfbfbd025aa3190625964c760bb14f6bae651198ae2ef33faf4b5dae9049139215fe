import type { ProjectGraphProjectNode } from '../config/project-graph';
/**
 * The subset of a {@link ProjectGraphProjectNode} that `findMatchingProjects`
 * needs. Project names come from the map keys, so only `data.root` and
 * `data.tags` are read per node — callers may pass full nodes or this slice.
 */
export type MatcherProjectNode = {
    data: Pick<ProjectGraphProjectNode['data'], 'root' | 'tags'>;
};
/**
 * Find matching project names given a list of potential project names or globs.
 *
 * @param patterns A list of project names or globs to match against.
 * @param projects A map of {@link MatcherProjectNode} by project name.
 * @returns
 */
export declare function findMatchingProjects(patterns: string[], projects: Record<string, MatcherProjectNode>): string[];
export declare const getMatchingStringsWithCache: (pattern: string, items: string[]) => string[];
