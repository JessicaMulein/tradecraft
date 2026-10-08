import type { Lockfile } from '@pnpm/lockfile-types';
import type { PackageJson } from '../../../utils/package-json';
export type PnpmLockfileConfigField = keyof Lockfile | 'catalogs';
export declare const PNPM_LOCKFILE_RESOLUTION_CONFIG_FIELDS: PnpmLockfileConfigField[];
/**
 * Drops the resolution-time pnpm config a pruned standalone lockfile already
 * resolves into its snapshots, then drops an emptied `pnpm` block. Re-declaring
 * it next to a pruned lockfile makes pnpm <=10 fail with
 * ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Only for an actually pruned lockfile: the
 * root-lockfile fallback keeps the config, which that lockfile still declares.
 *
 * Counterpart to `stripStandaloneLockfileConfig` in the pnpm lock-file parser,
 * which drops the same fields from the generated lockfile.
 */
export declare function stripPrunedLockfilePnpmConfig(packageJson: PackageJson): void;
/**
 * Drops the `pnpm.patchedDependencies` the emitted manifest inherited from the
 * project it was built from. The declaration a pruned output needs is the one
 * `getPrunedPnpmPatchArtifacts` derives from the lockfile shipping beside it; an
 * inherited one names the workspace's patch paths rather than the output's, and
 * survives even when the output ships no patch file at all, which fails the
 * install as pnpm hashes every declared patch. pnpm reads the field from the
 * workspace root alone, so a project-level block was inert at home and cannot be
 * trusted here either.
 */
export declare function dropInheritedPnpmPatchedDependencies(packageJson: PackageJson): void;
/**
 * pnpm config resolved once per prune and threaded into the settings-yaml and
 * patch-artifact builders, so neither repeats the pnpm version probe or the
 * patched-dependency resolution.
 */
type PrunedPnpmConfig = {
    pnpmMajor: number | null;
    patchedDependencies: Record<string, string>;
};
/**
 * Builds the settings-only pnpm-workspace.yaml every standalone pruned output
 * ships. Unconditional because a conditional artifact cannot be retracted: a
 * cache replay restores only the files the replayed entry holds and a bundler
 * overwrites rather than cleans its output directory, so an earlier build's
 * copy would survive and its stale settings would apply. A `packages: []`-only
 * file is inert, verified installable with identical module resolution on
 * pnpm 9, 10 and 11.
 *
 * On pnpm 11+, this file carries declared `minimumReleaseAge`,
 * `minimumReleaseAgeExclude`, `minimumReleaseAgeStrict`, build approvals,
 * `supportedArchitectures`, and applicable `patchedDependencies` from the
 * workspace root. Approvals and patches are scoped to the pruned lockfile.
 *
 * On pnpm <=10, only build approvals, `supportedArchitectures`, and
 * `patchedDependencies` are emitted in `package.json`.
 *
 * Settings encoded in the pruned resolution, such as `overrides` and
 * `packageExtensions`, are not copied (`stripPrunedLockfilePnpmConfig`).
 *
 * The major is the build machine's pnpm, which is all that is knowable at
 * build time: an output built on pnpm <=10 but deployed on pnpm 11+ will not
 * pick its approvals up. `precomputed` lets a caller pass the pnpm major and
 * pruned patchedDependencies it already resolved instead of recomputing them.
 */
export declare function getPrunedPnpmInstallSettingsYaml(workspaceRootPath?: string, prunedLockfileContent?: string, precomputed?: PrunedPnpmConfig): string;
/**
 * The path a `.patch` file takes inside the pruned output, always under the
 * output's declared `patches/` directory: a source path outside it would fall
 * outside the prune target's cached `patches` output and be dropped on a cache
 * replay, and a `..` asset name is not one a bundler can emit. The source
 * sub-structure is kept so same-named patches in different directories stay
 * distinct. The path is collapsed first, the way pnpm collapses it before
 * recording it in the lockfile (`./x` and `a/../x` are both stored as `x`), so
 * the config path read here and the lockfile path read by
 * `filterPatchedDependenciesToPrunedPackages` (which calls this same helper)
 * produce the same destination. A `..` left after collapsing escapes the
 * workspace and is dropped, the one way two sources can still meet on one
 * destination; `getPrunedPnpmPatchArtifacts` rejects that pair rather than
 * shipping one file for both.
 */
