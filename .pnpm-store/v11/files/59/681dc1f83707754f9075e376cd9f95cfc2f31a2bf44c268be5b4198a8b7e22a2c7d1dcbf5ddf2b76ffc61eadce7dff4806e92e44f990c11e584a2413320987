import type { PackageManager } from '../package-manager';
/**
 * Environment entries (npm_config_* keys) to overlay on a spawned npm process
 * so its per-key config resolution reproduces the workspace package manager's
 * own registry/auth/TLS resolution. npm parses these at its env tier: above
 * every .npmrc level, below CLI flags (we never pass registry CLI flags).
 */
export type NpmConfigEnv = Record<string, string>;
export declare function getPackageScope(packageName: string): string | null;
/**
 * Converts a registry URL into npm's nerf-dart key prefix (host + directory
 * path), e.g. `https://r.example.com/npm/` -> `//r.example.com/npm/`.
 * See https://github.com/npm/cli/blob/bb056c85059cfb39514614e31abba09f20ac1612/workspaces/config/lib/nerf-dart.js#L12-L17
 */
export declare function nerfDart(registryUrl: string): string | null;
/**
 * Where npm and pnpm both begin a lookup for `registry`, and what
 * registryKeysFor climbs from. Both append the trailing slash a registry path is
 * missing before darting (npm darts the request URI; pnpm does it in
 * getAuthHeaderByURI and pickSettingByUrl), so the walk starts at the request's
 * own directory and still reaches a setting pinned to `//h/api/npm/` for a
 * request to `https://h/api/npm`, which the plain dart begins above.
 *
 * A registry URL carrying a query or a fragment lands back on the plain dart:
 * npm builds its request URI by concatenation, so the package name joins the
 * query rather than the path, and its walk never reaches the deeper directory.
 */
export declare function requestNerfDart(registry: string): string | null;
/** npm's key rewrite: non-leading `_` to `-`, then lowercased. */
export declare function normalizeNpmConfigKey(key: string): string;
/**
 * The value npm resolves for `setting` out of an environment: the last non-empty
 * `npm_config_*` spelling wins (loadEnv). `setting` is the name npm looks the
 * value up under, so a scope npm rewrites (`@my_scope`) finds nothing.
 */
export declare function readNpmConfigEnv(env: NodeJS.ProcessEnv, setting: string): string | undefined;
/**
 * Merges an npm_config_* overlay into the environment for a spawned npm, leaving
 * one non-empty spelling per setting: the overlay's where it carries the setting,
 * otherwise the ambient one npm itself would resolve. npm reads its env tier
 * last-write-wins over the received key order, and both macOS `/bin/sh` and npm's
 * own shell launcher rebuild that order, so a setting left spelled two ways
 * (`NPM_CONFIG_REGISTRY` beside `npm_config_registry`) goes to whichever one they
 * emit last instead of to the value resolved here.
 *
 * `managerIgnoresEnv` says which settings the package manager resolves without
 * reading `npm_config_*`. Bridged settings it answers true for are dropped even
 * where the overlay claims nothing: npm's env tier sits above every file, so
 * leaving one in place stops npm from reaching the .npmrc chain the package
 * manager itself resolved from. Settings outside the bridged set stay ambient
 * either way.
 */
export declare function mergeNpmConfigEnv(baseEnv: NodeJS.ProcessEnv, overlay: NpmConfigEnv, managerIgnoresEnv?: IgnoresNpmConfigEnv): NodeJS.ProcessEnv;
export type IgnoresNpmConfigEnv = (setting: string) => boolean;
/**
 * The settings the package manager resolves without reading `npm_config_*`, as
 * a predicate over setting names. A bridged setting it returns true for is one
 * the spawned npm never receives from the ambient environment; settings outside
 * the bridged set it has no say over. pnpm reads them all up to 10.x and stops at 11.0.0,
 * which switched to its own `PNPM_CONFIG_*` prefix, except that 11.6.0 restored
 * the URL-scoped credential keys; yarn berry has never read any; npm reads them by
 * definition, and bun reads them for the settings this module bridges.
 *
 * An undetermined or unparseable version answers false for every setting:
 * bridging is skipped or falls open there anyway, so the ambient environment
 * stays as it is.
 */
