"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_INPUTS = void 0;
exports.compatibleDefaultsEntries = compatibleDefaultsEntries;
exports.lastMatchingInputsSupplier = lastMatchingInputsSupplier;
exports.namedFilesets = namedFilesets;
exports.resolveDefaultsExecutor = resolveDefaultsExecutor;
exports.selectDefaultsKey = selectDefaultsKey;
const internal_1 = require("@nx/devkit/internal");
// what nx hashes for a target that declares no `inputs`
exports.DEFAULT_INPUTS = ['default', '^default'];
/**
 * The `targetDefaults` entries under the selected key that survive nx's own
 * per-entry compatibility guard. Graph construction selects the key, then drops
 * each entry whose identity is incompatible with the target's *original* one and
 * keeps the compatible siblings (`createTargetDefaultsResults` in nx's
 * target-defaults). Reading the key unfiltered instead would let a
 * foreign-executor entry contribute outputs the target never gets.
 */
function compatibleDefaultsEntries(ref, selectedKey, targetDefaults) {
    if (!targetDefaults || selectedKey === null) {
        return [];
    }
    const value = targetDefaults[selectedKey];
    return (Array.isArray(value) ? value : [value]).filter((entry) => 
    // `isCompatibleTarget` against the target's own executor. Falsy rather than
    // nullish, matching `resolveCommandSyntacticSugar` and `isCompatibleTarget`,
    // which read an empty string as no identity at all; an executor-less target
    // has no identity to clash with, so every entry survives, as it does there.
    !ref.matcherExecutor
        ? true
        : !entry.command &&
            (!entry.executor || entry.executor === ref.matcherExecutor));
}
/**
 * The last entry under the selected key that both matches the target (the
 * entry's own filter included) and declares `inputs`: the runtime merge makes
 * that entry's array the one the target inherits. A later entry that declares
 * `inputs` behind a filter not matching this target supplies some other
 * target's array, so it cannot be the layer to mutate.
 */
function lastMatchingInputsSupplier(ref, selectedKey, entries) {
    return [...entries].reverse().find((entry) => entry.inputs !== undefined &&
        (0, internal_1.readTargetDefaultsForTarget)(ref.targetName, { [selectedKey]: [entry] }, ref.matcherExecutor, {
            projectName: ref.projectName,
            projectNode: ref.projectNode,
            sourcePlugin: ref.sourcePlugin,
        }) !== null);
}
/** The plain filesets an inputs array names, for a containment check. */
function namedFilesets(inputs) {
    return new Set((inputs ?? []).filter((input) => typeof input === 'string'));
}
/**
 * The executor an executor-less target ends up with after its selected
 * defaults key applies. Each matching entry's identity is resolved like the
 * runtime does at merge time: a `command` payload means nx:run-commands, and
 * a later entry's identity replaces an earlier, incompatible one (the reader's
 * merged view keeps the first executor instead, so it cannot be used here).
 */
function resolveDefaultsExecutor(targetName, projectName, projectNode, targetDefaults, executorKeyCandidate) {
    if (!targetDefaults) {
        return undefined;
    }
    const ref = {
        targetName,
        projectName,
        projectNode,
        matcherExecutor: undefined,
    };
    const key = selectDefaultsKey(ref, targetDefaults, executorKeyCandidate);
    if (key === null) {
        return undefined;
    }
    // like the runtime merge, a later matching entry's identity (a `command`
    // payload means nx:run-commands) replaces an earlier, incompatible one
    const value = targetDefaults[key];
    let executor;
    for (const entry of Array.isArray(value) ? value : [value]) {
        if ((0, internal_1.readTargetDefaultsForTarget)(targetName, { [key]: [entry] }, undefined, {
            projectName,
            projectNode,
        }) === null) {
            continue;
        }
        const identity = entry.command ? 'nx:run-commands' : entry.executor;
        if (identity) {
            executor = identity;
        }
    }
    return executor;
}
/**
 * The `targetDefaults` key nx's runtime would select for this target: keys
 * are tried as the executor key, the exact-name key, then glob keys longest
 * first, and the first whose entries produce a match wins; the rest are
 * shadowed. Resolution per key goes through nx's own reader. Non-matching
 * keys never resolve, so sorting all remaining keys by length stands in for
 * the runtime's glob-only ordering.
 */
function selectDefaultsKey(ref, targetDefaults, executorKeyCandidate) {
    const resolves = (key) => (0, internal_1.readTargetDefaultsForTarget)(ref.targetName, { [key]: targetDefaults[key] }, ref.matcherExecutor, {
        projectName: ref.projectName,
        projectNode: ref.projectNode,
        sourcePlugin: ref.sourcePlugin,
    }) !== null;
    if (executorKeyCandidate &&
        targetDefaults[executorKeyCandidate] &&
        resolves(executorKeyCandidate)) {
        return executorKeyCandidate;
    }
    if (targetDefaults[ref.targetName] &&
        ref.targetName !== executorKeyCandidate &&
        resolves(ref.targetName)) {
        return ref.targetName;
    }
    const globCandidates = Object.keys(targetDefaults)
        .filter((key) => key !== executorKeyCandidate && key !== ref.targetName)
        .sort((a, b) => b.length - a.length);
    for (const key of globCandidates) {
        if (resolves(key)) {
            return key;
        }
    }
    return null;
}
