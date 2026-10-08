import type { TsConfigOptions } from 'ts-node';
import type { CompilerOptions } from 'typescript';
/**
 * Force-register an ESM loader (`@swc-node/register/esm` if available, else
 * `ts-node/esm`) via `Module.register` so dynamic `import()` of TS files
 * goes through a transpiler.
 *
 * **IMPORTANT — global side effect:** `Module.register` is one-shot per
 * process and applies to *every* subsequent ESM resolution in the process.
 * Calling this trades native Node.js TypeScript stripping for transpiled
 * loading on the dynamic-import path for the rest of the run. CJS
 * `require()` is unaffected (different hook), so `.cts` files via require
 * keep using native strip + swc-node's `Module._extensions` hook.
 *
 * Required for the niche case where an ESM config (`.mts` or `.ts` resolved
 * as ESM) combines top-level await with TypeScript syntax that native strip
 * can't handle (`enum`, runtime `namespace`, etc.). TLA forces dynamic
 * `import()`, which bypasses the CJS hook chain - the only way to intercept
 * is `Module.register`.
 *
 * Idempotent: subsequent calls are no-ops.
 *
 * Throws if neither `@swc-node/register` nor `ts-node` is installed.
 */
export declare function forceRegisterEsmLoader(): void;
/**
 * Effective `TS_NODE_COMPILER_OPTIONS` value for `ts-node/esm`. CommonJS emit
 * can never work for the true-ESM loads the loader exists for (`import.meta`
 * fails with TS1343), and CommonJS-format files are deferred to the `require`
 * pipeline untouched, so `module`/`moduleResolution` are forced to `nodenext`
 * over any inherited value. Values that are not a JSON object pass through
 * unchanged for ts-node to handle.
 *
 * Exported so the merge semantics can be exercised directly in unit tests.
 */
export declare function resolveTsNodeEsmCompilerOptions(raw: string | undefined): string;
/**
 * Source of a minimal ESM resolution hook that rewrites TypeScript NodeNext
 * `.js`/`.mjs`/`.cjs` relative specifiers to their `.ts`/`.mts`/`.cts` sources.
 * Inlined as a string so it can be registered as a self-contained `data:`
 * module - it relies only on Node's default resolver (no ts-node/swc-node) and
 * defers loading to Node's native TypeScript stripping. The ESM counterpart to
 * the CJS `ensureCjsResolverPatched`.
 *
 * Only rewrites when the default resolution fails with ERR_MODULE_NOT_FOUND,
 * the importing module is itself TypeScript, and the specifier is relative, so
 * it never hijacks resolution that would otherwise succeed.
 *
 * Used only as the fallback for runtimes without `module.registerHooks()`
 * (Node < 22.15 / < 23.5); newer runtimes register the in-thread synchronous
 * twin `nodeNextEsmResolveHook` instead. Keep the two in sync.
 *
 * Exported so the hook can be exercised directly in unit tests.
 */
export declare const NODENEXT_ESM_RESOLVER_SOURCE = "\nconst EXT_FALLBACK = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };\nconst TS_PARENT_RE = /\\.(?:ts|tsx|mts|cts)(?:$|\\?)/;\nexport async function resolve(specifier, context, nextResolve) {\n  try {\n    return await nextResolve(specifier, context);\n  } catch (err) {\n    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;\n    const parent = context.parentURL;\n    if (!parent || !TS_PARENT_RE.test(parent)) throw err;\n    if (!(specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('file:'))) throw err;\n    const m = specifier.match(/(\\.(?:js|mjs|cjs))($|\\?)/);\n    if (!m) throw err;\n    const fallbacks = EXT_FALLBACK[m[1]];\n    if (!fallbacks) throw err;\n    const base = specifier.slice(0, m.index);\n    const suffix = specifier.slice(m.index + m[1].length);\n    for (const ext of fallbacks) {\n      try { return await nextResolve(base + ext + suffix, context); } catch {}\n    }\n    throw err;\n  }\n}\n";
/**
 * Synchronous in-thread twin of `NODENEXT_ESM_RESOLVER_SOURCE` for
 * `module.registerHooks()`: `nextResolve` throws synchronously rather than
 * rejecting, so this uses try/catch instead of `await`. Keep the two in sync.
 * Exported for unit tests.
 */