export declare function normalizePrunedPatchPath(patchPath: string): string;
type PrunedPnpmPackageJsonBuildSettings = Pick<NonNullable<PackageJson['pnpm']>, 'onlyBuiltDependencies' | 'neverBuiltDependencies' | 'supportedArchitectures'>;
/**
 * The pnpm build-script approvals a standalone pruned output declares in its
 * emitted package.json so native production deps still run their build scripts
 * on pnpm <=10; null on pnpm 11+, which reads approvals only from
 * pnpm-workspace.yaml (`getPrunedPnpmInstallSettingsYaml` carries them there;
 * keep the two in sync when pnpm moves the read again). Both root sources
 * (pnpm-workspace.yaml wins over the package.json `pnpm` field) are read, and
 * a pnpm 10.26+ `allowBuilds` map is folded into the on/never-built lists
 * pnpm <=10 understands. Approvals are scoped to the packages the pruned
 * lockfile keeps (one for a dropped package is inert); when the lockfile's
 * names cannot be extracted (a pre-v9 lockfile, unparseable content) they are
 * carried verbatim instead of scoped to nothing.
 */
export declare function getPrunedPnpmPackageJsonBuildSettings(workspaceRootPath?: string, prunedLockfileContent?: string, precomputed?: PrunedPnpmConfig): PrunedPnpmPackageJsonBuildSettings | null;
/**
 * Patch artifacts a standalone pruned output must ship to keep a `pnpm patch`
 * workspace installable: the `.patch` files (path relative to the output root,
 * plus content) and, on pnpm 10 and below, the `patchedDependencies` map to
 * declare in the emitted package.json. On pnpm 11+ that map is carried in
 * pnpm-workspace.yaml (see `getPrunedPnpmInstallSettingsYaml`), so
 * `packageJsonPatchedDependencies` is null there. Both are scoped to the patches
 * the pruned lockfile keeps. Returns the file contents so the file-writing prune
 * paths and the bundler asset pipelines can each ship them their own way.
 */
export declare function getPrunedPnpmPatchArtifacts(workspaceRootPath?: string, prunedLockfileContent?: string, precomputed?: PrunedPnpmConfig): {
    patchFiles: Array<{
        path: string;
        content: string;
    }>;
    packageJsonPatchedDependencies: Record<string, string> | null;
};
/**
 * Non-workspace local-path deps (`file:` tarballs/dirs, `link:` targets) ship
 * under this single output directory rather than at their workspace-relative
 * path. A generated `prune-lockfile` target declares dynamic output paths it
 * cannot enumerate at generate time; corralling every vendored artifact under
 * one directory lets `getPruneTargets` declare it, so a cache replay restores it
 * (an artifact shipped outside a declared output is dropped on replay, breaking
 * the standalone deploy). The manifest specifiers and pruned-lockfile refs are
 * relocated into this directory to match; source reads strip it back off.
 */
export declare const LOCAL_PATH_MODULES_DIR = "local_path_modules";
/**
 * Relocates a workspace-relative local-path into the shipped output directory.
 * Injective, so `uncontainLocalPath` recovers the source path for every input:
 * a workspace directory literally named `local_path_modules/` relocates like
 * any other rather than being mistaken for an already-relocated path. Callers
 * must therefore relocate each path exactly once.
 */
export declare function containLocalPath(wsRelativePath: string): string;
/**
 * The workspace-relative source path of a shipped local-path artifact, i.e. the
 * inverse of `containLocalPath`. A path that is not under the shipped directory
 * (an unshippable target left at its original spec) is returned unchanged.
 */
export declare function uncontainLocalPath(shippedPath: string): string;
/**
 * A `file:`/`link:` specifier with its path separators unified, so specifiers
 * that differ only in how they were authored compare equal. Returns anything
 * that is not a local-path specifier unchanged.
 */
export declare function normalizeLocalPathSpec(spec: string): string;
/**
 * A relocated `file:`/`link:` specifier read back as the source path it was
 * relocated from, so it compares equal to the source specifier for the same
 * target (`normalizeLocalPathSpec`). Relocation is injective and strips exactly
 * one level, so only the relocated side of a comparison may go through this: a
 * source path that itself starts with the shipped directory's name relocates
 * like any other, and stripping it too would read it as a different target.
 */
export declare function uncontainLocalPathSpec(spec: string): string;
/**
 * Warns when a workspace directory occupies the output path of a copied
 * workspace module. Both spell `workspace_modules/<name>`, so no later pass can
 * tell them apart: the vendored source is read as the copied module and never
 * ships, leaving the lockfile pointing at a path the output does not carry.
 */
