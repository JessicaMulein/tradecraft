import { Tree } from '@nx/devkit';
import type * as ts from 'typescript';
export declare function readTsConfig(tsConfigPath: string, sys?: ts.ParseConfigHost): ts.ParsedCommandLine;
export declare function readTsConfigFromTree(tree: Tree, tsConfigPath: string): ts.ParsedCommandLine;
/**
 * The members `createTreeParseConfigHost` overrides: the file system ones are
 * backed by the `Tree`, `realpath`/`getCurrentDirectory` are anchored to
 * `tree.root`, and `useCaseSensitiveFileNames` is platform-derived from
 * `ts.sys`. The returned object still spreads `ts.sys` (TypeScript duck-types
 * the host and reads members this type does not name), so the narrow type is a
 * compile-time guard on Nx callers: everything outside it is disk-backed and
 * escapes the tree.
 */
export type TreeParseConfigHost = Required<Pick<ts.ParseConfigHost, 'useCaseSensitiveFileNames' | 'readDirectory' | 'readFile' | 'fileExists' | 'directoryExists' | 'realpath' | 'getCurrentDirectory'>>;
/**
 * A TypeScript host, backed by the devkit `Tree`, that resolves `extends` the
 * way real `tsc` does. The naive `{ ...ts.sys, readFile: (p) => tree.read(p) }`
 * host resolves less than `tsc`:
 *  - A package-form `extends` (e.g. `@tsconfig/node14/tsconfig.json`) is
 *    realpath-absolutized by TypeScript; `Tree.read`/`Tree.exists` re-root an
 *    absolute path under the workspace, so the base reads as nothing and its
 *    options silently vanish from the merged result (the failure surfaces only
 *    as a TS5083/TS6053 in `errors`, which callers discard).
 *  - An extension-less `extends` resolves against `process.cwd()` when
 *    existence comes from `ts.sys`; Nx never chdirs to the workspace root, so it
 *    resolves only when the command runs from the root.
 *
 * This host maps absolute paths under `tree.root` back to tree-relative for the
 * tree lookups and falls through to `fs` for paths that resolve outside the
 * workspace (a pnpm store or a `link:`/`file:` target). Resolution is anchored
 * to `tree.root` rather than the working directory: TypeScript resolves a
 * package-form base as a relative path and hands it to `realpath`, and
 * `ts.sys.realpath` would resolve it against `process.cwd()`, so a workspace
 * whose root is not an ancestor of the working directory would read a
 * same-named package from the wrong tree.
 *
 * `readDirectory` is a no-op: the source-file scan is skipped because callers
 * read only the merged `options`, never the file list. A config that resolves
 * its inputs through `include` (or the default glob) then reports a TS18003
 * unless it also carries `files` or `references`, so `errors.length > 0` is not
 * a usable signal; match specific codes (TS5083/TS6053) instead.
 */
export declare function createTreeParseConfigHost(tree: Tree): TreeParseConfigHost;
/**
 * Whether a `ParsedCommandLine` produced with `createTreeParseConfigHost` failed
 * to resolve an `extends` target: TS5083 (the base resolved but could not be
 * read) or TS6053 (the base could not be resolved at all). Because the host
 * resolves what real `tsc` resolves, this only fires for a config whose extends
 * chain `tsc` cannot read either. The no-op `readDirectory` also adds a TS18003
 * whenever the config resolves inputs through `include` and carries neither
 * `files` nor `references`, so `errors.length > 0` is not a usable signal; match
 * these two codes.
 */
export declare function extendsResolutionFailed(errors: readonly ts.Diagnostic[]): boolean;
export declare function getRootTsConfigPathInTree(tree: Tree): string | null;
export declare function getRelativePathToRootTsConfig(tree: Tree, targetPath: string): string;
export declare function getRootTsConfigPath(): string | null;
export declare function getRootTsConfigFileName(tree?: Tree): string | null;
export declare function addTsConfigPath(tree: Tree, importPath: string, lookupPaths: string[]): void;
/**
 * When `baseUrl` is not set and `paths` are inherited via `extends`,
 * tools like `tsconfig-paths` resolve from the loaded file's directory
 * instead of the file where `paths` is defined. This walks the `extends`
 * chain to find the correct resolution base.
 *
 * Returns the directory that `paths` values should be resolved relative to.
 * Walks the tsconfig `extends` chain to find where `paths` is defined, then
 * looks for the applicable `baseUrl` from that point toward the root of the
 * chain (ignoring child overrides that don't apply to the paths-defining
 * tsconfig). When no `baseUrl` applies, returns the directory of the
 * tsconfig that defines `paths`.
 */
export declare function resolvePathsBaseUrl(tsconfigPath: string): string;
export declare function readTsConfigPaths(tsConfig?: string | ts.ParsedCommandLine): ts.MapLike<string[]>;