export declare function nodeNextEsmResolveHook(specifier: string, context: {
    parentURL?: string;
}, nextResolve: (specifier: string, context?: unknown) => {
    url: string;
}): {
    url: string;
};
/**
 * Register an ESM resolution hook that rewrites TypeScript NodeNext-style
 * `.js`/`.mjs`/`.cjs` relative specifiers to their `.ts`/`.mts`/`.cts` sources.
 * This is the ESM counterpart to `ensureCjsResolverPatched`: Node's native type
 * stripping loads the `.ts` file, but neither native strip nor Node's ESM
 * resolver rewrites the extension, so `import './foo.js'` from a `.ts` source
 * where only `foo.ts` exists fails with ERR_MODULE_NOT_FOUND without it.
 *
 * Prefers `module.registerHooks()` (Node 22.15+ / 23.5+), passing the in-thread
 * `nodeNextEsmResolveHook`. Falls back to `module.register()` with the inlined
 * `data:` module (`NODENEXT_ESM_RESOLVER_SOURCE`) on older runtimes that lack
 * `registerHooks` - `module.register()` emits a runtime DeprecationWarning
 * (DEP0205) on Node 25.9+/26+, so it is only used when nothing better exists.
 * Either way the hook relies only on Node's default resolver - no
 * ts-node/swc-node.
 *
 * Idempotent and best-effort: a no-op when no registration API is available,
 * when a TypeScript transpiler is already preloaded (see
 * `isTsTranspilerPreloaded`), or if registration fails.
 */
export declare function ensureNodeNextEsmResolverRegistered(): void;
/**
 * Patches Node's CJS resolver to fall back from `.js`/`.mjs`/`.cjs` to the
 * corresponding TypeScript source extension (`.ts`/`.tsx`, `.mts`, `.cts`)
 * when the requesting file is itself a `.ts`/`.tsx`/`.mts`/`.cts` source.
 *
 * Required for TypeScript NodeNext-style relative imports: `import './foo.js'`
 * inside a `.ts` file resolves to `./foo.ts` at compile time, but the `.js`
 * specifier survives transpilation to CJS. Node's native CJS resolver doesn't
 * rewrite extensions and there is no officially-supported Node API for this —
 * Node's native strip-types deliberately doesn't either — so a resolver patch
 * is the prevailing solution in the ecosystem (used by `tsx` and ts-node's
 * `experimentalResolver`).
 *
 * Patches `Module._resolveFilename` (not `_findPath`, matching tsx's narrower
 * surface). Gates on the requesting file being TS so vanilla `.js` code
 * requesting missing `.js` files keeps failing — no silent hijack. Only fires
 * the fallback on `MODULE_NOT_FOUND` so existing `.js` resolution is
 * unaffected when both files exist. Idempotent on repeat calls.
 */
export declare function ensureCjsResolverPatched(): void;
/**
 * Make Node's module resolver honor the given export conditions for the rest of
 * the process, via `module.registerHooks()`. Used when a local plugin is loaded
 * from source in-process (no child process to pass `--conditions` to at spawn):
 * the hook appends the conditions to every resolution so the plugin's transitive
 * workspace imports resolve to source the same way the plugin entry did.
 *
 * No-op when:
 *   - `conditions` is empty (nothing to inject);
 *   - every target condition is already active at startup (a spawned plugin
 *     worker or daemon was launched with the full `--conditions` set, so Node's
 *     resolver already honors them and the per-resolve hook would be redundant);
 *   - `module.registerHooks` is unavailable (Node < 22.15 / < 23.5). Those
 *     runtimes keep the `NODE_OPTIONS=--conditions` escape hatch.
 *
 * Idempotent and best-effort.
 */
export declare function ensureResolveConditionsInjected(conditions: string[]): void;
/**
 * Whether Nx will defer to Node's native TypeScript stripping for the next
 * `.ts` load. Mirrors the gate used by `loadTsFile`/`registerTsProject` so
 * other registration sites (e.g. plugin transpiler) can stay aligned.
 */
export declare function isNativeStripPreferred(): boolean;
/**
 * This function registers either ts-node or swc-node to transpile TypeScript files on the fly.
 * It also registers tsconfig-paths to handle path mapping based on the provided tsconfig.
 *
 * The TypeScript transpiler registration is done regardless of NX_PREFER_NODE_STRIP_TYPES.
 * If you want to skip transpiler registration, it is recommended that you check `process.features.typescript`.
 *
 * @returns cleanup function
 */
