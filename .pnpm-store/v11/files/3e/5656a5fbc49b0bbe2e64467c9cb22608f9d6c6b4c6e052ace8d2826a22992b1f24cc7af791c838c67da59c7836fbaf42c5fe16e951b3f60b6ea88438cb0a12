export type PackageManager = 'yarn' | 'pnpm' | 'npm' | 'bun';
export interface PackageManagerCommands {
    preInstall?: string;
    install: string;
    ciInstall: string;
    updateLockFile: string;
    add: string;
    addDev: string;
    rm: string;
    exec: string;
    dlx: string;
    list: string;
    why: string;
    run: (script: string, args?: string) => string;
    getRegistryUrl?: string;
    publish: (packageRoot: string, registry: string, registryConfigKey: string, tag: string) => string;
    ignoreScriptsFlag?: string;
}
/**
 * Detects which package manager is used in the workspace based on the lock file.
 */
export declare function detectPackageManager(dir?: string): PackageManager;
/**
 * Returns true if the workspace is using npm workspaces, yarn workspaces, or pnpm workspaces.
 * @param packageManager The package manager to use. If not provided, it will be detected based on the lock file.
 * @param root The directory the commands will be ran inside of. Defaults to the current workspace's root.
 */
export declare function isWorkspacesEnabled(packageManager?: PackageManager, root?: string): boolean;
/**
 * Returns commands for the package manager used in the workspace.
 * By default, the package manager is derived based on the lock file,
 * but it can also be passed in explicitly.
 *
 * Example:
 *
 * ```javascript
 * execSync(`${getPackageManagerCommand().addDev} my-dev-package`);
 * ```
 *
 * @param packageManager The package manager to use. If not provided, it will be detected based on the lock file.
 * @param root The directory the commands will be ran inside of. Defaults to the current workspace's root.
 */
export declare function getPackageManagerCommand(packageManager?: PackageManager, root?: string): PackageManagerCommands;
/**
 * Returns the version of the package manager used in the workspace.
 * By default, the package manager is derived based on the lock file,
 * but it can also be passed in explicitly.
 */
export declare function getPackageManagerVersion(packageManager?: PackageManager, cwd?: string): string;
export declare function parseVersionFromPackageManagerField(requestedPackageManager: string, packageManagerFieldValue: string | undefined): null | string;
/**
 * Checks for a project level npmrc file by crawling up the file tree until
 * hitting a package.json file, as this is how npm finds them as well.
 */
export declare function findFileInPackageJsonDirectory(file: string, directory?: string): string | null;
/**
 * We copy yarnrc.yml to the temporary directory to ensure things like the specified
 * package registry are still used. However, there are a few relative paths that can
 * cause issues, so we modify them to fit the new directory.
 *
 * Exported for testing - not meant to be used outside of this file.
 *
 * @param contents The string contents of the yarnrc.yml file
 * @returns Updated string contents of the yarnrc.yml file
 */
export declare function modifyYarnRcYmlToFitNewDirectory(contents: string): string;
/**
 * We copy .yarnrc to the temporary directory to ensure things like the specified
 * package registry are still used. However, there are a few relative paths that can
 * cause issues, so we modify them to fit the new directory.
 *
 * Exported for testing - not meant to be used outside of this file.
 *
 * @param contents The string contents of the yarnrc.yml file
 * @returns Updated string contents of the yarnrc.yml file
 */
export declare function modifyYarnRcToFitNewDirectory(contents: string): string;
/**
 * We copy pnpm-workspace.yaml to the temporary directory so the workspace's
 * registry, auth and release-age settings still apply, and so `pnpm add -w`
 * recognizes the directory as a workspace root. `patchedDependencies` (relative
 * patch paths) only resolves in the real workspace, so it is dropped. The
 * `packages` field is always set to a self-reference (`['.']`) - the temp dir is
 * a single-package workspace - whether or not the source had one, since pnpm
 * <10.5 (and corepack's bundled default pnpm) reject a workspace manifest whose
 * `packages` field is missing or empty.
 *
 * Exported for testing - not meant to be used outside of this file.
 *
 * @param contents The string contents of the pnpm-workspace.yaml file
 * @returns Updated string contents of the pnpm-workspace.yaml file
 */
export declare function modifyPnpmWorkspaceYamlToFitNewDirectory(contents: string): string;
export declare function copyPackageManagerConfigurationFiles(root: string, destination: string): void;
/**
 * Creates a temporary directory where you can run package manager commands safely.
 *
 * For cases where you'd want to install packages that require an `.npmrc` set up,
 * this function looks up for the nearest `.npmrc` (if exists) and copies it over to the
 * temp directory.
 *
 * @param skipCopy - If true, skips copying package manager configuration files to the temporary directory.
 *                   This is useful when creating a workspace from scratch (e.g., in create-nx-workspace)
 *                   where no existing configuration files are available to copy.
 */
export declare function createTempNpmDirectory(skipCopy?: boolean): {
    dir: string;
    cleanup: () => Promise<void>;
};
/**
 * Returns the resolved version for a given package and version tag using the
 * NPM registry (when using Yarn it will fall back to NPM to fetch the info).
 */
export declare function resolvePackageVersionUsingRegistry(packageName: string, version: string): Promise<string>;
/**
 * Return the resolved version for a given package and version tag using by
 * installing it in a temporary directory and fetching the version from the
 * package.json.
 */
export declare function resolvePackageVersionUsingInstallation(packageName: string, version: string): Promise<string>;
/**
 * The registry the fetch for `pkg` went to, with its userinfo masked because a
 * registry URL can carry a bare token. The lookup is spawned the way
 * `packageRegistryView` spawns the fetch this describes (same manager, same
 * environment), so a registry the package manager keeps outside the .npmrc
 * chain and a scope resolved for itself both land on the value that fetch used.
 * Null where the manager yields no usable registry URL; throws where it cannot be run.
 */
export declare function getWorkspaceRegistryUrlForDisplay(pkg: string): string | null;
export declare function packageRegistryView(pkg: string, version: string, args: string[], options?: {
    forceNpm?: boolean;
}): Promise<string>;
/**
 * Only `npm pack` supports downloading a tarball of a specified remote
 * package. `yarn` packs the active workspace, `pnpm pack` only packs
 * the local project, and `bun` doesn't support pack.
 *
 * @param packDestination Directory passed to npm's `--pack-destination`, where
 * the `.tgz` is written.
 * @see https://github.com/nrwl/nx/pull/9667#discussion_r842553994
 */
export declare function packageRegistryPack(packDestination: string, pkg: string, version: string, options?: {
    bypassMinReleaseAge?: boolean;
}): Promise<{
    tarballPath: string;
}>;
export declare function clearPackageManagerVersionCache(): void;
/**
 * Gets the workspaces defined in the package manager configuration.
 * @returns workspaces defined in the package manager configuration, empty array if none are defined
 */
export declare function getPackageWorkspaces(packageManager?: PackageManager, root?: string): string[];
/**
 * Adds a package to the workspaces defined in the package manager configuration.
 * If the package is already included in the workspaces, it will not be added again.
 * @param packageManager The package manager to use. If not provided, it will be detected based on the lock file.
 * @param workspaces The workspaces to add the package to. Defaults to the workspaces defined in the package manager configuration.
 * @param root The directory the commands will be ran inside of. Defaults to the current workspace's root.
 * @param packagePath The path of the package to add to the workspaces
 */
export declare function addPackagePathToWorkspaces(packagePath: string, packageManager?: PackageManager, workspaces?: string[], root?: string): void;
