/** [file, plugin] that contributed a configuration property. */
export type SourceInformation = [file: string | null, plugin: string];
/**
 * The synthetic plugin name target-defaults results are attributed to. Shared
 * so the merge can recognize a target-defaults stamp when reconciling
 * provenance — target defaults never genuinely author a target's existence or
 * its executor/command, so such a stamp must not overwrite a real plugin's
 * attribution for those keys.
 */
export declare const TARGET_DEFAULTS_PLUGIN_NAME = "nx/target-defaults";
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
export declare function recordTargetIdentitySourceMapInfo(sourceMap: Record<string, SourceInformation>, key: string, sourceInfo: SourceInformation, identityChanged?: boolean): void;
/** Source map per project root. */
export type ConfigurationSourceMaps = Record<string, Record<string, SourceInformation>>;
export declare function forEachSourceMapKeyForArray(prefixKey: string, array: unknown[], callback: (key: string, index: number) => void, startIndex?: number): void;
export declare function readArrayItemSourceInfo(sourceMap: Record<string, SourceInformation>, arrayKey: string, itemIndex: number): SourceInformation | undefined;
export declare function readObjectPropertySourceInfo(sourceMap: Record<string, SourceInformation>, objectKey: string, propertyKey: string): SourceInformation | undefined;
export declare function recordSourceMapInfo(sourceMap: Record<string, SourceInformation>, key: string, sourceInfo: SourceInformation): void;
export declare function recordSourceMapKeysByIndex(sourceMap: Record<string, SourceInformation>, prefixKey: string, array: unknown[], sourceInfo: SourceInformation, startIndex?: number): void;
export declare function targetSourceMapKey(targetName: string): string;
export declare function targetOptionSourceMapKey(targetName: string, optionKey: string): string;
export declare function targetConfigurationsSourceMapKey(targetName: string, configurationName?: string, configurationKey?: string): string;
