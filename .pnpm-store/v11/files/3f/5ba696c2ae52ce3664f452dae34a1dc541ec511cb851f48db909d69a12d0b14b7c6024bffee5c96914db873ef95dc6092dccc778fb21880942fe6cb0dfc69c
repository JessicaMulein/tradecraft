"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegerLikeSpreadKeyError = exports.INTEGER_LIKE_KEY_PATTERN = exports.NX_SPREAD_TOKEN = void 0;
exports.uniqueKeysInObjects = uniqueKeysInObjects;
exports.assertNoIntegerLikeSpreadKey = assertNoIntegerLikeSpreadKey;
exports.getMergeValueResult = getMergeValueResult;
const source_maps_1 = require("./source-maps");
exports.NX_SPREAD_TOKEN = '...';
/**
 * Returns the union of keys across every provided object.
 */
function uniqueKeysInObjects(...objs) {
    const keys = new Set();
    for (const obj of objs) {
        if (obj) {
            for (const key of Object.keys(obj)) {
                keys.add(key);
            }
        }
    }
    return keys;
}
// Integer-like string keys (`"0"`, `"42"`) are enumerated before
// insertion-order keys, so we can't tell if they were authored before or
// after `'...'`. Spread sites reject them instead of guessing.
exports.INTEGER_LIKE_KEY_PATTERN = /^(0|[1-9]\d*)$/;
class IntegerLikeSpreadKeyError extends Error {
    constructor(key, context) {
        super(`${context} uses an integer-like key (${JSON.stringify(key)}) alongside the '...' spread token. Integer-like keys are enumerated before other keys regardless of authored order, so their position relative to '...' is ambiguous. Rename the key (e.g. add a non-numeric prefix) or restructure the object.`);
        this.name = 'IntegerLikeSpreadKeyError';
    }
}
exports.IntegerLikeSpreadKeyError = IntegerLikeSpreadKeyError;
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
function assertNoIntegerLikeSpreadKey(value, errorContext) {
    if (!isObject(value) || value[exports.NX_SPREAD_TOKEN] !== true) {
        return;
    }
    const keys = Object.keys(value);
    if (keys[0] && exports.INTEGER_LIKE_KEY_PATTERN.test(keys[0])) {
        throw new IntegerLikeSpreadKeyError(keys[0], errorContext);
    }
}
/**
 * `"..."` in `newValue` (as an array element or a key set to `true`)
 * expands the base at that position; otherwise `newValue` replaces
 * `baseValue`. With `deferSpreadsWithoutBase`, an unresolvable spread is
 * preserved so a later merge layer can expand it.
 */
