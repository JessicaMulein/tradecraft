"use strict";
// Source map keys are dot-delimited paths into a ProjectConfiguration,
// e.g. `targets.build.inputs.0.projects`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TARGET_DEFAULTS_PLUGIN_NAME = void 0;
exports.recordTargetIdentitySourceMapInfo = recordTargetIdentitySourceMapInfo;
exports.forEachSourceMapKeyForArray = forEachSourceMapKeyForArray;
exports.readArrayItemSourceInfo = readArrayItemSourceInfo;
exports.readObjectPropertySourceInfo = readObjectPropertySourceInfo;
exports.recordSourceMapInfo = recordSourceMapInfo;
exports.recordSourceMapKeysByIndex = recordSourceMapKeysByIndex;
exports.targetSourceMapKey = targetSourceMapKey;
exports.targetOptionSourceMapKey = targetOptionSourceMapKey;
exports.targetConfigurationsSourceMapKey = targetConfigurationsSourceMapKey;
/**
 * The synthetic plugin name target-defaults results are attributed to. Shared
 * so the merge can recognize a target-defaults stamp when reconciling
 * provenance — target defaults never genuinely author a target's existence or
 * its executor/command, so such a stamp must not overwrite a real plugin's
 * attribution for those keys.
 */
exports.TARGET_DEFAULTS_PLUGIN_NAME = 'nx/target-defaults';
/**
 * Write the source for the target node key (`targets.<name>`). Ownership of a
 * target follows its identity, not the last writer:
 *
 *  - An unowned key goes to whoever writes it first (the creator).
 *  - A target-defaults stamp is weak — it never authors a target's existence,
 *    so any real plugin reclaims the key from it, and it can never take the
 *    key from a real plugin.
 *  - Between real plugins, the key only changes hands when the merge changed
 *    the target's identity (executor/command) — a plugin that merely layers
 *    fields (dependsOn, options, …) onto an existing target does not become
 *    its owner.
 */
function recordTargetIdentitySourceMapInfo(sourceMap, key, sourceInfo, identityChanged = false) {
    const existing = sourceMap[key];
    if (existing === undefined) {
        sourceMap[key] = sourceInfo;
        return;
    }
    if (sourceInfo[1] === exports.TARGET_DEFAULTS_PLUGIN_NAME) {
        return;
    }
    if (existing[1] === exports.TARGET_DEFAULTS_PLUGIN_NAME || identityChanged) {
        sourceMap[key] = sourceInfo;
    }
}
// Iterates `${prefixKey}.0`, `${prefixKey}.1`, ... for each index of `array`.
function forEachSourceMapKeyForArray(prefixKey, array, callback, startIndex = 0) {
    for (let i = startIndex; i < array.length; i++) {
        callback(`${prefixKey}.${i}`, i);
    }
}
// Reads per-index source info, falling back to the array's top-level entry.
function readArrayItemSourceInfo(sourceMap, arrayKey, itemIndex) {
    return sourceMap[`${arrayKey}.${itemIndex}`] ?? sourceMap[arrayKey];
}
// Reads per-property source info, falling back to the object's top-level entry.
function readObjectPropertySourceInfo(sourceMap, objectKey, propertyKey) {
    return sourceMap[`${objectKey}.${propertyKey}`] ?? sourceMap[objectKey];
}
function recordSourceMapInfo(sourceMap, key, sourceInfo) {
    sourceMap[key] = sourceInfo;
}
// Records the same source info under every `${prefixKey}.${i}` entry.
function recordSourceMapKeysByIndex(sourceMap, prefixKey, array, sourceInfo, startIndex = 0) {
    forEachSourceMapKeyForArray(prefixKey, array, (key) => recordSourceMapInfo(sourceMap, key, sourceInfo), startIndex);
}
function targetSourceMapKey(targetName) {
    return `targets.${targetName}`;
}
function targetOptionSourceMapKey(targetName, optionKey) {
    return `targets.${targetName}.options.${optionKey}`;
}
function targetConfigurationsSourceMapKey(targetName, configurationName, configurationKey) {
    let key = `targets.${targetName}.configurations`;
    if (configurationName) {
        key += `.${configurationName}`;
    }
    if (configurationKey) {
        key += `.${configurationKey}`;
    }
    return key;
}