export declare function registerTsProject(tsConfigPath: string): () => void;
export declare function getSwcTranspiler(compilerOptions: CompilerOptions): (...args: unknown[]) => unknown;
export declare function getTsNodeTranspiler(compilerOptions: CompilerOptions, tsNodeOptions?: TsConfigOptions, preferTsNode?: boolean): (...args: unknown[]) => unknown;
export declare function getTranspiler(compilerOptions: CompilerOptions, tsConfigRaw?: unknown): () => (...args: unknown[]) => unknown;
/**
 * Node.js throws this code when native type stripping hits an unsupported
 * construct (enum, runtime namespace, legacy decorators, import = require,
 * parameter properties on older Node, etc.).
 *
 * Exported for tests.
 */
export declare function isNativeTypeStripError(err: unknown): boolean;
/**
 * A SyntaxError thrown while parsing a forced-CJS file (`.cts`/`.cjs`) as
 * CommonJS - typically ESM syntax in a CJS file (e.g. `export default` in
 * `.cts`). Pre-v23 this worked because swc-node's CJS hook compiled away the
 * ESM syntax; under native strip swc-node isn't registered, so the file
 * reaches Node's strict CJS parser. swc-node tolerates ESM syntax in `.cts`
 * (`register()` forces `module: commonjs` regardless of extension), so
 * escalating to the swc/ts-node fallback recovers the legacy behavior.
 */
export declare function isCjsSyntaxError(err: unknown, filePath: string): boolean;
/**
 * A ReferenceError from Node treating a `.ts`/`.mts` file as ESM and the file
 * relying on a CJS-only global: `require`, `__dirname`, or `__filename`.
 * Pre-v23 swc-node compiled `.ts` to CJS where these globals exist; under
 * native strip Node detects ESM via `import`/`export` syntax and these globals
 * are undefined. Registering swc/ts-node compiles ESM->CJS and restores the
 * legacy globals.
 */
export declare function isRequireInEsmScopeError(err: unknown, filePath: string): boolean;
export declare function isTsEsmSyntaxError(err: unknown, filePath: string): boolean;
export declare function isTsEsmNamedExportLinkageError(err: unknown, filePath: string): boolean;
/**
 * Load a TypeScript file via `require()`.
 *
 * When the runtime exposes native TypeScript stripping
 * (`process.features.typescript`) and the user hasn't opted out via
 * `NX_PREFER_NODE_STRIP_TYPES=false`, the file loads directly with no
 * swc/ts-node and no tsconfig-paths registration. If Node throws on an
 * unsupported construct (enum, runtime namespace, legacy decorators, etc.),
 * this registers swc/ts-node + tsconfig-paths and retries - matching the
 * pre-v23 registration. Set `NX_DISABLE_TSCONFIG_PATHS=true` to skip
 * tsconfig-paths even on fallback (useful when relying on package manager
 * workspaces). Set `NX_VERBOSE_LOGGING=true` to log when fallback triggers.
 *
 * When native strip is opted out (`NX_PREFER_NODE_STRIP_TYPES=false` or
 * unsupported Node), uses the legacy `registerTsProject` path.
 *
 * `tsConfigPath` is only consulted on the swc/ts-node fallback path (for
 * compilerOptions) and for tsconfig-paths registration. Native strip ignores
 * it. When omitted, defaults to the workspace root tsconfig.
 *
 * Note on ESM: Node 22.12+ supports `require()` of synchronous ESM by default,
 * so most ESM `.ts` configs load via this function without issue. Modules
 * that use top-level await throw `ERR_REQUIRE_ASYNC_MODULE` and must be
 * loaded with dynamic `import()` instead. `ERR_REQUIRE_ESM` (legacy code)
 * bubbles unchanged for the rare case it still fires, so async-aware callers
 * can dispatch to `import()`.
 *
 * @returns the loaded module
 */
export declare function loadTsFile<T = any>(filePath: string, tsConfigPath?: string): T;
/**
 * Plain `require()` with a lazy `tsconfig-paths` fallback. Use for files that
 * are NOT TypeScript (no transpilation needed) but may still import workspace
 * packages through TS path aliases (e.g. a `.js` changelog renderer that
 * `require`s `@my-org/lib`).
 *
 * `tsconfig-paths` is only registered after the first `require()` fails with
 * a module-resolution error, so workspaces that resolve aliases through
 * package-manager symlinks pay nothing. Set `NX_DISABLE_TSCONFIG_PATHS=true`
 * to skip the fallback entirely.
 *
 * @returns the loaded module
 */