function getMergeValueResult(baseValue, newValue, sourceMapContext, deferSpreadsWithoutBase) {
    if (newValue === undefined && baseValue !== undefined) {
        return baseValue;
    }
    if (Array.isArray(newValue)) {
        return mergeArrayValue(baseValue, newValue, sourceMapContext, deferSpreadsWithoutBase);
    }
    if (isObject(newValue) && newValue[exports.NX_SPREAD_TOKEN] === true) {
        return mergeObjectWithSpread(baseValue, newValue, sourceMapContext, deferSpreadsWithoutBase);
    }
    // Scalar / null / plain object replace — newValue fully wins.
    // Only (re)attribute when the value actually changes. A no-op primitive
    // replace — e.g. a target default that re-stamps the `executor`/`command` a
    // plugin already set, purely as a merge guard — must not steal provenance
    // from the layer that introduced the value. A genuinely new value (no base,
    // or a different one) still attributes to the new layer.
    //
    // The exception cuts the other way too: when the *existing* attribution is a
    // target-defaults stamp (TD merges before the plugin whose value it
    // predicted, so its stamp lands first), a real plugin re-stating that value
    // is the genuine author and reclaims the key.
    if (!isUnchangedPrimitive(newValue, baseValue) ||
        isReclaimableTargetDefaultsStamp(sourceMapContext)) {
        writeTopLevelSourceMap(sourceMapContext);
    }
    return newValue;
}
// Whether the key's current attribution is a weak target-defaults stamp that
// the (non-target-defaults) writer should reclaim despite the value being
// unchanged.
function isReclaimableTargetDefaultsStamp(ctx) {
    return (!!ctx &&
        ctx.sourceMap[ctx.key]?.[1] === source_maps_1.TARGET_DEFAULTS_PLUGIN_NAME &&
        ctx.sourceInformation[1] !== source_maps_1.TARGET_DEFAULTS_PLUGIN_NAME);
}
// Whether `newValue` leaves a defined primitive base untouched. Objects fall
// through (always re-attributed) to preserve the existing replace semantics —
// the regression this guards is scalar executor/command re-stamping.
function isUnchangedPrimitive(newValue, baseValue) {
    return (baseValue !== undefined &&
        (typeof newValue !== 'object' || newValue === null) &&
        Object.is(newValue, baseValue));
}
function mergeArrayValue(baseValue, newValue, sourceMapContext, deferSpreadsWithoutBase) {
    const newSpreadIndex = newValue.findIndex((v) => v === exports.NX_SPREAD_TOKEN);
    if (newSpreadIndex === -1) {
        // No spread: newValue replaces baseValue entirely.
        if (sourceMapContext) {
            for (let i = 0; i < newValue.length; i++) {
                sourceMapContext.sourceMap[`${sourceMapContext.key}.${i}`] =
                    sourceMapContext.sourceInformation;
            }
        }
        writeTopLevelSourceMap(sourceMapContext);
        return newValue;
    }
    const baseArray = Array.isArray(baseValue) ? baseValue : [];
    // Snapshot per-index base sources before we start writing — the loop
    // writes into the same `${key}.${i}` entries it needs to read back when
    // the spread expands. Unlike object spread, array spreads can overwrite
    // indices during their own expansion (when new authors a prefix before
    // `'...'`), so lazy capture isn't sufficient here.
    const basePerIndexSources = sourceMapContext
        ? baseArray.map((_, i) => (0, source_maps_1.readArrayItemSourceInfo)(sourceMapContext.sourceMap, sourceMapContext.key, i))
        : [];
    const result = [];
    const recordAt = (resultIdx, info) => {
        if (sourceMapContext && info) {
            sourceMapContext.sourceMap[`${sourceMapContext.key}.${resultIdx}`] = info;
        }
    };
    for (let newValueIndex = 0; newValueIndex < newValue.length; newValueIndex++) {
        const element = newValue[newValueIndex];
        if (element === exports.NX_SPREAD_TOKEN) {
            if (deferSpreadsWithoutBase && baseValue === undefined) {
                recordAt(result.length, sourceMapContext?.sourceInformation);
                result.push(exports.NX_SPREAD_TOKEN);
            }
            else {
                for (let baseIndex = 0; baseIndex < baseArray.length; baseIndex++) {
                    recordAt(result.length, basePerIndexSources[baseIndex]);
                    result.push(baseArray[baseIndex]);
                }
            }
            continue;
        }
        recordAt(result.length, sourceMapContext?.sourceInformation);
        result.push(element);
    }
    writeTopLevelSourceMap(sourceMapContext);
    return result;
}
function mergeObjectWithSpread(baseValue, newValue, sourceMapContext, deferSpreadsWithoutBase) {
    const baseObj = isObject(baseValue) ? baseValue : {};
    const result = {};
    const errorContext = sourceMapContext?.key
        ? `Object at "${sourceMapContext.key}"`
        : 'Object';
    // Integer-like keys are hoisted to the front of enumeration, so one
    // alongside `'...'` makes its authored position ambiguous.
    assertNoIntegerLikeSpreadKey(newValue, errorContext);
    const newKeys = Object.keys(newValue);
    // Base per-key sources captured lazily — only for shared keys the new
    // object overwrites before `'...'`, since writing their new source
    // clobbers the base entry the spread will need to restore.
    const capturedBaseSources = {};
    for (const newKey of newKeys) {
        if (newKey === exports.NX_SPREAD_TOKEN) {
            if (deferSpreadsWithoutBase && baseValue === undefined) {
                // Keep the sentinel for a later merge layer to resolve.
                result[exports.NX_SPREAD_TOKEN] = true;
                continue;
            }
            for (const baseKey of Object.keys(baseObj)) {
                result[baseKey] = baseObj[baseKey];
                if (sourceMapContext) {
                    // If we captured a shared key pre-spread, use that; otherwise
                    // the source map still holds the base entry untouched.
                    const baseSource = Object.prototype.hasOwnProperty.call(capturedBaseSources, baseKey)
                        ? capturedBaseSources[baseKey]
                        : (0, source_maps_1.readObjectPropertySourceInfo)(sourceMapContext.sourceMap, sourceMapContext.key, baseKey);
                    if (baseSource) {
                        sourceMapContext.sourceMap[`${sourceMapContext.key}.${baseKey}`] =
                            baseSource;
                    }
                }
            }
            continue;
        }
        // About to overwrite a base key's source — capture it first so the
        // spread can restore it.
        if (sourceMapContext &&
            newKey in baseObj &&
            !Object.prototype.hasOwnProperty.call(capturedBaseSources, newKey)) {
            capturedBaseSources[newKey] = (0, source_maps_1.readObjectPropertySourceInfo)(sourceMapContext.sourceMap, sourceMapContext.key, newKey);
        }
        result[newKey] = newValue[newKey];
        if (sourceMapContext) {
            sourceMapContext.sourceMap[`${sourceMapContext.key}.${newKey}`] =
                sourceMapContext.sourceInformation;
        }
    }
    writeTopLevelSourceMap(sourceMapContext);
    return result;
}
function writeTopLevelSourceMap(ctx) {
    if (ctx) {
        ctx.sourceMap[ctx.key] = ctx.sourceInformation;
    }
}
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
