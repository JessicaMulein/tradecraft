export declare let unregisterPluginTSTranspiler: (() => void) | null;
/**
 * Register swc-node or ts-node if they are not currently registered
 * with some default settings which work well for Nx plugins.
 *
 * When the runtime supports native TypeScript stripping and the user hasn't
 * opted out, this is a noop - Node loads plugin `.ts` files directly. The
 * lazy fallback in `handleImport` will call `forceRegisterPluginTSTranspiler`
 * if a plugin uses unsupported syntax (enum, runtime namespace, etc.).
 */
export declare function registerPluginTSTranspiler(): void;
/**
 * Always register swc-node or ts-node + tsconfig-paths, ignoring the native
 * strip preference. Called from the fallback path in `handleImport` when a
 * plugin `.ts` file throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` under native
 * stripping.
 */
export declare function forceRegisterPluginTSTranspiler(): void;
export declare function pluginTranspilerIsRegistered(): boolean;
export declare function cleanupPluginTSTranspiler(): void;
