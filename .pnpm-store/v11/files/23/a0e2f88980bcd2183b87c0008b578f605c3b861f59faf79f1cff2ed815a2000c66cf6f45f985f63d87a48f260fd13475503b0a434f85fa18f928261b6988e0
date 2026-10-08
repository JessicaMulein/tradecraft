import type { NxJsonConfiguration } from '../../../config/nx-json';
import type { ProjectGraph } from '../../../config/project-graph';
import type { ConfigurationSourceMaps } from '../../../project-graph/utils/project-configuration/source-maps';
import type { ShowTargetBaseOptions, ShowTargetInputsOptions } from '../command-object';
export interface ResolvedTarget {
    graph: ProjectGraph;
    nxJson: NxJsonConfiguration;
    projectName: string;
    targetName: string;
    configuration: string | undefined;
    node: ProjectGraph['nodes'][string];
    sourceMaps?: ConfigurationSourceMaps;
}
export declare function resolveTarget(args: ShowTargetBaseOptions | ShowTargetInputsOptions, opts?: {
    withSourceMaps?: boolean;
}): Promise<ResolvedTarget>;
/**
 * Checks whether a target's executor defines a custom hasher.
 * Returns true if the executor has a hasherFactory — meaning the
 * standard input-based hashing is bypassed for this target.
 */
export declare function hasCustomHasher(projectName: string, targetName: string, graph: ProjectGraph): boolean;
export declare function normalizePath(p: string): string;
export declare function deduplicateFolderEntries(items: string[]): string[];
export declare function pc(): any;
export declare function printList(header: string, items: unknown[], prefix?: string): void;
export declare function printJson(data: Record<string, unknown>): void;
/** The paths that live under `dir`. An empty `dir` is the workspace root. */
export declare function pathsUnder(dir: string, paths: string[]): string[];
export interface CheckResult {
    /** The argument as the user typed it. */
    value: string;
    /** Workspace-relative form of `value`. */
    file: string;
    matched: boolean;
    /** Which rule matched, when the caller can name one. */
    category?: string;
    /** Matches found underneath `value`, when it is a directory. */
    contained: string[];
}
declare const NOUNS: {
    readonly input: {
        readonly preposition: 'for';
        readonly contained: 'input file';
    };
    readonly output: {
        readonly preposition: 'of';
        readonly contained: 'output path';
    };
};
type CheckNoun = keyof typeof NOUNS;
export declare function renderCheckResults(results: CheckResult[], project: string, target: string, noun: CheckNoun): void;
export declare function setCheckExitCode(results: CheckResult[]): void;
export {};