export declare function requireWithTsconfigFallback<T = any>(filePath: string, tsConfigPath?: string): T;
/**
 * Register ts-node or swc-node given a set of compiler options.
 *
 * Note: Several options require enums from typescript. To avoid importing typescript,
 * use import type + raw values
 *
 * @returns cleanup method
 */
export declare function registerTranspiler(compilerOptions: CompilerOptions, tsConfigRaw?: unknown): () => void;
/**
 * @param tsConfigPath Adds the paths from a tsconfig file into node resolutions
 * @returns cleanup function
 */
export declare function registerTsConfigPaths(tsConfigPath: any): () => void;
/**
 * ts-node requires string values for enum based typescript options.
 * `register`'s signature just types the field as `object`, so we
 * unfortunately do not get any kind of type safety on this.
 */
export declare function getTsNodeCompilerOptions(compilerOptions: CompilerOptions): {
    [x: string]: any;
    allowImportingTsExtensions?: any;
    allowJs?: any;
    allowArbitraryExtensions?: any;
    allowSyntheticDefaultImports?: any;
    allowUmdGlobalAccess?: any;
    allowUnreachableCode?: any;
    allowUnusedLabels?: any;
    alwaysStrict?: any;
    baseUrl?: any;
    charset?: any;
    checkJs?: any;
    customConditions?: any;
    declaration?: any;
    declarationMap?: any;
    emitDeclarationOnly?: any;
    declarationDir?: any;
    disableSizeLimit?: any;
    disableSourceOfProjectReferenceRedirect?: any;
    disableSolutionSearching?: any;
    disableReferencedProjectLoad?: any;
    downlevelIteration?: any;
    emitBOM?: any;
    emitDecoratorMetadata?: any;
    exactOptionalPropertyTypes?: any;
    experimentalDecorators?: any;
    forceConsistentCasingInFileNames?: any;
    ignoreDeprecations?: any;
    importHelpers?: any;
    importsNotUsedAsValues?: any;
    inlineSourceMap?: any;
    inlineSources?: any;
    isolatedModules?: any;
    isolatedDeclarations?: any;
    jsx?: any;
    keyofStringsOnly?: any;
    lib?: any;
    libReplacement?: any;
    locale?: any;
    mapRoot?: any;
    maxNodeModuleJsDepth?: any;
    module?: any;
    moduleResolution?: any;
    moduleSuffixes?: any;
    moduleDetection?: any;
    newLine?: any;
    noEmit?: any;
    noCheck?: any;
    noEmitHelpers?: any;
    noEmitOnError?: any;
    noErrorTruncation?: any;
    noFallthroughCasesInSwitch?: any;
    noImplicitAny?: any;
    noImplicitReturns?: any;
    noImplicitThis?: any;
    noStrictGenericChecks?: any;
    noUnusedLocals?: any;
    noUnusedParameters?: any;
    noImplicitUseStrict?: any;
    noPropertyAccessFromIndexSignature?: any;
    assumeChangesOnlyAffectDirectDependencies?: any;
    noLib?: any;
    noResolve?: any;
    noUncheckedIndexedAccess?: any;
    out?: any;
    outDir?: any;
    outFile?: any;
    paths?: any;
    preserveConstEnums?: any;
    noImplicitOverride?: any;
    preserveSymlinks?: any;
    preserveValueImports?: any;
    project?: any;
    reactNamespace?: any;
    jsxFactory?: any;
    jsxFragmentFactory?: any;
    jsxImportSource?: any;
    composite?: any;
    incremental?: any;
    tsBuildInfoFile?: any;
    removeComments?: any;
    resolvePackageJsonExports?: any;
    resolvePackageJsonImports?: any;
    rewriteRelativeImportExtensions?: any;
    rootDir?: any;
    rootDirs?: any;
    skipLibCheck?: any;
    skipDefaultLibCheck?: any;
    sourceMap?: any;
    sourceRoot?: any;
    strict?: any;
    strictFunctionTypes?: any;
    strictBindCallApply?: any;
    strictNullChecks?: any;
    strictPropertyInitialization?: any;
    strictBuiltinIteratorReturn?: any;
    stripInternal?: any;
    suppressExcessPropertyErrors?: any;
    suppressImplicitAnyIndexErrors?: any;
    target?: any;
    traceResolution?: any;
    useUnknownInCatchVariables?: any;
    noUncheckedSideEffectImports?: any;
    resolveJsonModule?: any;
    types?: any;
    typeRoots?: any;
    verbatimModuleSyntax?: any;
    erasableSyntaxOnly?: any;
    esModuleInterop?: any;
    useDefineForClassFields?: any;
};
