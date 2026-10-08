import { type SourceInformation } from './source-maps';
export declare const NX_SPREAD_TOKEN = "...";
/**
 * Returns the union of keys across every provided object.
 */
export declare function uniqueKeysInObjects(...objs: Array<object | null | undefined>): Set<string>;
export declare const INTEGER_LIKE_KEY_PATTERN: RegExp;
export declare class IntegerLikeSpreadKeyError extends Error {
    constructor(key: string, context: string);
}
/**
 * Throws `IntegerLikeSpreadKeyError` when `value` is a `'...'` spread object
 * whose enumeration hoists an integer-like key ahead of the spread, making its
 * authored position ambiguous.
 *
 * The ambiguity is a property of the authored value alone, not of any merge
 * base. `mergeObjectWithSpread` runs this the moment it merges such a value —
 * but a merge layer that lets the base win a key drops the incoming value
 * without merging it, so the check must also be run eagerly at those
 * base-owns-key shortcuts. Otherwise the error would surface or vanish
 * depending on which side owns the key (e.g. it fires in the target-defaults
 * staging merge but not the real merge), which is exactly the divergence that
 * makes discarding staging errors unsafe.
 */
export declare function assertNoIntegerLikeSpreadKey(value: unknown, errorContext: string): void;
type SourceMapContext = {
    sourceMap: Record<string, SourceInformation>;
    key: string;
    sourceInformation: SourceInformation;
};
/**
 * `"..."` in `newValue` (as an array element or a key set to `true`)
 * expands the base at that position; otherwise `newValue` replaces
 * `baseValue`. With `deferSpreadsWithoutBase`, an unresolvable spread is
 * preserved so a later merge layer can expand it.
 */
export declare function getMergeValueResult<T>(baseValue: unknown, newValue: T | undefined, sourceMapContext?: SourceMapContext, deferSpreadsWithoutBase?: boolean): T | undefined;
export {};