export declare function warnOnWorkspaceModulePathCollision(sourcePackages: Record<string, unknown> | undefined, synthesizedModulePaths: ReadonlySet<string>): void;
/**
 * Relocates every shippable non-workspace `file:` local-path reference in a
 * pruned lockfile (package keys, resolutions, and snapshot/importer dependency
 * refs) under `LOCAL_PATH_MODULES_DIR`, matching where the artifacts ship, so a
 * standalone `pnpm install` resolves them. `link:` refs are relocated upstream
 * (`containShippedLocalLinkRefs` for the source snapshots, the assembly's own
 * synthesis sites for the rest); only `file:` paths, which the source lockfile
 * carries verbatim, are contained here. Workspace-module and escaping paths
 * are left untouched. Mutates `lockfile` in place; the key rename and every ref
 * use the same `file:` path, so they stay in sync.
 *
 * Takes the normalized document rather than a looser shape: dependency refs are
 * rewritten only where they are plain strings, which is what normalization
 * guarantees. A raw v9 file records an importer ref as `{ specifier, version }`
 * and would have its package key renamed while that ref kept pointing at the
 * old path.
 */
export declare function containShippedLocalFilePaths(lockfile: Partial<Pick<Lockfile, 'importers' | 'packages'>>, synthesizedModulePaths?: ReadonlySet<string>): void;
/**
 * Relocates the shippable `link:` refs a source lockfile's package snapshots
 * carry, so they resolve from the pruned output's root. pnpm reads a snapshot
 * `link:` ref against the lockfile directory, which is the workspace root at
 * source and the deploy root in the output, so a ref left verbatim points at a
 * path the standalone output does not carry once the target ships under
 * `LOCAL_PATH_MODULES_DIR`. A target that cannot ship keeps its ref, matching
 * the copied manifest; the artifact collector reports why.
 *
 * Takes the source snapshots alone rather than the assembled document: the
 * assembly relocates its own refs at their synthesis site, and a second pass
 * cannot tell an already-relocated path from a workspace path that starts with
 * the shipped directory's name. Mutates the snapshots in place.
 */
export declare function containShippedLocalLinkRefs(sourceSnapshots: Record<string, unknown> | undefined): void;
/**
 * The non-workspace local-path packages a standalone pruned output must ship so
 * `pnpm install` can resolve them. The pruned lockfile records each path
 * relocated under `LOCAL_PATH_MODULES_DIR` (see containLocalPath), so `path`
 * ships there while `sourcePath` reads from the original workspace location.
 * Three shapes ship: a `file:` tarball (the `.tgz`), a `file:` directory not
 * under `workspace_modules/` (copied workspace modules ship via
 * copy-workspace-modules and are skipped here), and a `link:` target directory
 * (a root importer `link:` version, or a package `link:` snapshot ref).
 * `node_modules` is filtered from every directory copy; a symlink inside a
 * shipped tree is skipped with a warning while a symlinked root ships when it
 * resolves under the workspace root; entries are deduped by destination; a
 * source missing on disk or resolving outside the workspace root is skipped
 * with a warning (not reproducibly deployable). Source paths rather than bytes
 * so the file-writing prune paths can copy without buffering whole trees.
 */
export declare function getPrunedPnpmLocalPathArtifacts(workspaceRootPath?: string, prunedLockfileContent?: string): Array<{
    path: string;
    sourcePath: string;
}>;
/**
 * Fails the pruned build when a shipped local-path target has a required
 * dependency that will not be resolvable in the standalone deploy: a `link:`
 * target (a symlink, not a packed package, so pnpm never installs its
 * dependency closure) or a `file:` directory package whose lockfile entry
 * carries no dependency edges (a peer backfilled when `autoInstallPeers` is
 * off). Both install, `pnpm install --frozen-lockfile` exits 0, and the target
 * resolves its `require`s only from the deploy-root node_modules, so a
 * required dep missing there fails at runtime with MODULE_NOT_FOUND; this
 * throws at build time with the remedy.
 *
 * Only a required dep absent from the app's installed direct deps fails. A
 * peer or optional dep of the target, or a required dep present only in the
 * app's devDependencies (a `--prod` install may omit it), warns instead; these
 * are not provably broken. The app's own peerDependencies count as installed:
 * the pruned root importer folds them into `dependencies` (mirroring pnpm's
 * autoInstallPeers). A backfilled `file:` tarball peer's manifest is inside
 * the archive and is not read, so its closure is not validated. pnpm-only;
 * call sites gate on the package manager.
 */
export declare function validatePrunedLocalPathClosure(packageJson: PackageJson, workspaceRootPath: string, prunedLockfileContent?: string): void;
/**
 * Relocates a `file:`/`link:` specifier recorded relative to `sourceDir` so it
 * resolves from `destDir` (both workspace-root-relative posix paths, '' meaning
 * the workspace root itself) to the target's shipped location under
 * `LOCAL_PATH_MODULES_DIR`. Returns null for a non-local-path spec. When the
 * target cannot ship into the pruned output, `spec` is returned unchanged with
 * the `reason`: absolute or escaping the workspace root (`outside-workspace`),
 * or the workspace root itself (`workspace-root`).
 * Every layer of the pruned output (app manifest, copied-module manifests,
 * lockfile snapshot refs) relocates through this one function so the layers
 * cannot disagree.
 */