export declare function ignoresNpmConfigEnv(packageManager: PackageManager, packageManagerVersion: string | null): IgnoresNpmConfigEnv;
export declare function setRegistry(env: NpmConfigEnv, url: string): void;
export declare function setScopedRegistry(env: NpmConfigEnv, scope: string, url: string): void;
/**
 * Keyed on the registry's own directory rather than the parent a path missing
 * its trailing slash darts to, so two registries under one parent keep separate
 * keys instead of handing each other's credential out. The same holds for the
 * two sinks below.
 */
export declare function setAuthToken(env: NpmConfigEnv, registryUrl: string, token: string): void;
/** `_auth` carries base64(user:pass). */
export declare function setAuthIdent(env: NpmConfigEnv, registryUrl: string, base64Ident: string): void;
/**
 * npm presents a client certificate only when both halves are configured, so
 * they are set together; each is a path, not the material itself.
 * See https://github.com/npm/npm-registry-fetch/blob/v19.1.1/lib/auth.js#L170
 */
export declare function setClientCertificate(env: NpmConfigEnv, registryUrl: string, certfile: string, keyfile: string): void;
export declare function setCafile(env: NpmConfigEnv, path: string): void;
export declare function setStrictSsl(env: NpmConfigEnv, value: boolean): void;
export declare function setProxies(env: NpmConfigEnv, proxies: {
    httpProxy?: string;
    httpsProxy?: string;
    noProxy?: string;
}): void;
/**
 * Directories above `root` (exclusive), nearest first. yarn classic and berry
 * both read rc files from ancestor directories, which npm never sees because
 * its project-config walk stops at the first package.json.
 */
export declare function ancestorDirectories(root: string): string[];
/**
 * Resolves `${VAR}` references to the value npm itself ends up with, escapes
 * consumed and the `${VAR?}` form falling back to an empty string. Use it to
 * predict what a value npm reads for itself becomes, not to produce one for it:
 * a bridged value goes through npm's own pass, which expandEnvVars accounts for.
 * The `${VAR?}` form only landed in npm 11.6.0, so against an older spawned npm
 * the prediction resolves a reference that npm itself would leave verbatim.
 * See https://github.com/npm/cli/blob/v11.16.0/workspaces/config/lib/env-replace.js
 */
export declare function expandNpmEnvVars(value: string, env?: NodeJS.ProcessEnv): string;
/**
 * The value to bridge so that npm's own expansion produces `value`, for a
 * resolution that consumed the package manager's escapes rather than leaving
 * them for npm (a literal a reader never expanded, or an expander whose escape
 * rule is not npm's). Each reference gets an odd run of backslashes, which npm
 * halves back to what it started as. Only what npm's reader would act on is
 * escaped, so a `${` it leaves alone is not turned into a literal backslash.
 */
export declare function escapeNpmEnvExpr(value: string): string;
/**
 * Expands `${VAR}` references from the environment the way npm/bun ini readers
 * do. Unknown variables are left verbatim. The result is bridged, so an escaped
 * reference keeps its escape for the spawned npm to consume.
 */
export declare function expandEnvVars(value: string, env?: NodeJS.ProcessEnv): string;
/**
 * Expands `${VAR}` the way yarn classic's own envReplace does, which parts from
 * npm's on both halves of its escape rule: an odd run of backslashes keeps
 * every one of them along with the reference, and an even one drops all of them
 * rather than half. A reference it resolves nothing for aborts yarn, so it
 * throws here into the caller's fall-open.
 * See https://github.com/yarnpkg/yarn/blob/v1.22.22/src/registries/npm-registry.js
 */
