import type { ProjectGraphProjectNode, TargetConfiguration, TargetDefaultArrayEntry, TargetDefaults } from '@nx/devkit';
export declare const DEFAULT_INPUTS: string[];
/** Everything the runtime's `targetDefaults` matcher needs to resolve a target. */
export interface DefaultsMatchContext {
    targetName: string;
    projectName: string;
    projectNode: ProjectGraphProjectNode;
    matcherExecutor: string | undefined;
    sourcePlugin?: string;
}
export interface MatchedTargetRef extends DefaultsMatchContext {
    target: TargetConfiguration;
}
/**
 * A matched target with the `targetDefaults` key the runtime would resolve for
 * it, carried together so the two cannot fall out of step.
 */
export interface KeyedTargetRef {
    ref: MatchedTargetRef;
    selectedKey: string | null;
}
/**
 * The `targetDefaults` entries under the selected key that survive nx's own
 * per-entry compatibility guard. Graph construction selects the key, then drops
 * each entry whose identity is incompatible with the target's *original* one and
 * keeps the compatible siblings (`createTargetDefaultsResults` in nx's
 * target-defaults). Reading the key unfiltered instead would let a
 * foreign-executor entry contribute outputs the target never gets.
 */
export declare function compatibleDefaultsEntries(ref: MatchedTargetRef, selectedKey: string | null, targetDefaults: TargetDefaults | undefined): TargetDefaultArrayEntry[];
/**
 * The last entry under the selected key that both matches the target (the
 * entry's own filter included) and declares `inputs`: the runtime merge makes
 * that entry's array the one the target inherits. A later entry that declares
 * `inputs` behind a filter not matching this target supplies some other
 * target's array, so it cannot be the layer to mutate.
 */
export declare function lastMatchingInputsSupplier(ref: MatchedTargetRef, selectedKey: string, entries: TargetDefaultArrayEntry[]): TargetDefaultArrayEntry | undefined;
/** The plain filesets an inputs array names, for a containment check. */
export declare function namedFilesets(inputs: TargetConfiguration['inputs']): ReadonlySet<string>;
/**
 * The executor an executor-less target ends up with after its selected
 * defaults key applies. Each matching entry's identity is resolved like the
 * runtime does at merge time: a `command` payload means nx:run-commands, and
 * a later entry's identity replaces an earlier, incompatible one (the reader's
 * merged view keeps the first executor instead, so it cannot be used here).
 */
export declare function resolveDefaultsExecutor(targetName: string, projectName: string, projectNode: ProjectGraphProjectNode, targetDefaults: TargetDefaults | undefined, executorKeyCandidate?: string): string | undefined;
/**
 * The `targetDefaults` key nx's runtime would select for this target: keys
 * are tried as the executor key, the exact-name key, then glob keys longest
 * first, and the first whose entries produce a match wins; the rest are
 * shadowed. Resolution per key goes through nx's own reader. Non-matching
 * keys never resolve, so sorting all remaining keys by length stands in for
 * the runtime's glob-only ordering.
 */
export declare function selectDefaultsKey(ref: DefaultsMatchContext, targetDefaults: TargetDefaults, executorKeyCandidate?: string): string | null;