export declare function relocatePrunedLocalPathSpec(spec: string, sourceDir: string, destDir: string): {
    spec: string;
    reason?: 'outside-workspace' | 'workspace-root';
} | null;
/**
 * Warns when a pruned pnpm lockfile needs install-time artifacts that only
 * `generatePrunedDeployOutput` ships, naming the ones this workspace actually
 * needs. For callers of
 * the bare `createLockFile`, which hands back a lockfile and nothing else: the
 * pieces below live outside it, so an output assembled from the lockfile and
 * the manifest alone installs without the workspace's build-script approvals,
 * patches, or vendored local paths. Silent when the workspace needs none of
 * them, which is the common case.
 */
export declare function warnIncompletePrunedPnpmOutput(lockFileContent: string, workspaceRootPath?: string): void;
/** Warns that a local-path target cannot ship, with the reason-specific remedy. */
export declare function warnUnshippableLocalPathSpec(description: string, reason: 'outside-workspace' | 'workspace-root'): void;
/**
 * The manifest shape the peer-dependency helpers below touch. Kept structural so
 * the copied-module manifests the `@nx/js` prune executors carry, which are not
 * full `PackageJson`s, go through the same helpers.
 */
type PeerDependencyManifest = {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, unknown>;
};
/**
 * Moves a peer dependency into `dependencies` under the given specifier: pnpm
 * rejects a `file:`/`link:` spec under peerDependencies outright, so a shipped
 * local path or workspace module declared there would fail the whole install.
 * The `peerDependenciesMeta` entry goes with it, since the optional/required
 * marker is orphaned once the dependency is no longer a peer.
 */
export declare function movePeerDependencyToDependencies(packageJson: PeerDependencyManifest, name: string, spec: string): void;
/**
 * Drops a `peerDependencies`/`peerDependenciesMeta` section left empty by
 * `movePeerDependencyToDependencies`, so a manifest that declared nothing but
 * moved peers does not ship an empty section.
 */
export declare function dropEmptyPeerDependencySections(packageJson: PeerDependencyManifest): void;
/**
 * Rewrites a standalone pruned manifest's non-workspace local-path specifiers
 * (`file:` tarball/dir, `link:` dir) to their shipped location under
 * `LOCAL_PATH_MODULES_DIR`, so a non-frozen `pnpm install` of the deploy
 * output resolves them from where the shipped source sits (see
 * `getPrunedPnpmLocalPathArtifacts`). Mutates `packageJson` in place.
 * pnpm-only; call sites gate on the package manager.
 *
 * Per specifier, in order: resolve a `catalog:` reference first (the bundler's
 * `createPackageJson` does not), skip a workspace package (copied to
 * `workspace_modules/`), then relocate from `projectRoot`-relative to the
 * shipped location. A `file:`/`link:` peer dependency is moved into
 * `dependencies` with its `peerDependenciesMeta` entry dropped even when the
 * target cannot ship (pnpm rejects such a spec under peerDependencies
 * outright, so leaving it would fail the whole install), mirroring the
 * workspace-module handling. An unshippable target otherwise keeps its
 * specifier, with a warning.
 */
export declare function rewritePrunedLocalPathSpecifiers(packageJson: PackageJson, projectRoot: string, workspaceRootPath: string, workspacePackageNames: Set<string>): void;
export type PrunedDeployArtifact = {
    path: string;
    content: string | Buffer;
    sourcePath?: never;
} | {
    path: string;
    sourcePath: string;
    content?: never;
};
/**
 * The pnpm install-time artifacts a standalone pruned output needs, as data
 * for a caller to write or emit: the settings-only pnpm-workspace.yaml, the
 * `pnpm patch` files, and the non-workspace local-path dependencies (carried
 * as a source path rather than content so a directory sink can copy them
 * straight across). Everything is resolved before returning, so a colliding
 * patch path aborts before the caller ships anything. The pnpm <=10
 * build-script approvals and `patchedDependencies` declaration are folded onto
 * `packageJson` in place (see `getPrunedPnpmPackageJsonBuildSettings`), so
 * write or emit the manifest after this returns.
 *
 * Pass `includeLocalPathArtifacts: false` for the root-lockfile fallback
 * (`pruned: false` from `createPrunedLockfile`): its importer references the
 * whole workspace, so shipping its local-path trees would copy unrelated
 * sources into the output.
 */
export declare function getPrunedPnpmInstallArtifacts(workspaceRootPath: string, prunedLockfileContent: string, packageJson: PackageJson, options?: {
    includeLocalPathArtifacts?: boolean;
}): PrunedDeployArtifact[];
export {};