export declare function expandYarnEnvVars(value: string, env?: NodeJS.ProcessEnv): string;
/**
 * Expands `${VAR}` the way pnpm's @pnpm/config.env-replace does. A reference
 * that resolves to nothing becomes an empty string, matching the envReplaceLossy
 * reader pnpm takes its config through from 11.0.0; keeping it verbatim would
 * put a literal `${VAR}` on the wire as if it were a credential. Below 11 the
 * reader throws instead and the whole file goes with it (readPnpmNpmrcMap), so
 * on that line nothing reaching this carries an unresolvable reference.
 *
 * This is what pnpm itself ends up with, escapes consumed. Use it for a key,
 * which nothing expands a second time, and for a value compared against pnpm's
 * own resolution; a value handed to the spawned npm goes through
 * bridgePnpmEnvVars instead.
 */
export declare function expandPnpmEnvVars(value: string, env?: NodeJS.ProcessEnv): string;
/**
 * The same expansion in the form to hand the spawned npm: every `${VAR}` left in
 * what pnpm resolved is escaped, so npm reproduces it instead of expanding a
 * reference pnpm would have sent literally, whether that reference is one pnpm
 * kept escaped or one a variable's own value carries.
 *
 * The escaping runs over pnpm's whole result rather than per reference, because
 * a resolved value ending in a backslash joins the escape run of the reference
 * behind it. Escaping each piece on its own leaves npm reading the merged run,
 * whose parity says expand where pnpm's said keep.
 */
export declare function bridgePnpmEnvVars(value: string, env?: NodeJS.ProcessEnv): string;
/** The `${VAR}` references in `value` that pnpm's throwing reader dies on. */
export declare function unresolvedPnpmEnvVars(value: string, env?: NodeJS.ProcessEnv): string[];
/** Whether every `${VAR}` in `value` is one pnpm's throwing reader gets past. */
export declare function pnpmEnvVarsResolve(value: string, env?: NodeJS.ProcessEnv): boolean;
export declare function readEnvVar(env: NodeJS.ProcessEnv, name: string): string | undefined;
/**
 * Reads `map` under `setting`, matching how npm and pnpm both expand a `${VAR}`
 * in an .npmrc key before they look a value up under it; `setting` is already
 * the resolved form to match. Both readers assign in file order, so the last key
 * that `expand` turns into `setting` wins, a literal one included.
 */
export declare function readExpandedKey(map: Map<string, string>, setting: string, expand: (value: string) => string): string | undefined;
/**
 * The registry keys npm looks a setting up under for `dart`, nearest first: it
 * strips one path segment at a time until only the host is left, which covers
 * the key spelled with and without its trailing slash.
 * See https://github.com/npm/npm-registry-fetch/blob/v18.0.2/lib/auth.js#L16-L26
 */
export declare function registryKeysFor(dart: string): string[];
/**
 * Whether npm would find a credential for `dart` among the values `read`
 * exposes, at the dart or at any parent of it.
 * See https://github.com/npm/npm-registry-fetch/blob/v18.0.2/lib/auth.js#L34-L49
 */
export declare function hasCredentialFor(dart: string, read: (key: string) => string | undefined): boolean;
/**
 * npm reads the user's own .npmrc chain and the overlay cannot switch that off,
 * so npm can authenticate on a registry the package manager resolved but would
 * have queried anonymously. The fetch still succeeds, so nothing else reports it.
 * Warn only where the overlay is what sent npm to that registry: left to itself
 * npm would have used its own resolution and the same credentials, which is what
 * the user gets from npm anywhere else.
 *
 * `remediation` closes the message, because what the user can safely do about it
 * depends on whether the package manager reads .npmrc at all.
 */
export declare function warnNativeCredential(env: NpmConfigEnv, dart: string, packageManager: string, remediation: string, npmVisible: (key: string) => string | undefined): void;
