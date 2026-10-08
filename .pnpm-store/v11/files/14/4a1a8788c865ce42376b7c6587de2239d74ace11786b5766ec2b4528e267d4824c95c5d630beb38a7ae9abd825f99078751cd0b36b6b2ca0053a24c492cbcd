"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHybridMigration = exports.isPromptOnlyMigration = exports.filterDowngradedUpdates = exports.Migrator = exports.normalizeVersion = void 0;
exports.formatCommandFailure = formatCommandFailure;
exports.resolveCanonicalNxPackage = resolveCanonicalNxPackage;
exports.resolveInclude = resolveInclude;
exports.parseMigrationsOptions = parseMigrationsOptions;
exports.createFetcher = createFetcher;
exports.generateMigrationsJsonAndUpdatePackageJson = generateMigrationsJsonAndUpdatePackageJson;
exports.formatSkippedPromptsNextStep = formatSkippedPromptsNextStep;
exports.executeMigrations = executeMigrations;
exports.isRunPhaseInvocation = isRunPhaseInvocation;
exports.migrate = migrate;
exports.readLocalNxVersion = readLocalNxVersion;
exports.runMigration = runMigration;
exports.resolveMigrationForRun = resolveMigrationForRun;
exports.nxCliPath = nxCliPath;
const tslib_1 = require("tslib");
const pc = tslib_1.__importStar(require("picocolors"));
const child_process_1 = require("child_process");
const safe_prompt_1 = require("./safe-prompt");
const path_1 = require("path");
const module_1 = require("module");
const path_2 = require("../../utils/path");
const semver_1 = require("semver");
const node_url_1 = require("node:url");
const util_1 = require("util");
const fileutils_1 = require("../../utils/fileutils");
const tar_1 = require("../../utils/tar");
const write_formatted_json_file_1 = require("../../utils/write-formatted-json-file");
const shell_quoting_1 = require("../../utils/shell-quoting");
const logger_1 = require("../../utils/logger");
const git_utils_1 = require("../../utils/git-utils");
const package_json_1 = require("../../utils/package-json");
const package_manager_1 = require("../../utils/package-manager");
const errors_1 = require("../../utils/min-release-age/errors");
const resolve_package_version_1 = require("./resolve-package-version");
const handle_errors_1 = require("../../utils/handle-errors");
const connect_to_nx_cloud_1 = require("../nx-cloud/connect/connect-to-nx-cloud");
const output_1 = require("../../utils/output");
const fs_1 = require("fs");
const workspace_root_1 = require("../../utils/workspace-root");
const is_ci_1 = require("../../utils/is-ci");
const installation_directory_1 = require("../../utils/installation-directory");
const installed_nx_version_1 = require("../../utils/installed-nx-version");
const configuration_1 = require("../../config/configuration");
const child_process_2 = require("../../utils/child-process");
const client_1 = require("../../daemon/client/client");
const nx_cloud_utils_1 = require("../../utils/nx-cloud-utils");
const format_changed_files_1 = require("../../generators/internal-utils/format-changed-files");
const provenance_1 = require("../../utils/provenance");
const catalog_1 = require("../../utils/catalog");
const migrate_analytics_1 = require("./migrate-analytics");
const multi_major_1 = require("./multi-major");
const prompt_files_1 = require("./prompt-files");
const command_object_1 = require("./command-object");
const migrate_config_1 = require("./migrate-config");
const migrate_commits_1 = require("./migrate-commits");
const migrate_output_1 = require("./migrate-output");
const migration_shape_1 = require("./migration-shape");
Object.defineProperty(exports, "isHybridMigration", { enumerable: true, get: function () { return migration_shape_1.isHybridMigration; } });
Object.defineProperty(exports, "isPromptOnlyMigration", { enumerable: true, get: function () { return migration_shape_1.isPromptOnlyMigration; } });
const update_filters_1 = require("./update-filters");
Object.defineProperty(exports, "filterDowngradedUpdates", { enumerable: true, get: function () { return update_filters_1.filterDowngradedUpdates; } });
const version_utils_1 = require("./version-utils");
Object.defineProperty(exports, "normalizeVersion", { enumerable: true, get: function () { return version_utils_1.normalizeVersion; } });
const execute_migration_1 = require("./execute-migration");
const step_actions_1 = require("./step-actions");
const sort_migrations_1 = require("./sort-migrations");
const inception_1 = require("./agentic/inception");
const version_skew_guard_1 = require("./version-skew-guard");
const versions_1 = require("../../utils/versions");
tslib_1.__exportStar(require("./execute-migration"), exports);
const execAsync = (0, util_1.promisify)(child_process_1.exec);
function formatCommandFailure(command, error) {
    const normalizeCommandOutput = (output) => {
        if (!output) {
            return undefined;
        }
        const normalized = typeof output === 'string' ? output.trim() : output.toString().trim();
        return normalized || undefined;
    };
    const details = normalizeCommandOutput(error.stderr) ||
        normalizeCommandOutput(error.stdout) ||
        normalizeCommandOutput(error.message)
            ?.replace(`Command failed: ${command}`, '')
            .trim();
    return [`Command failed: ${command}`, ...(details ? [details] : [])].join('\n');
}
function runOrReturnExitCode(run) {
    try {
        run();
        return 0;
    }
    catch (e) {
        if (typeof e === 'object' &&
            e !== null &&
            'status' in e &&
            typeof e.status === 'number') {
            return e.status;
        }
        throw e;
    }
}
function cleanSemver(version) {
    return (0, semver_1.clean)(version) ?? (0, semver_1.coerce)(version);
}
function normalizeSlashes(packageName) {
    return packageName.replace(/\\/g, '/');
}
class Migrator {
    constructor(opts) {
        this.packageUpdates = {};
        this.collectedVersions = {};
        this.promptAnswers = {};
        this.pendingPackageJsonUpdates = new Map();
        this.appliedPackageJsonUpdates = new Set();
        if ((opts.include === 'required' || opts.include === 'optional') &&
            !opts.requiredPackages) {
            throw new Error(`Error: 'requiredPackages' is required when 'include' is '${opts.include}'.`);
        }
        this.packageJson = opts.packageJson;
        this.nxInstallation = opts.nxInstallation;
        this.getInstalledPackageVersion = opts.getInstalledPackageVersion;
        this.fetch = opts.fetch;
        this.installedPkgVersionOverrides = opts.from;
        this.to = opts.to;
        this.interactive = opts.interactive;
        this.excludeAppliedMigrations = opts.excludeAppliedMigrations;
        this.include = opts.include;
        this.requiredPackages = opts.requiredPackages;
    }
    async fetchMigrationConfig(packageName, packageVersion) {
        const migrationConfig = await this.fetch(packageName, packageVersion);
        if (!migrationConfig.version) {
            throw new Error(`Fetched migration metadata for ${packageName} is invalid: the target version is missing.`);
        }
        return migrationConfig;
    }
    async migrate(targetPackage, targetVersion) {
        await this.buildPackageJsonUpdates(targetPackage, {
            version: targetVersion,
            addToPackageJson: false,
        });
        await this.applyPendingPackageJsonUpdates();
        this.applyIncludeFilter();
        const { migrations, promptContents } = await this.createMigrateJson();
        return {
            packageUpdates: this.packageUpdates,
            migrations,
            ...(Object.keys(promptContents).length > 0 ? { promptContents } : {}),
            minVersionWithSkippedUpdates: this.minVersionWithSkippedUpdates,
        };
    }
    async createMigrateJson() {
        const promptContents = {};
        const migrations = await Promise.all(Object.keys(this.packageUpdates).map(async (packageName) => {
            if (this.packageUpdates[packageName].ignoreMigrations) {
                return [];
            }
            const currentVersion = this.getPkgVersion(packageName);
            if (currentVersion === null)
                return [];
            const { version } = this.packageUpdates[packageName];
            const { generators: migrationEntries, resolvedPromptFiles } = await this.fetchMigrationConfig(packageName, version);
            if (!migrationEntries)
                return [];
            if (resolvedPromptFiles) {
                for (const [promptPath, content] of Object.entries(resolvedPromptFiles)) {
                    promptContents[(0, prompt_files_1.promptContentKey)(packageName, promptPath)] = content;
                }
            }
            return Object.entries(migrationEntries)
                .filter(([, migration]) => migration.version &&
                this.gt(migration.version, currentVersion) &&
                this.lte(migration.version, version) &&
                this.areMigrationRequirementsMet(packageName, migration))
                .map(([migrationName, migration]) => ({
                ...migration,
                package: packageName,
                name: migrationName,
            }));
        }));
        return { migrations: migrations.flat(), promptContents };
    }
    async buildPackageJsonUpdates(targetPackage, target) {
        const packagesToCheck = await this.populatePackageJsonUpdatesAndGetPackagesToCheck(targetPackage, target);
        for (const packageToCheck of packagesToCheck) {
            const filteredUpdates = {};
            for (const [packageUpdateKey, packageUpdate] of Object.entries(packageToCheck.updates)) {
                Object.assign(filteredUpdates, await this.applyPackageJsonUpdate(packageToCheck.package, packageUpdateKey, packageUpdate));
            }
            await Promise.all(Object.entries(filteredUpdates).map(([name, update]) => this.buildPackageJsonUpdates(name, update)));
        }
    }
    async applyPackageJsonUpdate(sourcePackage, packageUpdateKey, packageUpdate) {
        const appliedKey = JSON.stringify([sourcePackage, packageUpdateKey]);
        if (this.appliedPackageJsonUpdates.has(appliedKey)) {
            this.pendingPackageJsonUpdates.delete(appliedKey);
            return {};
        }
        if (!this.areRequirementsMet(packageUpdate.requires) ||
            this.areIncompatiblePackagesPresent(packageUpdate.incompatibleWith)) {
            this.pendingPackageJsonUpdates.set(appliedKey, {
                package: sourcePackage,
                key: packageUpdateKey,
                update: packageUpdate,
            });
            return {};
        }
        this.pendingPackageJsonUpdates.delete(appliedKey);
        if (this.interactive &&
            !(await this.runPackageJsonUpdatesConfirmationPrompt(packageUpdate, packageUpdateKey, sourcePackage))) {
            return {};
        }
        this.appliedPackageJsonUpdates.add(appliedKey);
        const updateEntries = Object.entries(packageUpdate.packages);
        // Validate all up front so invalid metadata fails fast, before any
        // resolution does I/O.
        for (const [name, update] of updateEntries) {
            this.validatePackageUpdateVersion(sourcePackage, name, update);
        }
        const filteredUpdates = {};
        // Resolve serially: resolution can prompt (pnpm strict cooldown) and append
        // to minimumReleaseAgeExclude, so a serial loop avoids overlapping prompts
        // and keeps packageUpdates ordering stable.
        for (const [name, update] of updateEntries) {
            const resolvedUpdate = {
                ...update,
                version: await this.resolveVersionForCascade(name, update.version),
            };
            this.addPackageUpdate(name, resolvedUpdate);
            filteredUpdates[name] = this.packageUpdates[name];
        }
        return filteredUpdates;
    }
    async applyPendingPackageJsonUpdates() {
        while (this.pendingPackageJsonUpdates.size) {
            let applied = false;
            const filteredUpdates = {};
            for (const pending of [...this.pendingPackageJsonUpdates.values()]) {
                const updates = await this.applyPackageJsonUpdate(pending.package, pending.key, pending.update);
                if (Object.keys(updates).length) {
                    applied = true;
                    Object.assign(filteredUpdates, updates);
                }
            }
            if (!applied) {
                return;
            }
            await Promise.all(Object.entries(filteredUpdates).map(([name, update]) => this.buildPackageJsonUpdates(name, update)));
        }
    }
    async resolveVersionForCascade(packageName, version) {
        // Already a fully-qualified semver (incl. prereleases) - nothing to resolve.
        if ((0, semver_1.valid)(version)) {
            return version;
        }
        // Otherwise resolve the spec (range/tag) through the min-release-age policy,
        // which also honors any configured minimumReleaseAgeExclude entries.
        return (0, resolve_package_version_1.resolvePackageVersionRespectingMinReleaseAge)(packageName, version);
    }
    async populatePackageJsonUpdatesAndGetPackagesToCheck(targetPackage, target) {
        let targetVersion = target.version;
        if (this.to[targetPackage]) {
            targetVersion = this.to[targetPackage];
        }
        if (!this.getPkgVersion(targetPackage)) {
            this.addPackageUpdate(targetPackage, {
                version: target.version,
                addToPackageJson: target.addToPackageJson || false,
                ...(target.ignoreMigrations && { ignoreMigrations: true }),
            });
            return [];
        }
        let migrationConfig;
        try {
            migrationConfig = await this.fetchMigrationConfig(targetPackage, targetVersion);
        }
        catch (e) {
            // A cooldown violation must keep its type so the top-level handler can
            // surface its remediation; only a generic "no matching version" earns the
            // --to hint.
            if (!(e instanceof errors_1.MinReleaseAgeViolationError) &&
                e?.message?.includes('No matching version')) {
                throw new Error(`${e.message}\nRun migrate with --to="package1@version1,package2@version2"`);
            }
            else {
                throw e;
            }
        }
        targetVersion = migrationConfig.version;
        if (this.collectedVersions[targetPackage] &&
            (0, semver_1.gte)(this.collectedVersions[targetPackage], targetVersion)) {
            return [];
        }
        this.collectedVersions[targetPackage] = targetVersion;
        this.addPackageUpdate(targetPackage, {
            version: migrationConfig.version,
            addToPackageJson: target.addToPackageJson || false,
            ...(target.ignoreMigrations && { ignoreMigrations: true }),
        });
        const { packageJsonUpdates, packageGroupOrder } = this.getPackageJsonUpdatesFromMigrationConfig(targetPackage, targetVersion, migrationConfig, target.ignorePackageGroup);
        if (!Object.keys(packageJsonUpdates).length) {
            return [];
        }
        const shouldCheckUpdates = Object.values(packageJsonUpdates).some((packageJsonUpdate) => (this.interactive && packageJsonUpdate['x-prompt']) ||
            Object.keys(packageJsonUpdate.requires ?? {}).length ||
            Object.keys(packageJsonUpdate.incompatibleWith ?? {}).length);
        if (shouldCheckUpdates) {
            return [{ package: targetPackage, updates: packageJsonUpdates }];
        }
        const packageUpdatesToApply = Object.values(packageJsonUpdates).reduce((m, c) => ({ ...m, ...c.packages }), {});
        return (await Promise.all(Object.entries(packageUpdatesToApply).map(([packageName, packageUpdate]) => {
            this.validatePackageUpdateVersion(targetPackage, packageName, packageUpdate);
            return this.populatePackageJsonUpdatesAndGetPackagesToCheck(packageName, packageUpdate);
        })))
            .filter((pkgs) => pkgs.length)
            .flat()
            .sort((pkgUpdate1, pkgUpdate2) => packageGroupOrder.indexOf(pkgUpdate1.package) -
            packageGroupOrder.indexOf(pkgUpdate2.package));
    }
    getPackageJsonUpdatesFromMigrationConfig(packageName, targetVersion, migrationConfig, ignorePackageGroup) {
        const packageGroupOrder = this.getPackageJsonUpdatesFromPackageGroup(packageName, targetVersion, migrationConfig, ignorePackageGroup);
        if (!migrationConfig.packageJsonUpdates ||
            !this.getPkgVersion(packageName)) {
            return { packageJsonUpdates: {}, packageGroupOrder };
        }
        const packageJsonUpdates = this.filterPackageJsonUpdates(migrationConfig.packageJsonUpdates, packageName, targetVersion);
        return { packageJsonUpdates, packageGroupOrder };
    }
    /**
     * Mutates migrationConfig, adding package group updates into packageJsonUpdates section
     *
     * @param packageName Package which is being migrated
     * @param targetVersion Version which is being migrated to
     * @param migrationConfig Configuration which is mutated to contain package json updates
     * @returns Order of package groups
     */
    getPackageJsonUpdatesFromPackageGroup(packageName, targetVersion, migrationConfig, ignorePackageGroup) {
        if (ignorePackageGroup) {
            return [];
        }
        const packageGroup = packageName === '@nrwl/workspace' && (0, version_utils_1.isLegacyEra)(targetVersion)
            ? LEGACY_NRWL_PACKAGE_GROUP
            : (migrationConfig.packageGroup ?? []);
        let packageGroupOrder = [];
        if (packageGroup.length) {
            packageGroupOrder = packageGroup.map((packageConfig) => packageConfig.package);
            migrationConfig.packageJsonUpdates ??= {};
            const packages = {};
            migrationConfig.packageJsonUpdates[targetVersion + '--PackageGroup'] = {
                version: targetVersion,
                packages,
            };
            for (const packageConfig of packageGroup) {
                packages[packageConfig.package] = {
                    version: packageConfig.version === '*'
                        ? targetVersion
                        : packageConfig.version,
                    alwaysAddToPackageJson: false,
                };
                if (packageConfig.version === '*' &&
                    this.installedPkgVersionOverrides[packageName]) {
                    this.installedPkgVersionOverrides[packageConfig.package] ??=
                        this.installedPkgVersionOverrides[packageName];
                }
            }
        }
        return packageGroupOrder;
    }
    filterPackageJsonUpdates(packageJsonUpdates, packageName, targetVersion) {
        const filteredPackageJsonUpdates = {};
        for (const [packageJsonUpdateKey, packageJsonUpdate] of Object.entries(packageJsonUpdates)) {
            if (!packageJsonUpdate.packages ||
                this.lt(packageJsonUpdate.version, this.getPkgVersion(packageName)) ||
                this.gt(packageJsonUpdate.version, targetVersion)) {
                continue;
            }
            const dependencies = {
                ...this.packageJson?.dependencies,
                ...this.packageJson?.devDependencies,
                ...this.nxInstallation?.plugins,
                ...(this.nxInstallation && { nx: this.nxInstallation.version }),
            };
            const filtered = {};
            for (const [packageName, packageUpdate] of Object.entries(packageJsonUpdate.packages)) {
                if (this.shouldExcludePackage(packageName)) {
                    continue;
                }
                if (this.shouldApplyPackageUpdate(packageUpdate, packageName, dependencies)) {
                    filtered[packageName] = {
                        version: packageUpdate.version,
                        addToPackageJson: packageUpdate.alwaysAddToPackageJson
                            ? typeof packageUpdate.alwaysAddToPackageJson === 'string'
                                ? packageUpdate.alwaysAddToPackageJson
                                : 'dependencies'
                            : packageUpdate.addToPackageJson || false,
                        ...(packageUpdate.ignorePackageGroup && {
                            ignorePackageGroup: true,
                        }),
                        ...(packageUpdate.ignoreMigrations && {
                            ignoreMigrations: true,
                        }),
                    };
                }
            }
            if (Object.keys(filtered).length) {
                packageJsonUpdate.packages = filtered;
                filteredPackageJsonUpdates[packageJsonUpdateKey] = packageJsonUpdate;
            }
        }
        return filteredPackageJsonUpdates;
    }
    shouldExcludePackage(packageName) {
        if (!this.requiredPackages) {
            return false;
        }
        if (this.include === 'required') {
            return !this.requiredPackages.has(packageName);
        }
        return false;
    }
    applyIncludeFilter() {
        if (this.include !== 'optional') {
            return;
        }
        // Cascade walks through the required packages so cross-plugin optional
        // deps (e.g. typescript managed by @nx/js but used by @nx/angular) get
        // surfaced. Drop the required set from the final result here so only
        // optional updates land in package.json.
        for (const name of Object.keys(this.packageUpdates)) {
            if (this.requiredPackages.has(name)) {
                delete this.packageUpdates[name];
            }
        }
    }
    shouldApplyPackageUpdate(packageUpdate, packageName, dependencies) {
        return ((!packageUpdate.ifPackageInstalled ||
            this.getPkgVersion(packageUpdate.ifPackageInstalled)) &&
            (packageUpdate.alwaysAddToPackageJson ||
                packageUpdate.addToPackageJson ||
                !!dependencies?.[packageName]) &&
            (!this.collectedVersions[packageName] ||
                this.gt(packageUpdate.version, this.collectedVersions[packageName])));
    }
    validatePackageUpdateVersion(sourcePackageName, packageName, packageUpdate) {
        if (!packageUpdate.version) {
            throw new Error(`Fetched migration metadata for ${sourcePackageName} is invalid: the target version for ${packageName} is missing.`);
        }
    }
    addPackageUpdate(name, packageUpdate) {
        if (!this.packageUpdates[name] ||
            !this.lt(packageUpdate.version, this.packageUpdates[name].version)) {
            this.packageUpdates[name] = packageUpdate;
        }
    }
    areRequirementsMet(requirements) {
        if (!requirements || !Object.keys(requirements).length) {
            return true;
        }
        return Object.entries(requirements).every(([pkgName, versionRange]) => {
            if (this.packageUpdates[pkgName]) {
                return (0, semver_1.satisfies)(cleanSemver(this.packageUpdates[pkgName].version), versionRange, { includePrerelease: true });
            }
            return (this.getPkgVersion(pkgName) &&
                (0, semver_1.satisfies)(this.getPkgVersion(pkgName), versionRange, {
                    includePrerelease: true,
                }));
        });
    }
    areIncompatiblePackagesPresent(incompatibleWith) {
        if (!incompatibleWith || !Object.keys(incompatibleWith).length) {
            return false;
        }
        return Object.entries(incompatibleWith).some(([pkgName, versionRange]) => {
            if (this.packageUpdates[pkgName]) {
                return (0, semver_1.satisfies)(cleanSemver(this.packageUpdates[pkgName].version), versionRange, { includePrerelease: true });
            }
            return (this.getPkgVersion(pkgName) &&
                (0, semver_1.satisfies)(this.getPkgVersion(pkgName), versionRange, {
                    includePrerelease: true,
                }));
        });
    }
    areMigrationRequirementsMet(packageName, migration) {
        if (!this.excludeAppliedMigrations) {
            return this.areRequirementsMet(migration.requires);
        }
        return ((this.wasMigrationSkipped(migration.requires) ||
            this.isMigrationForHigherVersionThanWhatIsInstalled(packageName, migration)) &&
            this.areRequirementsMet(migration.requires));
    }
    isMigrationForHigherVersionThanWhatIsInstalled(packageName, migration) {
        const installedVersion = this.getInstalledPackageVersion(packageName);
        return (migration.version &&
            (!installedVersion || this.gt(migration.version, installedVersion)) &&
            this.lte(migration.version, this.packageUpdates[packageName].version));
    }
    wasMigrationSkipped(requirements) {
        // no requiremets, so it ran before
        if (!requirements || !Object.keys(requirements).length) {
            return false;
        }
        // at least a requirement was not met, it was skipped
        return Object.entries(requirements).some(([pkgName, versionRange]) => !this.getInstalledPackageVersion(pkgName) ||
            !(0, semver_1.satisfies)(this.getInstalledPackageVersion(pkgName), versionRange, {
                includePrerelease: true,
            }));
    }
    async runPackageJsonUpdatesConfirmationPrompt(packageUpdate, packageUpdateKey, packageName) {
        if (!packageUpdate['x-prompt']) {
            return Promise.resolve(true);
        }
        const promptKey = this.getPackageUpdatePromptKey(packageUpdate);
        if (this.promptAnswers[promptKey] !== undefined) {
            // a same prompt was already answered, skip
            return Promise.resolve(false);
        }
        // No footer slot, so the docs link is appended to the message.
        const detailsLink = packageName.startsWith('@nx/')
            ? pc.dim(`\n  View migration details at https://nx.dev/nx-api/${packageName.replace('@nx/', '')}#${packageUpdateKey.replace(/[-\.]/g, '')}packageupdates`)
            : '';
        return await (0, safe_prompt_1.migrateConfirm)({
            message: `${packageUpdate['x-prompt']}${detailsLink}`,
            initial: true,
        }).then((shouldApply) => {
            this.promptAnswers[promptKey] = shouldApply;
            if (!shouldApply &&
                (!this.minVersionWithSkippedUpdates ||
                    (0, semver_1.lt)(packageUpdate.version, this.minVersionWithSkippedUpdates))) {
                this.minVersionWithSkippedUpdates = packageUpdate.version;
            }
            return shouldApply;
        });
    }
    getPackageUpdatePromptKey(packageUpdate) {
        return Object.entries(packageUpdate.packages)
            .map(([name, update]) => `${name}:${JSON.stringify(update)}`)
            .join('|');
    }
    getPkgVersion(pkg) {
        return this.getInstalledPackageVersion(pkg, this.installedPkgVersionOverrides);
    }
    gt(v1, v2) {
        return (0, semver_1.gt)((0, version_utils_1.normalizeVersion)(v1), (0, version_utils_1.normalizeVersion)(v2));
    }
    lt(v1, v2) {
        return (0, semver_1.lt)((0, version_utils_1.normalizeVersion)(v1), (0, version_utils_1.normalizeVersion)(v2));
    }
    lte(v1, v2) {
        return (0, semver_1.lte)((0, version_utils_1.normalizeVersion)(v1), (0, version_utils_1.normalizeVersion)(v2));
    }
}
exports.Migrator = Migrator;
const LEGACY_NRWL_PACKAGE_GROUP = [
    { package: '@nrwl/workspace', version: '*' },
    { package: '@nrwl/angular', version: '*' },
    { package: '@nrwl/cypress', version: '*' },
    { package: '@nrwl/devkit', version: '*' },
    { package: '@nrwl/eslint-plugin-nx', version: '*' },
    { package: '@nrwl/express', version: '*' },
    { package: '@nrwl/jest', version: '*' },
    { package: '@nrwl/linter', version: '*' },
    { package: '@nrwl/nest', version: '*' },
    { package: '@nrwl/next', version: '*' },
    { package: '@nrwl/node', version: '*' },
    { package: '@nrwl/nx-plugin', version: '*' },
    { package: '@nrwl/react', version: '*' },
    { package: '@nrwl/storybook', version: '*' },
    { package: '@nrwl/web', version: '*' },
    { package: '@nrwl/js', version: '*' },
    { package: 'nx-cloud', version: 'latest' },
    { package: '@nrwl/react-native', version: '*' },
    { package: '@nrwl/detox', version: '*' },
    { package: '@nrwl/expo', version: '*' },
    { package: '@nrwl/tao', version: '*' },
];
function resolveRequiredPackages(targetPackage, packageGroup) {
    const set = new Set([targetPackage]);
    for (const { package: name } of packageGroup ?? []) {
        set.add(name);
    }
    return set;
}
/**
 * The canonical Nx package for a given target version: `@nrwl/workspace` for
 * legacy (`< 14.0.0-beta.0`), `nx` otherwise. Non-semver inputs (e.g. the
 * literal `'latest'` sentinel before tag resolution) resolve to modern era.
 */
function resolveCanonicalNxPackage(targetVersion) {
    return (0, version_utils_1.isLegacyEra)(targetVersion) ? '@nrwl/workspace' : 'nx';
}
/**
 * `@nx/workspace` is version-synced with `nx` but declares an intentionally
 * narrow `packageGroup`; resolve eligibility, bounds, and the optional walk
 * against `nx`'s full closure so they match what the cascade actually walks.
 */
function toNxClosurePackage(packageName) {
    return packageName === '@nx/workspace' ? 'nx' : packageName;
}
async function resolveInclude(include, context, configuredInclude) {
    // An explicit `--include` is validated against the target's `supportsOptionalMigrations` in
    // `resolveTargetAndInclude`, so honor it directly here.
    if (include) {
        (0, migrate_analytics_1.setMigrateIncludeSource)('flag');
        return include;
    }
    // Targets that don't declare `supportsOptionalMigrations` only ever run the full
    // migration; there is nothing to pick between.
    if (!context.targetSupportsOptionalUpdates) {
        if (configuredInclude && configuredInclude !== 'all') {
            output_1.output.warn({
                title: `The configured nx.json migrate.include '${configuredInclude}' is not available for this migration; falling back to 'all'.`,
                bodyLines: [`The target package does not support optional updates.`],
            });
        }
        (0, migrate_analytics_1.setMigrateIncludeSource)('default');
        return 'all';
    }
    // nx.json `migrate.include` pre-selects the answer the prompt would ask for.
    if (configuredInclude) {
        (0, migrate_analytics_1.setMigrateIncludeSource)('nx-json');
        return configuredInclude;
    }
    const choices = [
        {
            value: 'required',
            label: 'Required only (the target package and the packages it ships with)',
        },
    ];
    // `--interactive` keeps the legacy x-prompt flow, which the `optional` value
    // supersedes and is incompatible with, so omit it when interactive.
    if (!context.hasFrom &&
        !context.hasExcludeAppliedMigrations &&
        context.interactive !== true) {
        choices.push({
            value: 'optional',
            label: 'Optional only (the dependency updates those packages recommend)',
        });
    }
    if (!(0, safe_prompt_1.canPrompt)(context.interactive)) {
        (0, migrate_analytics_1.setMigrateIncludeSource)('default');
        return 'all';
    }
    choices.push({
        value: 'all',
        label: 'All (required and optional)',
    });
    const selected = await (0, safe_prompt_1.migrateChoice)({
        message: 'Which packages would you like to migrate?',
        choices,
    });
    (0, migrate_analytics_1.reportMigratePrompt)('include', selected);
    (0, migrate_analytics_1.setMigrateIncludeSource)('prompt');
    return selected;
}
async function versionOverrides(overrides, param) {
    const res = {};
    const promises = overrides.split(',').map((p) => {
        const split = p.lastIndexOf('@');
        if (split === -1 || split === 0) {
            throw new Error(`Incorrect '${param}' section. Use --${param}="package@version"`);
        }
        const selectedPackage = p.substring(0, split).trim();
        const selectedVersion = p.substring(split + 1).trim();
        if (!selectedPackage || !selectedVersion) {
            throw new Error(`Incorrect '${param}' section. Use --${param}="package@version"`);
        }
        return (0, version_utils_1.normalizeVersionWithTagCheck)(selectedPackage, selectedVersion).then((version) => {
            res[normalizeSlashes(selectedPackage)] = version;
        });
    });
    await Promise.all(promises);
    return res;
}
async function parseTargetPackageAndVersion(args) {
    if (!args) {
        throw new Error(`Provide the correct package name and version. E.g., my-package@9.0.0.`);
    }
    if (args.indexOf('@') > -1) {
        const i = args.lastIndexOf('@');
        if (i === 0) {
            return { targetPackage: args.trim(), targetVersion: 'latest' };
        }
        const targetPackage = args.substring(0, i);
        const maybeVersion = args.substring(i + 1);
        if (!targetPackage || !maybeVersion) {
            throw new Error(`Provide the correct package name and version. E.g., my-package@9.0.0.`);
        }
        const targetVersion = await (0, version_utils_1.normalizeVersionWithTagCheck)(targetPackage, maybeVersion);
        return { targetPackage, targetVersion };
    }
    if (version_utils_1.DIST_TAGS.includes(args) ||
        (0, semver_1.valid)(args) ||
        args.match(/^\d+(?:\.\d+)?(?:\.\d+)?$/)) {
        // Passing `nx` here may seem wrong, but nx and @nrwl/workspace are synced in version.
        // We could duplicate the ternary below, but its not necessary since they are equivalent
        // on the registry
        const targetVersion = await (0, version_utils_1.normalizeVersionWithTagCheck)('nx', args);
        const isDistTag = version_utils_1.DIST_TAGS.includes(args);
        const targetPackage = isDistTag
            ? 'nx'
            : resolveCanonicalNxPackage(targetVersion);
        return { targetPackage, targetVersion };
    }
    return { targetPackage: args, targetVersion: 'latest' };
}
async function parseMigrationsOptions(options, fetch) {
    // A run recorded or reconciled via `--run-id` is driven by the outer agent;
    // spawning another agent from it would double-drive the run. Only the
    // explicit "on" values conflict; the nx.json default is ignored for
    // `--run-id` invocations instead.
    if (options.runId !== undefined &&
        options.agentic !== undefined &&
        options.agentic !== false) {
        throw new Error(`Error: '--agentic' cannot be combined with '--run-id'.`);
    }
    if (options.runMigration !== undefined) {
        if (options.runMigration === '') {
            throw new Error(`Error: '--run-migration' requires a migration id, e.g. '--run-migration=@nx/js:my-migration'.`);
        }
        if (options.runId === '') {
            throw new Error(`Error: '--run-id' requires the id of the migrate run to record into.`);
        }
        if (options.stepAction !== undefined) {
            throw new Error(`Error: '--step-action' cannot be combined with '--run-migration'. It applies to an orchestrated reconcile ('--run-id' without '--run-migration').`);
        }
        if (options.runMigrations !== undefined) {
            throw new Error(`Error: '--run-migration' (run a single migration) cannot be combined with '--run-migrations' (run the whole migrations file).`);
        }
        if (options.include) {
            throw new Error(`Error: '--run-migration' cannot be combined with '--include'.`);
        }
        if (options.multiMajorMode) {
            throw new Error(`Error: '--run-migration' cannot be combined with '--multi-major-mode'.`);
        }
        // `--if-exists` only applies to a whole-file run, so an explicit "on"
        // conflicts. Its yargs default (false) is always present and is tolerated.
        if (options.ifExists === true) {
            throw new Error(`Error: '--run-migration' cannot be combined with '--if-exists'.`);
        }
        return {
            type: 'runSingleMigration',
            runMigration: options.runMigration,
            runId: options.runId,
            agentic: options.agentic,
            validate: options.validate,
            interactive: options.interactive,
        };
    }
    if (options.runId !== undefined) {
        // Empty '--run-id' is an error on every path.
        if (options.runId === '') {
            throw new Error(`Error: '--run-id' requires the id of the migrate run to record into.`);
        }
        if (options.runMigrations !== undefined) {
            throw new Error(`Error: '--run-id' (reconcile an orchestrated run) cannot be combined with '--run-migrations' (run the whole migrations file).`);
        }
        // A bare '--run-id' reconciles the run it names. Ungated, unlike init:
        // the id has to name a run directory that exists, and only a gated init
        // ever creates one.
        // yargs' choices already reject bad CLI values; this guards programmatic
        // callers, where silently dropping the action would reconcile without it.
        if (options.stepAction !== undefined && !(0, step_actions_1.isStepAction)(options.stepAction)) {
            throw new Error(`Error: '--step-action' must be one of ${step_actions_1.STEP_ACTIONS.join(', ')}.`);
        }
        return {
            type: 'orchestratorReconcile',
            runId: options.runId,
            ...(options.stepAction !== undefined
                ? { stepAction: options.stepAction }
                : {}),
        };
    }
    if (options.stepAction !== undefined) {
        throw new Error(`Error: '--step-action' requires '--run-id'.`);
    }
    if (options.runMigrations === '') {
        options.runMigrations = 'migrations.json';
    }
    if (options.include && options.runMigrations) {
        throw new Error(`Error: '--include' cannot be combined with '--run-migrations'.`);
    }
    if (options.multiMajorMode && options.runMigrations) {
        throw new Error(`Error: '--multi-major-mode' cannot be combined with '--run-migrations'.`);
    }
    if (options.runMigrations) {
        return {
            type: 'runMigrations',
            runMigrations: options.runMigrations,
            ifExists: options.ifExists,
            agentic: options.agentic,
            validate: options.validate,
            interactive: options.interactive,
        };
    }
    assertOptionalIncludeFlagCompatibility(options);
    const [from, to] = await Promise.all([
        options.from
            ? versionOverrides(options.from, 'from')
            : Promise.resolve({}),
        options.to
            ? await versionOverrides(options.to, 'to')
            : Promise.resolve({}),
    ]);
    // The gate reads `supportsOptionalMigrations` through this fetcher (registry-first, install
    // fallback) so private registries don't fail closed. In production the caller
    // shares its fetcher; standalone callers (tests) get a fresh one.
    const resolvedFetch = fetch ?? createFetcher((0, package_manager_1.getPackageManagerCommand)());
    const positional = options['packageAndVersion'];
    const resolved = await resolveTargetAndInclude({
        positional,
        from,
        options,
        fetch: resolvedFetch,
    });
    const { include, installedTargetVersion } = resolved;
    let { targetPackage, targetVersion } = resolved;
    // Crossing more than one major can silently skip migrations: each
    // major's metadata may have pruned entries from much-older versions.
    const multiMajorResult = await (0, multi_major_1.maybePromptOrWarnMultiMajorMigration)({
        include,
        options,
        targetPackage,
        targetVersion,
    });
    targetVersion = multiMajorResult.chosen;
    if (include === 'optional') {
        // `include` can resolve to optional via nx.json, which bypasses the early
        // CLI-only check above; re-assert against the resolved value.
        assertOptionalIncludeFlagCompatibility({
            include,
            from: options.from,
            excludeAppliedMigrations: options.excludeAppliedMigrations,
            interactive: options.interactive,
        });
        assertOptionalTargetBounds({
            targetPackage,
            targetVersion,
            to,
            // `resolveTargetAndInclude` always resolves the installed bounds version for
            // the `optional` value (or throws), so it is present here.
            installedTargetVersion: installedTargetVersion,
        });
    }
    return {
        type: 'generateMigrations',
        targetPackage,
        targetVersion,
        from,
        to,
        interactive: options.interactive,
        excludeAppliedMigrations: options.excludeAppliedMigrations,
        include,
        originalTargetVersion: multiMajorResult.originalTarget,
        multiMajorMode: multiMajorResult.gradual ? 'gradual' : undefined,
        multiMajorChoice: multiMajorResult.decision,
    };
}
function assertOptionalIncludeFlagCompatibility(options) {
    if (options.include !== 'optional')
        return;
    if (options.from) {
        throw new Error(`Error: '--include=optional' cannot be combined with '--from'.`);
    }
    if (options.excludeAppliedMigrations === true) {
        throw new Error(`Error: '--include=optional' cannot be combined with '--exclude-applied-migrations'.`);
    }
    if (options.interactive === true) {
        throw new Error(`Error: '--include=optional' cannot be combined with '--interactive'.`);
    }
}
// Resolves the target package/version up front (the `optional` value anchors to
// the installed target; otherwise dist-tags resolve to a concrete version), then
// resolves the include value and rejects `--include` when the target doesn't support it.
// Bare invocations require an explicit target on older installs rather than
// defaulting to `latest` across a large major gap.
async function resolveTargetAndInclude(args) {
    const { positional, from, options, fetch } = args;
    let targetPackage;
    let targetVersion;
    if (positional) {
        const parsed = await parseTargetPackageAndVersion(positional);
        targetPackage = normalizeSlashes(parsed.targetPackage);
        targetVersion = parsed.targetVersion;
    }
    const installed = resolveInstalledCanonical();
    const installedMajor = installed && (0, semver_1.valid)(installed.version) ? (0, semver_1.major)(installed.version) : null;
    // `--include=optional` anchors the target to the installed version below, so
    // it never needs a target or dist-tag resolved up front.
    const isExplicitOptional = options.include === 'optional';
    // Bare `nx migrate` defaults to `nx@latest`. Only do so from a recent-enough
    // install (v22+); an unknown or far-behind version would otherwise silently
    // run a large multi-major jump, so require an explicit target there instead.
    if (!positional && !isExplicitOptional) {
        if (installedMajor === null || installedMajor < 22) {
            throw new Error(`Provide the package and version to migrate to. E.g., \`nx migrate nx@<version>\`.`);
        }
        targetPackage = 'nx';
        targetVersion = 'latest';
    }
    // Resolve dist-tags to a concrete version so the `supportsOptionalMigrations` gate and the
    // downstream cascade read a real semver. Explicit dist-tags arrive already
    // resolved from `parseTargetPackageAndVersion`; only bare invocations and
    // bare package names (`nx migrate nx`) reach here unresolved.
    if (!isExplicitOptional &&
        targetPackage &&
        targetVersion &&
        !(0, semver_1.valid)(targetVersion)) {
        try {
            targetVersion = await (0, version_utils_1.normalizeVersionWithTagCheck)(targetPackage, targetVersion);
        }
        catch {
            // Registry unavailable: keep the tag. The sentinel degrades gracefully
            // downstream (multi-major and the cascade tolerate it).
        }
    }
    // `--include` is only available for targets that opt in via `supportsOptionalMigrations`.
    // required/all/prompt/nx.json read the flag at the version being migrated
    // to. Skipped when the include value can't depend on it (no `--include`, no nx.json
    // default, no interactive prompt) and for the explicit `optional` value, which
    // anchors to the installed target and reads at that version below.
    let targetSupportsOptionalUpdates = false;
    // The package/version whose `supportsOptionalMigrations` flag the gate actually read,
    // surfaced verbatim in the rejection message below.
    let eligibilityPackage = targetPackage;
    let eligibilityVersion = targetVersion;
    if (!isExplicitOptional &&
        targetPackage &&
        (options.include ||
            options.includeFromConfig ||
            (0, safe_prompt_1.canPrompt)(options.interactive))) {
        // Read at the canonical closure package so the gate shares the cascade's
        // cached fetch (the walk normalizes `@nx/workspace` -> `nx` too).
        eligibilityPackage = toNxClosurePackage(targetPackage);
        targetSupportsOptionalUpdates = await fetchSupportsOptionalUpdates(fetch, eligibilityPackage, targetVersion);
    }
    // Recorded before the interactive prompts (include, multi-major) so runs
    // abandoned at a prompt still register a start.
    (0, migrate_analytics_1.reportMigrateGenerateStart)({
        targetPackage: targetPackage ?? 'nx',
        interactive: options.interactive,
        excludeAppliedMigrations: options.excludeAppliedMigrations,
    });
    const include = await resolveInclude(options.include, {
        hasFrom: Object.keys(from).length > 0,
        hasExcludeAppliedMigrations: options.excludeAppliedMigrations === true,
        interactive: options.interactive,
        targetSupportsOptionalUpdates,
    }, options.includeFromConfig);
    let installedTargetVersion;
    // The `optional` value catches up the deps the target manages for the version
    // you are already on, capped at the installed version. `@nx/workspace` is
    // version-synced with `nx` but declares a narrower group, so resolve the
    // installed bounds against `nx`'s full closure.
    if (include === 'optional') {
        if (!positional) {
            // Bare `--include=optional`: catch up the deps Nx manages for installed Nx.
            if (!installed) {
                throw new Error(`Error: '--include=optional' requires 'nx' (or '@nrwl/workspace' on Nx <14) to be installed in your workspace. Install dependencies first, then re-run.`);
            }
            targetPackage = installed.canonical;
            installedTargetVersion = installed.version;
            targetVersion = installedTargetVersion;
        }
        else {
            const boundsPackage = toNxClosurePackage(targetPackage);
            installedTargetVersion = (0, installed_nx_version_1.getInstalledVersion)(boundsPackage);
            if (!installedTargetVersion) {
                throw new Error(`Error: '--include=optional' requires '${boundsPackage}' to be installed in your workspace. Install dependencies first, then re-run.`);
            }
            // A bare package name (no semver, surfaced as the literal `'latest'`)
            // anchors the catch-up walk to installed; an explicit version is kept and
            // bounded against installed downstream.
            if (!(0, semver_1.valid)(targetVersion)) {
                targetVersion = installedTargetVersion;
            }
        }
        // An explicit `--include=optional` is gated on the INSTALLED version's flag:
        // you catch up the deps you already have, so eligibility follows the
        // installed package, not the (possibly older) explicit target. Config /
        // prompt-derived `optional` value was already vetted via the to-target read.
        if (options.include === 'optional') {
            eligibilityPackage = toNxClosurePackage(targetPackage);
            eligibilityVersion = installedTargetVersion;
            targetSupportsOptionalUpdates = await fetchSupportsOptionalUpdates(fetch, eligibilityPackage, installedTargetVersion);
        }
    }
    if (options.include && !targetSupportsOptionalUpdates) {
        throw new Error(`Error: '--include' requires the target package to support optional updates, but '${eligibilityPackage}@${eligibilityVersion}' does not.`);
    }
    return {
        targetPackage: targetPackage,
        targetVersion: targetVersion,
        include,
        installedTargetVersion,
    };
}
// `--include` is opt-in per package via `supportsOptionalMigrations` in the target's
// `nx-migrations`/`ng-update` config. Read it through the shared fetcher
// (registry-first, install fallback) so registries that can't serve metadata
// via `npm view` resolve it from an install rather than failing the gate.
async function fetchSupportsOptionalUpdates(fetch, packageName, packageVersion) {
    const config = await fetch(packageName, packageVersion);
    return config.supportsOptionalMigrations === true;
}
// `--include=optional` upper-bound gate. The optional walk catches up from
// zero, so a target or `--to` above the installed version would surface
// optional bumps that only exist in the newer package's history. The
// required set is the target package's declared `packageGroup`; the legacy
// era falls back to the hardcoded `LEGACY_NRWL_PACKAGE_GROUP`. `installed` is
// the installed bounds version already resolved by `resolveTargetAndInclude`.
function assertOptionalTargetBounds(args) {
    const { targetPackage, targetVersion, to, installedTargetVersion: installed, } = args;
    const boundsPackage = toNxClosurePackage(targetPackage);
    if ((0, semver_1.gt)(targetVersion, installed)) {
        throw new Error(`Error: '--include=optional' cannot migrate to a version higher than what is currently installed (got '${targetPackage}@${targetVersion}', installed '${boundsPackage}@${installed}'). Either drop '--include=optional' or lower the target.`);
    }
    const requiredSet = (0, version_utils_1.isLegacyEra)(targetVersion)
        ? new Set([
            boundsPackage,
            ...LEGACY_NRWL_PACKAGE_GROUP.map((p) => p.package),
        ])
        : (0, installed_nx_version_1.getInstalledPackageGroup)(boundsPackage);
    for (const [pkg, version] of Object.entries(to)) {
        if (requiredSet.has(pkg) && (0, semver_1.gt)(version, installed)) {
            throw new Error(`Error: '--include=optional' cannot migrate to a version higher than what is currently installed (got '--to ${pkg}@${version}', installed '${boundsPackage}@${installed}'). Either drop '--include=optional' or lower the '--to' value.`);
        }
    }
}
/**
 * Pick the canonical Nx package + version for `--include=optional` when the
 * user didn't supply an explicit version. Returns `'nx'` for modern era,
 * falls back to `'@nrwl/workspace'` (legacy era) when only that is installed
 * or when the installed `nx` itself is `<14`.
 */
function resolveInstalledCanonical() {
    const installedNx = (0, installed_nx_version_1.getInstalledNxVersion)();
    if (installedNx) {
        return {
            canonical: resolveCanonicalNxPackage(installedNx),
            version: installedNx,
        };
    }
    const installedLegacy = (0, installed_nx_version_1.getInstalledLegacyNrwlWorkspaceVersion)();
    if (installedLegacy) {
        return { canonical: '@nrwl/workspace', version: installedLegacy };
    }
    return null;
}
function createInstalledPackageVersionsResolver(root) {
    const cache = {};
    const nxRequires = (0, installation_directory_1.getNxRequirePaths)(root).map((path) => (0, module_1.createRequire)((0, path_1.join)(path, 'package.json')));
    function getInstalledPackageVersion(packageName, overrides) {
        if (overrides?.[packageName]) {
            return overrides[packageName];
        }
        if (packageName === 'nx') {
            const nxVersion = cache[packageName] ??
                (() => {
                    for (const req of nxRequires) {
                        try {
                            const packageJsonPath = req.resolve('nx/package.json');
                            if (packageJsonPath.startsWith(workspace_root_1.workspaceRoot)) {
                                return (0, fileutils_1.readJsonFile)(packageJsonPath).version;
                            }
                        }
                        catch { }
                    }
                    return getInstalledPackageVersion('@nrwl/workspace', overrides);
                })();
            if (nxVersion) {
                cache[packageName] = nxVersion;
            }
            return nxVersion;
        }
        try {
            if (!cache[packageName]) {
                const { packageJson, path } = (0, package_json_1.readModulePackageJson)(packageName, (0, installation_directory_1.getNxRequirePaths)(root));
                // old workspaces would have the temp installation of nx in the cache,
                // so the resolved package is not the one we need
                if (!path.startsWith(workspace_root_1.workspaceRoot)) {
                    throw new Error('Resolved a package outside the workspace root.');
                }
                cache[packageName] = packageJson.version;
            }
            return cache[packageName];
        }
        catch {
            return null;
        }
    }
    return getInstalledPackageVersion;
}
// testing-fetch-start
function createFetcher(pmc) {
    const migrationsCache = {};
    const resolvedVersionCache = {};
    const stats = { registryCount: 0, installCount: 0 };
    function recordInstallFetch(reason) {
        stats.installCount++;
        stats.fallbackReason ??= reason;
    }
    function fetchMigrations(packageName, packageVersion, setCache) {
        if (!(0, resolve_package_version_1.isRegistryResolutionEnabled)()) {
            // Skip registry fetch and use installation method directly
            logger_1.logger.info(`Fetching ${packageName}@${packageVersion}`);
            recordInstallFetch('env-skip');
            return getPackageMigrationsUsingInstall(packageName, packageVersion, pmc);
        }
        const cacheKey = packageName + '-' + packageVersion;
        return Promise.resolve(resolvedVersionCache[cacheKey])
            .then((cachedResolvedVersion) => {
            if (cachedResolvedVersion) {
                return cachedResolvedVersion;
            }
            resolvedVersionCache[cacheKey] =
                (0, resolve_package_version_1.resolvePackageVersionRespectingMinReleaseAge)(packageName, packageVersion);
            return resolvedVersionCache[cacheKey];
        })
            .then((resolvedVersion) => {
            if (resolvedVersion !== packageVersion &&
                migrationsCache[`${packageName}-${resolvedVersion}`]) {
                return migrationsCache[`${packageName}-${resolvedVersion}`];
            }
            setCache(packageName, resolvedVersion);
            return getPackageMigrationsUsingRegistry(packageName, resolvedVersion).then((result) => {
                stats.registryCount++;
                return result;
            });
        })
            .catch((e) => {
            // A cooldown violation would fail an install identically (only slower),
            // so surface it instead of retrying through the package manager.
            if (e instanceof errors_1.MinReleaseAgeViolationError) {
                throw e;
            }
            logger_1.logger.verbose(`Failed to get migrations from registry for ${packageName}@${packageVersion}: ${e.message}. Falling back to install.`);
            logger_1.logger.info(`Fetching ${packageName}@${packageVersion}`);
            recordInstallFetch((0, migrate_analytics_1.classifyMigrateFetchFallback)(e));
            return getPackageMigrationsUsingInstall(packageName, packageVersion, pmc);
        });
    }
    const nxMigrateFetcher = (packageName, packageVersion) => {
        if (migrationsCache[`${packageName}-${packageVersion}`]) {
            return migrationsCache[`${packageName}-${packageVersion}`];
        }
        let resolvedVersion = packageVersion;
        let migrations;
        function setCache(packageName, packageVersion) {
            migrationsCache[packageName + '-' + packageVersion] = migrations;
        }
        migrations = fetchMigrations(packageName, packageVersion, setCache).then((result) => {
            // An exact requested version must come back verbatim; a mismatch means
            // a config surface (registry proxy, override, cooldown gate) silently
            // substituted another version, which would corrupt the whole plan.
            if ((0, semver_1.valid)(packageVersion) &&
                result.version &&
                result.version !== packageVersion) {
                throw new Error(`Fetching ${packageName}@${packageVersion} resolved to version ${result.version}. ` +
                    `Check for registry, override, or minimum-release-age configuration that hides the requested version.`);
            }
            if (result.schematics) {
                result.generators = { ...result.schematics, ...result.generators };
                delete result.schematics;
            }
            resolvedVersion = result.version;
            return result;
        });
        setCache(packageName, packageVersion);
        return migrations;
    };
    nxMigrateFetcher.stats = stats;
    return nxMigrateFetcher;
}
// testing-fetch-end
async function getPackageMigrationsUsingRegistry(packageName, packageVersion) {
    if ((0, provenance_1.getNxPackageGroup)().includes(packageName)) {
        await (0, provenance_1.ensurePackageHasProvenance)(packageName, packageVersion);
    }
    // check if there are migrations in the packages by looking at the
    // registry directly
    const migrationsConfig = await getPackageMigrationsConfigFromRegistry(packageName, packageVersion);
    if (!migrationsConfig) {
        return {
            name: packageName,
            version: packageVersion,
        };
    }
    if (!migrationsConfig.migrations) {
        return {
            name: packageName,
            version: packageVersion,
            packageGroup: migrationsConfig.packageGroup,
            supportsOptionalMigrations: migrationsConfig.supportsOptionalMigrations,
        };
    }
    logger_1.logger.info(`Fetching ${packageName}@${packageVersion}`);
    // try to obtain the migrations from the registry directly
    return await downloadPackageMigrationsFromRegistry(packageName, packageVersion, migrationsConfig);
}
// Matched exactly: a hostname that merely contains one of these is a different
// registry. registry.yarnpkg.com is npmjs' CNAME, so it serves the same
// metadata; the two loopback literals are the spellings of a local registry
// that the substring below cannot reach, since neither contains "localhost".
const FULL_METADATA_REGISTRIES = [
    'registry.npmjs.org',
    'registry.yarnpkg.com',
    '127.0.0.1',
    '[::1]',
];
// Matched as substrings, since neither names a single host: a local registry
// can sit on a subdomain of localhost, and an Artifactory instance is
// identified only by that word appearing somewhere in its hostname.
const FULL_METADATA_REGISTRY_MARKERS = [
    'localhost',
    'artifactory',
];
async function getPackageMigrationsConfigFromRegistry(packageName, packageVersion) {
    const result = await (0, package_manager_1.packageRegistryView)(packageName, packageVersion, [
        'nx-migrations',
        'ng-update',
        'dist',
        '--json',
    ]);
    if (!result) {
        return null;
    }
    const json = JSON.parse(result);
    if (!json['nx-migrations'] && !json['ng-update']) {
        const registry = new node_url_1.URL('dist' in json ? json.dist.tarball : json.tarball)
            .hostname;
        // Other registries may not support full metadata via npm view; throw to
        // trigger the install fallback.
        if (!FULL_METADATA_REGISTRIES.includes(registry) &&
            !FULL_METADATA_REGISTRY_MARKERS.some((v) => registry.includes(v))) {
            throw new Error(`Getting migration config from registry is not supported from ${registry}`);
        }
    }
    return (0, package_json_1.readNxMigrateConfig)(json);
}
async function downloadPackageMigrationsFromRegistry(packageName, packageVersion, { migrations: migrationsFilePath, packageGroup, supportsOptionalMigrations, }) {
    const { dir, cleanup } = (0, package_manager_1.createTempNpmDirectory)();
    let result;
    try {
        const { tarballPath } = await (0, package_manager_1.packageRegistryPack)(dir, packageName, packageVersion, 
        // packageVersion is exact and already resolved through the workspace
        // package manager's min-release-age policy by the fetcher. In an npm
        // workspace the pack gate IS that policy, so leave it enforcing; for
        // other package managers npm's gate is foreign config with no
        // exclusions and would wrongly re-judge the vetted version.
        { bypassMinReleaseAge: (0, package_manager_1.detectPackageManager)() !== 'npm' });
        const fullTarballPath = (0, path_1.join)(dir, tarballPath);
        let migrations;
        try {
            migrations = await (0, tar_1.extractFileFromTarball)(fullTarballPath, (0, path_2.joinPathFragments)('package', migrationsFilePath), (0, path_1.join)(dir, migrationsFilePath)).then((path) => (0, fileutils_1.readJsonFile)(path));
        }
        catch {
            throw new Error(`Failed to find migrations file "${migrationsFilePath}" in package "${packageName}@${packageVersion}".`);
        }
        (0, prompt_files_1.validateMigrationEntries)(packageName, packageVersion, migrations);
        const resolvedPromptFiles = await (0, prompt_files_1.extractPromptFilesFromTarball)(packageName, packageVersion, migrations, migrationsFilePath, fullTarballPath, dir);
        result = {
            ...migrations,
            packageGroup,
            supportsOptionalMigrations,
            version: packageVersion,
            ...(resolvedPromptFiles ? { resolvedPromptFiles } : {}),
        };
    }
    finally {
        await cleanup();
    }
    return result;
}
function createConcurrencyLimiter(concurrency) {
    const queue = [];
    let active = 0;
    function next() {
        while (queue.length > 0 && active < concurrency) {
            active++;
            queue.shift()();
        }
    }
    return function limit(fn) {
        return new Promise((resolve, reject) => {
            queue.push(() => {
                fn()
                    .then(resolve, reject)
                    .finally(() => {
                    active--;
                    next();
                });
            });
            next();
        });
    };
}
const installConcurrencyLimit = process.env.NX_MIGRATE_INSTALL_CONCURRENCY
    ? createConcurrencyLimiter(Math.max(1, Math.floor(Number(process.env.NX_MIGRATE_INSTALL_CONCURRENCY)) || 1))
    : null;
async function getPackageMigrationsUsingInstall(packageName, packageVersion, pmc) {
    const run = () => getPackageMigrationsUsingInstallImpl(packageName, packageVersion, pmc);
    return installConcurrencyLimit ? installConcurrencyLimit(run) : run();
}
async function getPackageMigrationsUsingInstallImpl(packageName, packageVersion, pmc) {
    const { dir, cleanup } = (0, package_manager_1.createTempNpmDirectory)();
    let result;
    if ((0, provenance_1.getNxPackageGroup)().includes(packageName)) {
        await (0, provenance_1.ensurePackageHasProvenance)(packageName, packageVersion);
    }
    try {
        const addCommand = `${pmc.add} ${packageName}@${packageVersion}`;
        try {
            await execAsync(addCommand, {
                cwd: dir,
                env: {
                    ...process.env,
                    npm_config_legacy_peer_deps: 'true',
                },
            });
        }
        catch (e) {
            // Only the install command failed; format it as a command failure so the
            // user sees the package manager's stderr. Errors from the later steps
            // (reading/validating migrations, resolving prompt files) are surfaced
            // as-is by the outer catch instead of being mislabeled as install failures.
            throw new Error(formatCommandFailure(addCommand, e));
        }
        const { migrations: migrationsFilePath, packageGroup, supportsOptionalMigrations, packageJson, } = (0, execute_migration_1.readPackageMigrationConfig)(packageName, dir);
        let migrations = undefined;
        let resolvedPromptFiles;
        if (migrationsFilePath) {
            migrations = (0, fileutils_1.readJsonFile)(migrationsFilePath);
            (0, prompt_files_1.validateMigrationEntries)(packageName, packageVersion, migrations);
            resolvedPromptFiles = await (0, prompt_files_1.readPromptFilesFromInstall)(packageName, packageVersion, migrations, migrationsFilePath);
        }
        result = {
            ...migrations,
            packageGroup,
            supportsOptionalMigrations,
            version: packageJson.version,
            ...(resolvedPromptFiles ? { resolvedPromptFiles } : {}),
        };
    }
    catch (e) {
        throw new Error([
            `Failed to fetch migrations for ${packageName}@${packageVersion}`,
            e instanceof Error ? e.message : String(e),
        ].join('\n'));
    }
    finally {
        await cleanup();
    }
    return result;
}
async function createMigrationsFile(root, migrations) {
    await (0, write_formatted_json_file_1.writeFormattedJsonFile)((0, path_1.join)(root, 'migrations.json'), { migrations });
}
async function updatePackageJson(root, updatedPackages) {
    const packageJsonPath = (0, path_1.join)(root, 'package.json');
    if (!(0, fs_1.existsSync)(packageJsonPath)) {
        return false;
    }
    const parseOptions = {};
    const json = (0, fileutils_1.readJsonFile)(packageJsonPath, parseOptions);
    const manager = (0, catalog_1.getCatalogManager)(root);
    const catalogUpdates = [];
    let modified = false;
    Object.keys(updatedPackages).forEach((p) => {
        const existingVersion = json.dependencies?.[p] ?? json.devDependencies?.[p];
        if (existingVersion && manager?.isCatalogReference(existingVersion)) {
            const { catalogName } = manager.parseCatalogReference(existingVersion);
            catalogUpdates.push({
                packageName: p,
                version: updatedPackages[p].version,
                catalogName,
            });
            // don't overwrite the catalog reference with the new version
            return;
        }
        // Update non-catalog packages in package.json
        if (json.devDependencies?.[p]) {
            if (json.devDependencies[p] !== updatedPackages[p].version) {
                json.devDependencies[p] = updatedPackages[p].version;
                modified = true;
            }
            return;
        }
        if (json.dependencies?.[p]) {
            if (json.dependencies[p] !== updatedPackages[p].version) {
                json.dependencies[p] = updatedPackages[p].version;
                modified = true;
            }
            return;
        }
        const dependencyType = updatedPackages[p].addToPackageJson;
        if (typeof dependencyType === 'string') {
            json[dependencyType] ??= {};
            if (json[dependencyType][p] !== updatedPackages[p].version) {
                json[dependencyType][p] = updatedPackages[p].version;
                modified = true;
            }
        }
    });
    if (modified) {
        await (0, write_formatted_json_file_1.writeFormattedJsonFile)(packageJsonPath, json, {
            appendNewLine: parseOptions.endsWithNewline,
        });
    }
    // Update catalog definitions
    if (catalogUpdates.length) {
        // manager is guaranteed to be defined when there are catalog updates
        manager.updateCatalogVersions(root, catalogUpdates);
        await formatCatalogDefinitionFiles(manager, root);
    }
    return modified || catalogUpdates.length > 0;
}
async function formatCatalogDefinitionFiles(manager, root) {
    const catalogDefinitionFilePaths = manager.getCatalogDefinitionFilePaths();
    const catalogDefinitionFiles = catalogDefinitionFilePaths.map((filePath) => {
        const absolutePath = (0, path_1.join)(root, filePath);
        return {
            path: filePath,
            absolutePath,
            content: (0, fs_1.readFileSync)(absolutePath, 'utf-8'),
        };
    });
    const results = await (0, format_changed_files_1.formatFileContents)(catalogDefinitionFiles.map(({ path, content }) => ({ path, content })), root, { silent: true });
    for (const { path, absolutePath, content } of catalogDefinitionFiles) {
        (0, fs_1.writeFileSync)(absolutePath, results.has(path) ? results.get(path) : content, { encoding: 'utf-8' });
    }
}
async function updateInstallationDetails(root, updatedPackages) {
    const nxJsonPath = (0, path_1.join)(root, 'nx.json');
    const parseOptions = {};
    const nxJson = (0, fileutils_1.readJsonFile)(nxJsonPath, parseOptions);
    if (!nxJson.installation) {
        return false;
    }
    let modified = false;
    const nxVersion = updatedPackages.nx?.version;
    if (nxVersion && nxJson.installation.version !== nxVersion) {
        nxJson.installation.version = nxVersion;
        modified = true;
    }
    if (nxJson.installation.plugins) {
        for (const dep in nxJson.installation.plugins) {
            const update = updatedPackages[dep];
            if (update) {
                const newVersion = (0, semver_1.valid)(update.version)
                    ? update.version
                    : await (0, resolve_package_version_1.resolvePackageVersionRespectingMinReleaseAge)(dep, update.version);
                if (nxJson.installation.plugins[dep] !== newVersion) {
                    nxJson.installation.plugins[dep] = newVersion;
                    modified = true;
                }
            }
        }
    }
    if (modified) {
        await (0, write_formatted_json_file_1.writeFormattedJsonFile)(nxJsonPath, nxJson, {
            appendNewLine: parseOptions.endsWithNewline,
        });
    }
    return modified;
}
async function isMigratingToNewMajor(from, to) {
    from = (0, version_utils_1.normalizeVersion)(from);
    to = ['latest', 'next', 'canary'].includes(to) ? to : (0, version_utils_1.normalizeVersion)(to);
    if (!(0, semver_1.valid)(from)) {
        from = await (0, resolve_package_version_1.resolvePackageVersionRespectingMinReleaseAge)('nx', from);
    }
    if (!(0, semver_1.valid)(to)) {
        to = await (0, resolve_package_version_1.resolvePackageVersionRespectingMinReleaseAge)('nx', to);
    }
    return (0, semver_1.major)(from) < (0, semver_1.major)(to);
}
function readNxVersion(packageJson, root) {
    return ((0, package_json_1.getDependencyVersionFromPackageJson)('nx', root, packageJson) ??
        (0, package_json_1.getDependencyVersionFromPackageJson)('@nx/workspace', root, packageJson) ??
        (0, package_json_1.getDependencyVersionFromPackageJson)('@nrwl/workspace', root, packageJson));
}
// Exported for testing the optional-include orchestration seam (see NXC-4590).
async function generateMigrationsJsonAndUpdatePackageJson(root, opts, fetch) {
    const pmc = (0, package_manager_1.getPackageManagerCommand)();
    let phase = 'fetch_migrations';
    try {
        const rootPkgJsonPath = (0, path_1.join)(root, 'package.json');
        let originalPackageJson = (0, fs_1.existsSync)(rootPkgJsonPath)
            ? (0, fileutils_1.readJsonFile)(rootPkgJsonPath)
            : null;
        const originalNxJson = (0, configuration_1.readNxJson)();
        const from = originalNxJson.installation?.version ??
            readNxVersion(originalPackageJson, root);
        const include = opts.include;
        (0, migrate_analytics_1.setMigrateInclude)(include);
        let walkedTargetPackage = opts.targetPackage;
        let fromOverrides = opts.from;
        let excludeApplied = opts.excludeAppliedMigrations;
        if (include === 'optional') {
            // The `optional` value catches up the deps the target manages, so walk the
            // target from zero, against `nx`'s full managed-deps closure.
            walkedTargetPackage = toNxClosurePackage(opts.targetPackage);
            fromOverrides = { [walkedTargetPackage]: '0.0.0' };
            excludeApplied = true;
        }
        logger_1.logger.info(`Fetching meta data about packages.`);
        logger_1.logger.info(`It may take a few minutes.`);
        const resolvedFetch = fetch ?? createFetcher(pmc);
        let requiredPackages;
        if (include === 'required' || include === 'optional') {
            // `@nx/workspace` declares an intentionally narrow `packageGroup`
            // ({ nx, nx-cloud }) in its migrations config, whereas `nx` declares the
            // full @nx/* plugin fan-out. Their transitive required closures are
            // equivalent, so resolve the closure against `nx`.
            const sourcePackage = toNxClosurePackage(walkedTargetPackage);
            const rootMetadata = await resolvedFetch(sourcePackage, opts.targetVersion);
            // Legacy `@nrwl/workspace<14` doesn't ship a complete `packageGroup`
            // in its metadata; the Migrator's cascade injects
            // `LEGACY_NRWL_PACKAGE_GROUP` for that case, and the post-build
            // optional filter must mirror that set or required `@nrwl/*`
            // plugins slip past it.
            const packageGroup = sourcePackage === '@nrwl/workspace' && (0, version_utils_1.isLegacyEra)(opts.targetVersion)
                ? LEGACY_NRWL_PACKAGE_GROUP
                : rootMetadata.packageGroup;
            requiredPackages = resolveRequiredPackages(sourcePackage, packageGroup);
        }
        const installedPackageVersions = createInstalledPackageVersionsResolver(root);
        const migrator = new Migrator({
            packageJson: originalPackageJson,
            nxInstallation: originalNxJson.installation,
            getInstalledPackageVersion: installedPackageVersions,
            fetch: resolvedFetch,
            from: fromOverrides,
            to: opts.to,
            interactive: opts.interactive && !(0, is_ci_1.isCI)(),
            excludeAppliedMigrations: excludeApplied,
            include,
            requiredPackages,
        });
        const { migrations, packageUpdates, promptContents, minVersionWithSkippedUpdates, } = await migrator.migrate(walkedTargetPackage, opts.targetVersion);
        // The cascade collects packageJsonUpdates entries against the cascade
        // root's installed version, but inner per-package pins are only gated
        // against the in-flight cascade tally — not against each inner package's
        // installed version. A from-zero walk (e.g. `--include=optional`) can
        // surface a stale historical pin that would write a lower version than
        // the user already has. Drop those before writing; nx migrate is
        // forward-only, never a downgrade.
        phase = 'package_updates';
        // Resolve catalog: specifiers first so the filter compares real versions.
        const writableUpdates = (0, update_filters_1.filterDowngradedUpdates)(packageUpdates, (0, catalog_1.resolveCatalogSpecifiers)(originalPackageJson), installedPackageVersions);
        const wrotePackageJson = await updatePackageJson(root, writableUpdates);
        const wroteNxJsonInstallation = await updateInstallationDetails(root, writableUpdates);
        // Under `--include=optional` the target's own entry is filtered out of
        // `packageUpdates` (it's a required package), so resolve the version
        // defensively. Also reused by the completion analytics below.
        const resolvedTargetVersion = packageUpdates[walkedTargetPackage]?.version ?? opts.targetVersion;
        const promptMigrationFiles = (0, prompt_files_1.writePromptMigrationFiles)(root, migrations, promptContents ?? {}, resolvedTargetVersion);
        if (migrations.length > 0) {
            await createMigrationsFile(root, [
                ...addSplitConfigurationMigrationIfAvailable(from, writableUpdates),
                ...migrations,
            ]);
        }
        const includeLine = include === 'required'
            ? `- Processed required updates only (skipped optional dependency bumps).`
            : include === 'optional'
                ? `- Processed optional dependency updates only (skipped required package updates).`
                : null;
        // The param expressions below evaluate before the report function is
        // entered; `safeReport` keeps them inside the analytics boundary so a
        // param-building throw can't surface here and convert an already
        // successful migrate into a reported failure.
        const recordCompletion = () => (0, migrate_analytics_1.safeReport)(() => (0, migrate_analytics_1.reportMigrateGenerateComplete)({
            targetVersion: resolvedTargetVersion,
            requestedTargetVersion: opts.originalTargetVersion ?? resolvedTargetVersion,
            installedTargetVersion: (0, multi_major_1.isNxTarget)(opts.targetPackage, opts.targetVersion)
                ? from
                : installedPackageVersions(opts.targetPackage),
            include,
            multiMajorChoice: opts.multiMajorChoice,
            fetchStats: resolvedFetch.stats,
        }));
        const noChanges = !wrotePackageJson && !wroteNxJsonInstallation && migrations.length === 0;
        if (noChanges) {
            output_1.output.success({
                title: `No updates were applied.`,
                bodyLines: [
                    ...(includeLine ? [includeLine] : []),
                    include === 'optional'
                        ? `- No optional dependency updates were found for the installed version. Either your dependencies are already up to date, or this workspace doesn't manage them in a place 'nx migrate' writes to (e.g. non-JS workspaces).`
                        : `- No package updates or migrations were found.`,
                ],
            });
            // Nothing was applied; skip the "Next steps" guidance below — it would
            // tell the user to inspect package.json changes that don't exist.
            recordCompletion();
            return;
        }
        output_1.output.success({
            title: `The migrate command has run successfully.`,
            bodyLines: [
                ...(includeLine ? [includeLine] : []),
                ...(wrotePackageJson ? [`- package.json has been updated.`] : []),
                ...(wroteNxJsonInstallation
                    ? [`- nx.json (installation) has been updated.`]
                    : []),
                migrations.length > 0
                    ? `- migrations.json has been generated.`
                    : `- There are no migrations to run, so migrations.json has not been created.`,
                ...(promptMigrationFiles.length > 0
                    ? [
                        `- ${promptMigrationFiles.length} AI migration prompt(s) have been written to ${prompt_files_1.AI_MIGRATIONS_DIR}/.`,
                    ]
                    : []),
            ],
        });
        try {
            if (opts.interactive !== false &&
                ['nx', '@nrwl/workspace'].includes(opts.targetPackage) &&
                (await isMigratingToNewMajor(from, opts.targetVersion)) &&
                !(0, is_ci_1.isCI)() &&
                !(0, nx_cloud_utils_1.isNxCloudDisabled)(originalNxJson) &&
                !(0, nx_cloud_utils_1.isNxCloudUsed)(originalNxJson)) {
                output_1.output.success({
                    title: 'Connect to Nx Cloud',
                    bodyLines: [
                        'Nx Cloud is a first-party CI companion for Nx projects. It improves critical aspects of CI:',
                        '- Speed: 30% - 70% faster CI',
                        '- Cost: 40% - 75% reduction in CI costs',
                        '- Reliability: by automatically identifying flaky tasks and re-running them',
                    ],
                });
                await (0, connect_to_nx_cloud_1.connectToNxCloudWithPrompt)('migrate');
                originalPackageJson = (0, fileutils_1.readJsonFile)((0, path_1.join)(root, 'package.json'));
            }
        }
        catch {
            // The above code is to remind folks when updating to a new major and not currently using Nx cloud.
            // If for some reason it fails, it shouldn't affect the overall migration process
        }
        const bodyLines = process.env['NX_CONSOLE']
            ? [
                '- Inspect the package.json changes in the built-in diff editor [Click to open]',
                '- Confirm the changes to install the new dependencies and continue the migration',
            ]
            : [
                `- Make sure package.json changes make sense and then run '${pmc.install}',`,
                ...(promptMigrationFiles.length > 0
                    ? [
                        `- Review and tweak the AI migration prompts in ${prompt_files_1.AI_MIGRATIONS_DIR}/ as needed.`,
                    ]
                    : []),
                ...(migrations.length > 0
                    ? [`- Run '${pmc.exec} nx migrate --run-migrations'`]
                    : []),
                ...(opts.originalTargetVersion
                    ? [
                        `- After applying these migrations, run '${pmc.exec} nx migrate ${opts.targetPackage}@${opts.originalTargetVersion} --include=${opts.include}${opts.multiMajorMode === 'gradual'
                            ? ` ${multi_major_1.MULTI_MAJOR_MODE_FLAG}=gradual`
                            : ''}' to continue toward your original target.`,
                    ]
                    : []),
                ...(opts.interactive && minVersionWithSkippedUpdates
                    ? [
                        `- You opted out of some migrations for now. Write the following command down somewhere to apply these migrations later:`,
                        `  nx migrate ${opts.targetVersion} --from ${opts.targetPackage}@${minVersionWithSkippedUpdates} --exclude-applied-migrations`,
                        `- To learn more go to https://nx.dev/recipes/tips-n-tricks/advanced-update`,
                    ]
                    : [
                        `- To learn more go to https://nx.dev/features/automate-updating-dependencies`,
                    ]),
                ...(showConnectToCloudMessage()
                    ? [
                        `- You may run '${pmc.run('nx', 'connect-to-nx-cloud')}' to get faster builds, GitHub integration, and more. Check out https://nx.app`,
                    ]
                    : []),
            ];
        output_1.output.log({
            title: 'Next steps:',
            bodyLines,
        });
        recordCompletion();
    }
    catch (e) {
        (0, migrate_analytics_1.reportMigrateGenerateError)(phase, e);
        output_1.output.error({
            title: `The migrate command failed.`,
        });
        throw e;
    }
}
function addSplitConfigurationMigrationIfAvailable(from, packageJson) {
    if (!packageJson['@nrwl/workspace'])
        return [];
    if ((0, semver_1.gte)(packageJson['@nrwl/workspace'].version, '15.7.0-beta.0') &&
        (0, semver_1.lt)((0, version_utils_1.normalizeVersion)(from), '15.7.0-beta.0')) {
        return [
            {
                version: '15.7.0-beta.0',
                description: 'Split global configuration files into individual project.json files. This migration has been added automatically to the beginning of your migration set to retroactively make them work with the new version of Nx.',
                implementation: './src/migrations/update-15-7-0/split-configuration-into-project-json-files',
                package: '@nrwl/workspace',
                name: '15-7-0-split-configuration-into-project-json-files',
            },
        ];
    }
    else {
        return [];
    }
}
function showConnectToCloudMessage() {
    try {
        const nxJson = (0, configuration_1.readNxJson)();
        const defaultRunnerIsUsed = (0, connect_to_nx_cloud_1.onlyDefaultRunnerIsUsed)(nxJson);
        return !!defaultRunnerIsUsed;
    }
    catch {
        return false;
    }
}
function formatSkippedPromptsNextStep(skipped) {
    return [
        'Some prompt migrations were skipped. Review and apply each of the following prompt files to the workspace, in the listed order:',
        ...skipped.map((m) => `  - ${m.prompt}`),
    ].join('\n');
}
async function executeMigrations(root, migrations, isVerbose, shouldCreateCommits, commitPrefix, shouldSkipInstall = false, agentic, agenticHasDiffContext = false, shouldRunValidation = false) {
    const changedDepInstaller = new execute_migration_1.ChangedDepInstaller(root, shouldSkipInstall);
    const migrationsWithNoChanges = [];
    const sortedMigrations = (0, sort_migrations_1.sortMigrations)(migrations, {
        hoistHandoffGitignore: agentic?.kind === 'enabled',
    });
    // Lazy-load the agentic chain so non-agentic runs don't pay its startup cost.
    let agenticRun;
    if (agentic?.kind === 'enabled' && sortedMigrations.length > 0) {
        const { initRunDir, resolveAgenticRunId } = require('./agentic/handoff');
        const { runAgenticPromptStep } = require('./agentic/run-step');
        agenticRun = {
            agentic,
            runDir: initRunDir(root, resolveAgenticRunId(sortedMigrations)),
            runStep: runAgenticPromptStep,
        };
    }
    const printDroppedAgentContext = agentic?.kind === 'inside-agent'
        ? require('./agentic/print-dropped-agent-context').printDroppedAgentContextForOuterAgent
        : undefined;
    logger_1.logger.info(`Running the following migrations:`);
    sortedMigrations.forEach((m) => logger_1.logger.info(m.description
        ? `- ${m.package}: ${m.name} — ${m.description}`
        : `- ${m.package}: ${m.name}`));
    logger_1.logger.info('');
    // Tracked separately from `skippedPrompts` so the end-of-run logic can
    // render them distinctly per resolution mode.
    const migrationEmittedNextSteps = [];
    const skippedPrompts = [];
    // One record per migration the loop touched. `status: 'completed'` records
    // are pushed at the end of each successful iteration; `status: 'aborted'`
    // is pushed by the catch block when a migration throws mid-iteration, so
    // `outcomes` is the single source of truth for the recap and tally — no
    // parallel "pending" list. `outcomes.length` always equals `migrationIndex`
    // after the loop body runs.
    const outcomes = [];
    // Prompt-only migrations whose agent never ran. Hybrid migrations with a
    // skipped prompt are NOT counted here — their deterministic half still ran.
    let notRunMigrationsCount = 0;
    const skipReason = agentic?.kind === 'inside-agent'
        ? 'deferred to the AI agent driving this run'
        : 'agentic flow disabled';
    const installDepsIfChanged = () => changedDepInstaller.installDepsIfChanged();
    // Returns the migrations whose own commits failed and whose diffs are
    // still sitting in the working tree — derived live from `outcomes`. The
    // next successful commit absorbs them via `git add -A`; its commit body
    // lists them so a reader of `git log -p` can see which prior migrations'
    // diffs got pulled in.
    const pendingForCommitBody = () => outcomes
        .filter((o) => o.commit.kind === 'failed')
        .map((o) => ({ package: o.migration.package, name: o.migration.name }));
    // True while at least one prior migration's commit has failed and its
    // diff hasn't been absorbed yet. While true, the working tree carries
    // prior-migration state, so the `hasDiffContext` flag in the hybrid-
    // agentic and validation-agentic prompt branches is suppressed (the
    // prompt-only-with-agentic branch doesn't use `hasDiffContext`).
    const hasPendingCommitDebt = () => outcomes.some((o) => o.commit.kind === 'failed');
    // Single funnel for per-migration commit attempts. Returns the
    // `CommitState` to record on the migration's outcome. On `committed`,
    // back-annotates any prior failed-commit outcomes to `kind: 'absorbed'`
    // (their diffs were just rolled into this commit via `git add -A`).
    async function attemptMigrationCommit(m) {
        const pending = pendingForCommitBody();
        const result = await (0, migrate_commits_1.commitMigrationIfRequested)(root, m, shouldCreateCommits, commitPrefix, installDepsIfChanged, pending);
        if (result.status === 'committed') {
            // This commit absorbed every pending failed-commit migration's diff.
            // Transition their `commit.kind: 'failed'` records to `'absorbed'` so
            // the failure recap (if a later migration throws) can anchor them
            // and the retained-state filter no longer counts them as
            // uncommitted.
            //
            // The key is `package:name`; matching on `name` alone would conflate
            // across packages. Guard the kind check so a subsequent absorption-
            // of-same-name cannot overwrite an earlier annotation.
            if (pending.length > 0) {
                const absorbedKeys = new Set(pending.map((p) => `${p.package}:${p.name}`));
                for (const o of outcomes) {
                    const key = `${o.migration.package}:${o.migration.name}`;
                    if (absorbedKeys.has(key) && o.commit.kind === 'failed') {
                        o.commit = {
                            kind: 'absorbed',
                            into: { name: m.name, sha: result.sha },
                        };
                    }
                }
            }
            return { kind: 'landed', sha: result.sha };
        }
        if (result.status === 'failed') {
            // Diff is still in WT. Subsequent prompts cannot claim git-isolation
            // until a later commit absorbs the backlog.
            return { kind: 'failed' };
        }
        // `no-changes` and `disabled` — no commit attempted, nothing to record
        // as a commit failure.
        return { kind: 'none' };
    }
    // Records what a migration's deterministic phase produced. A migration that
    // changed nothing must not attempt a commit: the absorbing `git add -A`
    // would build a commit subject naming this no-op migration even though its
    // content is entirely prior pending diffs, confusing `git log` / `git blame`
    // attribution. Pending stays pending and the next change-producing migration
    // absorbs it.
    async function commitOrRecordNoChanges(m, madeChanges) {
        if (!madeChanges) {
            migrationsWithNoChanges.push(m);
            return { kind: 'none' };
        }
        const commit = await attemptMigrationCommit(m);
        if (commit.kind === 'landed' && commit.sha) {
            logger_1.logger.info(pc.dim(`Committed as ${commit.sha}`));
        }
        return commit;
    }
    const totalMigrations = sortedMigrations.length;
    let migrationIndex = 0;
    for (const m of sortedMigrations) {
        migrationIndex++;
        (0, migrate_output_1.logMigrationBoundary)(migrationIndex, totalMigrations, m.package, m.name);
        // Snapshot the WT for before/after comparison in the catch block.
        // Content-sensitive so a dirty→dirty case (this migration mutating an
        // already-dirty shared file like `package.json`) doesn't collapse.
        const baselineWorkingTreeSnapshot = (0, git_utils_1.getUncommittedChangesSnapshot)(root);
        // Tracks whether a failure originated in the agentic step so the error
        // event classifies it as 'agentic' rather than 'migration_exec'.
        let inAgenticStep = false;
        try {
            // Read this migration's collection once and derive everything from it:
            // the implementation context (passed to runNxOrAngularMigration) and the
            // documentation path (passed to the agent). Read fresh per iteration so a
            // prior migration's reinstall is reflected.
            const { resolvedCollection, documentationPath } = resolveMigrationForRun(root, m, !!agenticRun);
            let outcome;
            let commit = { kind: 'none' };
            // Set when the migration returned `skipAgentic: true` and something was
            // actually waived, so the end-of-run recaps can report it. A hybrid's
            // prompt is owed in every agentic mode, so waiving it always counts; a
            // generator-only migration only counts when validation would have run.
            let waivedAgenticStep = false;
            if ((0, migration_shape_1.isPromptOnlyMigration)(m)) {
                if (agenticRun) {
                    inAgenticStep = true;
                    const stepResult = await agenticRun.runStep({
                        root,
                        migration: m,
                        agentic: agenticRun.agentic,
                        runDir: agenticRun.runDir,
                        installDepsIfChanged,
                        documentationPath,
                    });
                    inAgenticStep = false;
                    commit = await attemptMigrationCommit(m);
                    (0, migrate_output_1.logAgenticSuccessOutcome)(stepResult.ambiguous ? 'Marked complete by user' : 'Applied', commit.kind === 'landed' ? commit.sha : null, stepResult.summary);
                    outcome = 'applied';
                }
                else {
                    logger_1.logger.info(pc.dim(`↷ Skipped — ${skipReason}. Listed in next steps.`));
                    skippedPrompts.push(m);
                    notRunMigrationsCount++;
                    outcome = 'deferred';
                }
            }
            else if ((0, migration_shape_1.isHybridMigration)(m)) {
                const { changes, nextSteps, agentContext, skipAgentic, logs, madeChanges, } = await (0, execute_migration_1.runNxOrAngularMigration)(root, m, isVerbose, 
                /* captureGeneratorOutput: */ !!agenticRun, resolvedCollection);
                migrationEmittedNextSteps.push(...nextSteps);
                if (skipAgentic) {
                    // The generator reported the prompt half unnecessary, so nothing is
                    // owed: no agent run, and no next-steps entry telling the user to
                    // run the prompt themselves. Runs in all three agentic modes.
                    (0, migrate_output_1.logWaivedAgenticStep)(m, agentContext);
                    waivedAgenticStep = true;
                    commit = await commitOrRecordNoChanges(m, madeChanges);
                    outcome = madeChanges ? 'applied' : 'no-changes';
                }
                else if (agenticRun) {
                    // Install any deps the deterministic phase added/bumped before the
                    // agent runs — the prompt half may depend on them being present in
                    // node_modules.
                    await installDepsIfChanged();
                    inAgenticStep = true;
                    const stepResult = await agenticRun.runStep({
                        root,
                        migration: m,
                        agentic: agenticRun.agentic,
                        runDir: agenticRun.runDir,
                        installDepsIfChanged,
                        documentationPath,
                        implContext: {
                            logs,
                            changes,
                            agentContext,
                            // When prior commits failed, the working tree carries their
                            // diff. The git-inspect path of the prompt would mislead the
                            // agent in that case; fall back to embedded `<files_changed>`.
                            hasDiffContext: agenticHasDiffContext && !hasPendingCommitDebt(),
                        },
                    });
                    inAgenticStep = false;
                    commit = await attemptMigrationCommit(m);
                    (0, migrate_output_1.logAgenticSuccessOutcome)(stepResult.ambiguous ? 'Marked complete by user' : 'Applied', commit.kind === 'landed' ? commit.sha : null, stepResult.summary);
                    outcome = 'applied';
                }
                else {
                    // The inner prompt step doesn't run here (agentic disabled, or
                    // running inside an outer agent). Under `inside-agent`, surface the
                    // generator-emitted `agentContext` to stdout so the outer driving
                    // agent can ingest it. Under `disabled` the run is human-driven;
                    // agent-targeted context would only add noise — drop.
                    logger_1.logger.info(pc.dim(`↷ Prompt phase skipped — ${skipReason}. Listed in next steps.`));
                    if (printDroppedAgentContext && agentContext.length > 0) {
                        printDroppedAgentContext({ migration: m, agentContext });
                    }
                    skippedPrompts.push(m);
                    commit = await commitOrRecordNoChanges(m, madeChanges);
                    outcome = 'deferred';
                }
            }
            else {
                // Defer commit until validation succeeds; failed validation leaves
                // changes uncommitted in the working tree for the user to review.
                const validationRun = agenticRun && shouldRunValidation ? agenticRun : undefined;
                const { changes, nextSteps, agentContext, skipAgentic, logs, madeChanges, } = await (0, execute_migration_1.runNxOrAngularMigration)(root, m, isVerbose, 
                /* captureGeneratorOutput: */ !!validationRun, resolvedCollection);
                migrationEmittedNextSteps.push(...nextSteps);
                // Whether a validation step was on the table at all. `skipAgentic`
                // waives nothing when it wasn't, so the whole waived path hangs off
                // this, not just the log line.
                const validationApplies = !!validationRun && changes.length > 0;
                const canRunValidation = validationApplies && !skipAgentic;
                if (canRunValidation) {
                    // Install any deps the deterministic phase added/bumped before the
                    // validation agent runs — the agent may run tasks that need them.
                    await installDepsIfChanged();
                    inAgenticStep = true;
                    const stepResult = await validationRun.runStep({
                        root,
                        migration: m,
                        agentic: validationRun.agentic,
                        runDir: validationRun.runDir,
                        installDepsIfChanged,
                        documentationPath,
                        implContext: {
                            logs,
                            changes,
                            agentContext,
                            // See the hybrid agentic branch above for the rationale on
                            // why pending commit debt gates git-inspect context.
                            hasDiffContext: agenticHasDiffContext && !hasPendingCommitDebt(),
                        },
                        mode: 'generic-validation',
                    });
                    inAgenticStep = false;
                    commit = await attemptMigrationCommit(m);
                    (0, migrate_output_1.logAgenticSuccessOutcome)(stepResult.ambiguous
                        ? 'Marked complete by user'
                        : 'Validation passed', commit.kind === 'landed' ? commit.sha : null, stepResult.summary);
                    outcome = 'applied';
                }
                else {
                    if (skipAgentic && validationApplies) {
                        (0, migrate_output_1.logWaivedAgenticStep)(m, agentContext);
                        waivedAgenticStep = true;
                    }
                    else if (printDroppedAgentContext && agentContext.length > 0) {
                        // Inner validation step didn't run. Surface `agentContext` under
                        // `inside-agent` so the outer driving agent can ingest it.
                        printDroppedAgentContext({ migration: m, agentContext });
                    }
                    commit = await commitOrRecordNoChanges(m, madeChanges);
                    outcome = madeChanges ? 'applied' : 'no-changes';
                }
            }
            outcomes.push({
                migration: { package: m.package, name: m.name },
                status: 'completed',
                kind: outcome,
                commit,
                waivedAgenticStep,
            });
            logger_1.logger.info('');
        }
        catch (e) {
            // Record the in-flight migration as `aborted` so the recap and tally
            // see it. `commit: 'failed'` requires both: (1) commits were
            // requested — otherwise the "could not be created" recap line is
            // false; (2) the WT snapshot diverged from the iteration baseline —
            // net-new state, not the pre-existing pending diff. Else `'none'`.
            const leftNewDiff = (0, git_utils_1.getUncommittedChangesSnapshot)(root) !== baselineWorkingTreeSnapshot;
            outcomes.push({
                migration: { package: m.package, name: m.name },
                status: 'aborted',
                commit: shouldCreateCommits && leftNewDiff
                    ? { kind: 'failed' }
                    : { kind: 'none' },
            });
            // `nx repair` reuses executeMigrations; only record for migrate runs.
            if ((0, migrate_analytics_1.hasMigrateRunStarted)()) {
                (0, migrate_analytics_1.reportMigrateRunError)({
                    code: e instanceof execute_migration_1.NpmPeerDepsInstallError
                        ? 'npm_install'
                        : inAgenticStep
                            ? 'agentic'
                            : 'migration_exec',
                    migrationPackage: m.package,
                    migrationName: m.name,
                    migrationCount: totalMigrations,
                    error: e,
                });
            }
            if (!(e instanceof execute_migration_1.NpmPeerDepsInstallError)) {
                // `withGeneratorOutputCapture` attaches the generator's `console.*`
                // output as `capturedLogs` (best-effort; may be absent). Surface it
                // so the user sees what the generator printed before it crashed.
                const capturedLogs = e?.capturedLogs;
                const bodyLines = typeof capturedLogs === 'string' && capturedLogs.length > 0
                    ? [
                        'Output from the generator before it failed:',
                        '',
                        ...capturedLogs.split('\n'),
                    ]
                    : undefined;
                output_1.output.error({
                    title: `Failed to run ${m.name} from ${m.package}. This workspace is NOT up to date!`,
                    bodyLines,
                });
                (0, migrate_output_1.logFailureRecap)({
                    migrationIndex,
                    totalMigrations,
                    outcomes,
                    migrationEmittedNextSteps,
                    insideAgent: agentic?.kind === 'inside-agent',
                });
            }
            throw e;
        }
    }
    if (!shouldCreateCommits) {
        await installDepsIfChanged();
    }
    if (changedDepInstaller.skippedInstall) {
        (0, execute_migration_1.logSkippedPostMigrationInstall)(root);
    }
    // Combined-view next-steps array kept for back-compat with repair.ts, which
    // consumes the single `nextSteps` field.
    const combinedNextSteps = [...migrationEmittedNextSteps];
    if (skippedPrompts.length > 0) {
        combinedNextSteps.push(formatSkippedPromptsNextStep(skippedPrompts));
    }
    return {
        migrationsWithNoChanges,
        skippedPromptsCount: skippedPrompts.length,
        notRunMigrationsCount,
        nextSteps: combinedNextSteps,
        skippedPrompts,
        migrationEmittedNextSteps,
        committedShasCount: (0, migrate_output_1.countLandedCommits)(outcomes),
        waivedAgenticStepsCount: (0, migrate_output_1.countWaivedAgenticSteps)(outcomes),
        // Migrations whose commits failed and never got absorbed by a later
        // commit. The caller surfaces them so a successful run doesn't claim
        // "up to date" while leaving uncommitted diffs in the working tree.
        // Formatted as `package: name` for direct display.
        retainedAtSuccess: (0, migrate_output_1.retainedMigrations)(outcomes).map((p) => `${p.package}: ${p.name}`),
    };
}
// nx is located at spawn time, after the gated pre-install, so the child runs
// the bytes that install put in place.
function handOffToLocalNx(args) {
    const exitCode = runOrReturnExitCode(() => (0, child_process_2.runNxArgvSync)(['migrate', ...args], {
        stdio: ['inherit', 'inherit', 'inherit'],
        env: {
            ...process.env,
            NX_MIGRATE_SKIP_INSTALL: 'true',
            NX_MIGRATE_USE_LOCAL: 'true',
        },
    }));
    return exitCode !== 0 ? exitCode : undefined;
}
async function runMigrations(root, opts, args, isVerbose, shouldCreateCommits, commitPrefix, shouldSkipInstall = false) {
    if (!shouldSkipInstall && !process.env.NX_MIGRATE_SKIP_INSTALL) {
        await (0, execute_migration_1.runInstall)();
    }
    if (!__dirname.startsWith(workspace_root_1.workspaceRoot)) {
        // we are running from a temp installation with nx latest, switch to running
        // from local installation
        return handOffToLocalNx(args);
    }
    const migrationsExists = (0, fileutils_1.fileExists)(opts.runMigrations);
    if (opts.ifExists && !migrationsExists) {
        output_1.output.log({
            title: `Migrations file '${opts.runMigrations}' doesn't exist`,
        });
        return;
    }
    else if (!opts.ifExists && !migrationsExists) {
        throw new Error(`File '${opts.runMigrations}' doesn't exist, can't run migrations. Use flag --if-exists to run migrations only if the file exists`);
    }
    const migrationsJson = (0, fileutils_1.readJsonFile)((0, path_1.join)(root, opts.runMigrations));
    const migrations = migrationsJson.migrations;
    // An outer agent drives the loop, so hand off to the orchestrator instead of
    // the classic loop: init either starts a fresh run or resumes an already-
    // active one. `--run-id` reconciles are dispatched separately and never
    // reach here.
    if (process.env.NX_MIGRATE_ORCHESTRATOR === 'true' && (0, inception_1.isInsideAgent)()) {
        // Orchestrated runs are agent-driven, so commits default on exactly as they
        // do under `--agentic=enabled`; the orchestrator replaces `resolveAgentic`.
        const { effective: effectiveCreateCommits, warning: createCommitsWarning, error: createCommitsError, } = (0, migrate_commits_1.resolveCreateCommits)({
            createCommits: shouldCreateCommits,
            mode: 'orchestrated',
            isGitRepo: (0, git_utils_1.isGitRepository)(root),
            commitPrefixIsCustom: commitPrefix !== command_object_1.DEFAULT_MIGRATION_COMMIT_PREFIX,
        });
        if (createCommitsError) {
            throw new Error(createCommitsError);
        }
        if (createCommitsWarning) {
            output_1.output.warn({ title: createCommitsWarning });
        }
        // The run commits on the user's behalf across many invocations, so the
        // default-branch confirmation belongs here, once, before any of them.
        if (effectiveCreateCommits &&
            (0, safe_prompt_1.canPrompt)(opts.interactive) &&
            !(await (0, migrate_commits_1.confirmMigrationCommitsOnDefaultBranch)(root, 'running migrations'))) {
            return;
        }
        const { packageJson: orchestratorNxPackageJson } = (0, package_json_1.readModulePackageJson)('nx', (0, installation_directory_1.getNxRequirePaths)(root));
        const { runOrchestratorInit } = require('./run');
        return await runOrchestratorInit({
            root,
            migrationsJson,
            createCommits: effectiveCreateCommits,
            commitPrefix,
            // The flag only, never NX_MIGRATE_SKIP_INSTALL: the wrapper's local
            // re-exec sets that env var for its own hop, and it says nothing about
            // what the user asked for.
            skipInstall: shouldSkipInstall,
            installedNxVersion: orchestratorNxPackageJson.version,
        });
    }
    (0, migrate_analytics_1.reportMigrateRunStart)({
        createCommits: shouldCreateCommits ?? false,
        migrationCount: migrations.length,
    });
    const { resolveAgentic, resolveShouldRunValidation } = require('./agentic/select');
    let agentic;
    try {
        agentic = await resolveAgentic({
            agentic: opts.agentic,
            migrations,
            interactive: opts.interactive,
        });
    }
    catch (e) {
        (0, migrate_analytics_1.reportMigrateRunError)({ code: 'agentic', error: e });
        throw e;
    }
    const { effective: effectiveCreateCommits, agenticHasDiffContext, warning: createCommitsWarning, error: createCommitsError, } = (0, migrate_commits_1.resolveCreateCommits)({
        createCommits: shouldCreateCommits,
        mode: agentic.kind,
        isGitRepo: (0, git_utils_1.isGitRepository)(root),
        commitPrefixIsCustom: commitPrefix !== command_object_1.DEFAULT_MIGRATION_COMMIT_PREFIX,
    });
    if (createCommitsError) {
        throw new Error(createCommitsError);
    }
    if (createCommitsWarning) {
        output_1.output.warn({ title: createCommitsWarning });
    }
    if (effectiveCreateCommits &&
        (0, safe_prompt_1.canPrompt)(opts.interactive) &&
        !(await (0, migrate_commits_1.confirmMigrationCommitsOnDefaultBranch)(root, 'running migrations'))) {
        return;
    }
    const shouldRunValidation = resolveShouldRunValidation({
        validate: opts.validate,
        agenticKind: agentic.kind,
    });
    output_1.output.log({
        title: `Running migrations from '${opts.runMigrations}'` +
            (effectiveCreateCommits
                ? ', with each applied in a dedicated commit'
                : ''),
    });
    if (effectiveCreateCommits) {
        (0, migrate_commits_1.commitCheckpointBeforeMigrations)(root, commitPrefix);
    }
    if (agentic.kind === 'enabled') {
        const { applyAgenticHandoffGitignoreFallback } = require('./agentic/handoff-gitignore');
        const { packageJson: nxPackageJson } = (0, package_json_1.readModulePackageJson)('nx', (0, installation_directory_1.getNxRequirePaths)(root));
        await applyAgenticHandoffGitignoreFallback({
            migrations,
            installedNxVersion: nxPackageJson.version,
            effectiveCreateCommits,
            commitPrefix,
            root,
        });
    }
    const { migrationsWithNoChanges, skippedPromptsCount, notRunMigrationsCount, skippedPrompts, migrationEmittedNextSteps, committedShasCount, waivedAgenticStepsCount, retainedAtSuccess, } = await executeMigrations(root, migrations, isVerbose, effectiveCreateCommits, commitPrefix, shouldSkipInstall, agentic, agenticHasDiffContext, shouldRunValidation);
    const ranWithChangesCount = migrations.length - notRunMigrationsCount - migrationsWithNoChanges.length;
    // The "applied" tally counts fully-completed migrations — those that
    // left no deferred work behind. Hybrid migrations whose prompt half was
    // deferred count as "deferred", not "applied".
    const appliedCount = migrations.length - skippedPrompts.length;
    const insideAgent = agentic.kind === 'inside-agent';
    const tallyLine = (0, migrate_output_1.buildTallyBodyLine)({
        appliedCount,
        committedShasCount,
        skippedPromptsCount,
        waivedAgenticStepsCount,
        insideAgent,
    });
    const tallyBody = tallyLine ? [tallyLine] : undefined;
    // Only claim "up to date" when there's nothing pending: no deferred
    // prompts AND no migrations whose commits failed without being absorbed.
    const upToDateSuffix = skippedPromptsCount > 0 || retainedAtSuccess.length > 0
        ? ''
        : ' This workspace is up to date!';
    // Demote `output.success` to `output.warn` when there's uncommitted state
    // retained from failed commits — the run did its work, but it would be
    // misleading to lead with a green "Successfully finished" before the
    // retained-state block. `.bind(output)` is required: assigning the method
    // reference to a local would otherwise call it with `this === undefined`.
    const completionLog = (retainedAtSuccess.length > 0 ? output_1.output.warn : output_1.output.success).bind(output_1.output);
    const completionTitlePrefix = retainedAtSuccess.length > 0
        ? 'Finished running migrations with uncommitted state retained'
        : 'Successfully finished running migrations';
    if (notRunMigrationsCount === migrations.length && migrations.length > 0) {
        const remediation = insideAgent
            ? 'The AI agent driving this run should apply each prompt — see next steps below.'
            : 'Re-run with --agentic to apply them. See next steps below.';
        output_1.output.warn({
            title: `No migrations from '${opts.runMigrations}' were applied — every entry is a prompt-only migration. ${remediation}`,
            bodyLines: tallyBody,
        });
    }
    else if (ranWithChangesCount > 0) {
        completionLog({
            title: `${completionTitlePrefix} from '${opts.runMigrations}'.${upToDateSuffix}`,
            bodyLines: tallyBody,
        });
    }
    else {
        // Pathological-but-possible: a no-op run that still has retained state
        // (e.g. pre-existing pending diffs that no commit absorbed). Demote
        // explicitly rather than rely on the implicit invariant.
        completionLog({
            title: `No changes were made from running '${opts.runMigrations}'.${upToDateSuffix}`,
            bodyLines: tallyBody,
        });
    }
    if (retainedAtSuccess.length > 0) {
        output_1.output.warn({
            title: `Working-tree state retained from ${retainedAtSuccess.length} migration${retainedAtSuccess.length === 1 ? '' : 's'} whose commits could not be created`,
            bodyLines: (0, migrate_output_1.buildRetainedAtSuccessBody)(retainedAtSuccess),
        });
    }
    if (insideAgent) {
        // Under inside-agent, emit a directive block so the outer agent has
        // explicit instructions to act on, not just relay.
        const directiveLines = (0, migrate_output_1.buildDirectiveBlockBodyLines)({
            skippedPrompts,
            migrationEmittedNextSteps,
        });
        if (directiveLines.length > 0) {
            output_1.output.log({
                title: 'Next steps for the AI agent driving this run',
                bodyLines: directiveLines,
            });
        }
    }
    else if (skippedPromptsCount > 0 || migrationEmittedNextSteps.length > 0) {
        // Non-inside-agent path keeps the legacy "additional information" shape —
        // the consumer is the human user.
        const bodyLines = [];
        if (skippedPromptsCount > 0) {
            bodyLines.push(formatSkippedPromptsNextStep(skippedPrompts));
        }
        bodyLines.push(...migrationEmittedNextSteps);
        output_1.output.log({
            title: `Some migrations have additional information, see below.`,
            bodyLines: bodyLines.map((line) => `- ${line}`),
        });
    }
    (0, migrate_analytics_1.reportMigrateRunComplete)({
        agenticOutcome: agentic.kind,
        agentUsed: agentic.kind === 'enabled' ? agentic.selectedAgent.id : undefined,
        migrationCount: migrations.length,
        appliedCount,
    });
}
function isRunPhaseInvocation(args) {
    return (args.runMigration !== undefined ||
        args.runId !== undefined ||
        args.stepAction !== undefined);
}
async function migrate(root, args, rawArgs) {
    await client_1.daemonClient.stop();
    return (0, handle_errors_1.handleErrors)(process.env.NX_VERBOSE_LOGGING === 'true', async () => {
        const mergedArgs = (0, migrate_config_1.applyNxJsonMigrateDefaults)(args, (0, configuration_1.readNxJson)().migrate);
        // Run-phase invocations resolve their commit config downstream (run.json
        // for recorded runs, resolveCreateCommits for standalone), so this assert
        // must not fire for them; otherwise an nx.json prefix the whole-file run
        // legitimately uses would wedge every dispensed command.
        const runPhase = isRunPhaseInvocation(mergedArgs);
        if (!runPhase) {
            (0, migrate_config_1.assertCommitPrefixHasCommits)(mergedArgs);
        }
        // One fetcher (registry-first, install fallback) shared by the `--include`
        // eligibility gate and the migration cascade so package metadata is fetched
        // at most once per package/version.
        const fetch = createFetcher((0, package_manager_1.getPackageManagerCommand)());
        // `--run-migrations` without a value parses as '', so only undefined (and
        // no run-phase flag) means the generate phase.
        const isGenerateInvocation = mergedArgs['runMigrations'] === undefined && !runPhase;
        let opts;
        try {
            opts = await parseMigrationsOptions(mergedArgs, fetch);
        }
        catch (e) {
            if (isGenerateInvocation) {
                (0, migrate_analytics_1.reportMigrateGenerateError)('resolve_version', e);
            }
            else if (runPhase) {
                (0, migrate_analytics_1.reportMigrateRunError)({ code: 'other', error: e });
            }
            throw e;
        }
        switch (opts.type) {
            case 'generateMigrations':
                await generateMigrationsJsonAndUpdatePackageJson(root, opts, fetch);
                return;
            case 'runSingleMigration':
                try {
                    return await runSingleMigrationFromCli(root, opts, rawArgs, mergedArgs);
                }
                catch (e) {
                    // `runInstall` already logged the remediation; returning instead of
                    // rethrowing keeps `handleErrors` from printing a stack over it.
                    if (e instanceof execute_migration_1.NpmPeerDepsInstallError) {
                        (0, migrate_analytics_1.reportMigrateRunError)({ code: 'npm_install', error: e });
                        return 1;
                    }
                    (0, migrate_analytics_1.reportMigrateRunError)({ code: 'other', error: e });
                    throw e;
                }
            case 'orchestratorReconcile':
                return await runOrchestratorReconcileFromCli(root, opts, rawArgs);
            case 'runMigrations':
                try {
                    return await runMigrations(root, opts, rawArgs, mergedArgs['verbose'], mergedArgs['createCommits'], mergedArgs['commitPrefix'] ?? command_object_1.DEFAULT_MIGRATION_COMMIT_PREFIX, mergedArgs['skipInstall']);
                }
                catch (e) {
                    if (e instanceof execute_migration_1.NpmPeerDepsInstallError) {
                        (0, migrate_analytics_1.reportMigrateRunError)({ code: 'npm_install', error: e });
                        return 1;
                    }
                    (0, migrate_analytics_1.reportMigrateRunError)({ code: 'other', error: e });
                    throw e;
                }
            default: {
                // `unhandled: never` makes a new invocation type a compile error here
                // rather than a silent fall-through.
                const unhandled = opts;
                throw new Error(`Unhandled migrate invocation type: ${JSON.stringify(unhandled)}`);
            }
        }
    });
}
// Evaluated manifest code can throw any value: a null-prototype object defeats
// String() (the Object.prototype.toString rung catches it), and a revoked
// proxy defeats that too. Interpolating either in a catch would throw again
// and escape the catch.
function stringifyCaught(e) {
    try {
        return String(e);
    }
    catch {
        try {
            return Object.prototype.toString.call(e);
        }
        catch {
            return '<unprintable value>';
        }
    }
}
// A resolver-based lookup (including `resolvePackageJsonWithoutCachePollution`,
// which does defeat Node's package self-reference) is the wrong tool here:
// resolvers fall back to NODE_PATH after the explicit paths, and NODE_PATH
// names the temp installation when this runs there. The scan below reads its
// candidate directories itself, so neither NODE_PATH nor self-reference can
// reach it; `getNxBin` (utils/child-process.ts), which locates the nx the
// hand-off spawns, avoids resolvers for the same reason, over a narrower set
// of directories: it skips `.nx/installation`, declines a root without a
// package.json, and stops at the nearest install rather than reading past an
// unusable one. The PnP branch below stays bespoke either way: a resolver
// cannot see into the zip cache without the PnP runtime.
function readLocalNxVersion(root) {
    // A PnP manifest is consulted only when yarn drives the hand-off:
    // `getRunNxBaseCommand` builds the hand-off command through this same
    // detectPackageManager call (which answers from nx.json's
    // cli.packageManager first, before any lockfile), and yarn is the one
    // package manager that executes the manifest's nx. That mirror alone
    // cannot see a switch off yarn, because yarn.lock survives one and
    // outranks all but bun's lockfiles in the detection order, while .pnp.cjs
    // lingers only on a switch to another package manager (yarn removes it
    // when moving to node_modules linking). A rival lockfile beside the
    // manifest is therefore read as evidence of such a switch, though not
    // proof, since `pnpm install --lockfile-only` writes one without
    // installing: on a scan miss the manifest still answers rather than
    // failing the guards, and a rival install over a still-live PnP
    // workspace is read over the PnP nx the yarn spawn executes, because
    // preferring the manifest would judge the dead install that a completed
    // switch leaves behind and refuse persistently. The known misread left
    // is yarn classic driving a workspace with a leftover Berry manifest
    // and no other lockfile; telling the two yarns apart from disk is not
    // worth the fragility, and a `yarn node` runtime probe was rejected
    // because its stdout is forgeable through an inherited NODE_OPTIONS
    // preload and a hung descendant holding the output pipe outlives a
    // subprocess timeout on this synchronous path.
    const pnpManifest = ['.pnp.cjs', '.pnp.js']
        .map((f) => (0, path_1.join)(root, f))
        .find((f) => (0, fs_1.existsSync)(f));
    if (pnpManifest) {
        const competingLockfile = [
            'package-lock.json',
            'npm-shrinkwrap.json',
            'pnpm-lock.yaml',
            'bun.lockb',
            'bun.lock',
        ].some((f) => (0, fs_1.existsSync)((0, path_1.join)(root, f)));
        if (competingLockfile) {
            const version = scanNodeModulesForNxVersion(root);
            if (version) {
                return version;
            }
        }
        try {
            if ((0, package_manager_1.detectPackageManager)(root) === 'yarn') {
                // Compiled manually rather than required: a require would serve the
                // stale cached copy the runtime loaded at startup. new Function does
                // not strip a leading shebang like the CJS loader, so drop it here.
                const manifestModule = {
                    exports: {},
                };
                new Function('module', 'exports', 'require', '__dirname', '__filename', (0, fs_1.readFileSync)(pnpManifest, 'utf-8').replace(/^#!.*/, ''))(manifestModule, manifestModule.exports, require, root, pnpManifest);
                const packageJsonPath = manifestModule.exports.resolveRequest('nx/package.json', (0, path_1.join)(root, 'package.json'));
                if (packageJsonPath) {
                    // A resolving manifest names the install the yarn spawn runs, so
                    // every branch below returns rather than falling through to the
                    // ancestor scan.
                    try {
                        const { version } = (0, fileutils_1.readJsonFile)(packageJsonPath);
                        if (typeof version === 'string') {
                            logger_1.logger.verbose(`Read the workspace's nx version ${version} from '${packageJsonPath}'.`);
                            return version;
                        }
                        logger_1.logger.verbose(`'${packageJsonPath}' does not declare a usable version.`);
                        return undefined;
                    }
                    catch (readError) {
                        // A zip-served path (installs with scripts disabled keep nx
                        // zipped) cannot be read without the PnP runtime's zip fs, but
                        // the manifest's own locator still names the version (e.g.
                        // 'virtual:<hash>#npm:23.1.0').
                        let version;
                        try {
                            const reference = manifestModule.exports.findPackageLocator?.(packageJsonPath)?.reference;
                            version =
                                typeof reference === 'string'
                                    ? reference.match(/npm:([^#:]+)/)?.[1]
                                    : undefined;
                        }
                        catch (locatorError) {
                            logger_1.logger.verbose(`Could not read the nx locator from the PnP manifest '${pnpManifest}': ${stringifyCaught(locatorError)}`);
                        }
                        if (version && (0, semver_1.valid)(version)) {
                            logger_1.logger.verbose(`Read the workspace's nx version ${version} from the locator in the PnP manifest '${pnpManifest}'.`);
                            return version;
                        }
                        logger_1.logger.verbose(`Could not read the workspace's nx version through the PnP manifest '${pnpManifest}': ${stringifyCaught(readError)}`);
                        return undefined;
                    }
                }
            }
        }
        catch (e) {
            // Degrade to the full scan: neither a failed detection nor an
            // unevaluable manifest can name the spawn's nx.
            logger_1.logger.verbose(`Could not read the workspace's nx version through the PnP manifest '${pnpManifest}': ${stringifyCaught(e)}`);
        }
    }
    return scanNodeModulesForNxVersion(root);
}
// The workspace's own install locations first (.nx/installation, root), then
// ancestor directories: package-manager executable lookup ascends (npx and
// bun always, pnpm and yarn inside an outer workspace) and hoisted layouts
// install nx above the workspace root. `getNxBin` ascends too, so an ancestor
// read here is usually the one the hand-off spawns. They diverge for a
// `.nx/installation` workspace, which `getNxBin` declines, and where the only
// nx found sits past the package manager's own lookup boundary and the spawn
// has fallen back to that manager: yarn then reports "command not found"
// while pnpm exec lands on an nx on PATH. The version read here is therefore
// the readable answer, not necessarily the executed one.
function scanNodeModulesForNxVersion(root) {
    const searchPaths = [...(0, installation_directory_1.getNxRequirePaths)(root)];
    for (let dir = (0, path_1.dirname)(root);; dir = (0, path_1.dirname)(dir)) {
        searchPaths.push(dir);
        if (dir === (0, path_1.dirname)(dir)) {
            break;
        }
    }
    return readNxVersionFromNodeModules(searchPaths);
}
function readNxVersionFromNodeModules(searchPaths) {
    for (const searchPath of searchPaths) {
        const packageJsonPath = (0, path_1.join)(searchPath, 'node_modules', 'nx', 'package.json');
        try {
            if ((0, fs_1.existsSync)(packageJsonPath)) {
                const { version } = (0, fileutils_1.readJsonFile)(packageJsonPath);
                if (typeof version === 'string') {
                    logger_1.logger.verbose(`Resolved nx version ${version} from '${packageJsonPath}'.`);
                    return version;
                }
                logger_1.logger.verbose(`'${packageJsonPath}' does not declare a usable version; continuing the search.`);
            }
        }
        catch (e) {
            logger_1.logger.verbose(`Could not read the workspace's installed nx version from '${packageJsonPath}': ${e}`);
        }
    }
    return undefined;
}
// Mirrors the local-nx hand-off of the other run paths so a reconcile always
// executes against the workspace-local nx that owns the run state, never the
// temp installation. Reconciles only read state and commit, so no install.
async function runOrchestratorReconcileFromCli(root, opts, args) {
    if (!__dirname.startsWith(workspace_root_1.workspaceRoot)) {
        // The workspace-local nx we are about to hand off to must be new enough to
        // understand the new flags we forward to it.
        (0, version_skew_guard_1.assertWorkspaceNxSupportsNewMigrateFlags)({
            argv: args,
            readLocalNxVersion: () => readLocalNxVersion(root),
        });
        return handOffToLocalNx(args);
    }
    const { runOrchestratorReconcile } = require('./run');
    return runOrchestratorReconcile({
        root,
        runId: opts.runId,
        stepAction: opts.stepAction,
    });
}
// Keeps `--run-migration` behaving like `--run-migrations` when invoked from
// a temp `nx@latest` install: same pre-install, same local-nx hand-off.
async function runSingleMigrationFromCli(root, opts, args, mergedArgs) {
    const shouldSkipInstall = mergedArgs['skipInstall'] ?? false;
    // A recorded execution skips the pre-install: the run carries its own
    // install policy and its worker installs what the migration changed, so
    // paying for a full install ahead of every dispensed command would be
    // redundant.
    if (opts.runId === undefined &&
        !shouldSkipInstall &&
        !process.env.NX_MIGRATE_SKIP_INSTALL) {
        await (0, execute_migration_1.runInstall)(undefined, 'pre-migration', (0, execute_migration_1.formatSingleMigrationRerunCommand)(opts.runMigration));
    }
    if (!__dirname.startsWith(workspace_root_1.workspaceRoot)) {
        // Must stay after the pre-install: it reads the version that install may
        // have just updated, so checking earlier would falsely refuse a workspace
        // whose package.json bump was not installed yet.
        (0, version_skew_guard_1.assertWorkspaceNxSupportsNewMigrateFlags)({
            argv: args,
            // `workspaceRoot`, not `root`: the migrate flow's `root` is the
            // invocation directory, which may sit below the workspace the hand-off
            // resolves nx in.
            readLocalNxVersion: () => readLocalNxVersion(workspace_root_1.workspaceRoot),
        });
        return handOffToLocalNx(args);
    }
    // The worker resolves the agentic flow, the effective commit config, and
    // the default-branch confirmation itself; hand it the raw flags. Recorded
    // runs (--run-id) take their commit config from run.json instead.
    // Lazy-load run/ so plain migrate and repair runs don't pay for the agentic
    // selection chain its barrel pulls in eagerly.
    const { runSingleMigrationWorker } = require('./run');
    await runSingleMigrationWorker({
        root,
        runMigration: opts.runMigration,
        runId: opts.runId,
        agentic: opts.agentic,
        validate: opts.validate,
        createCommits: mergedArgs['createCommits'],
        commitPrefix: mergedArgs['commitPrefix'] ??
            command_object_1.DEFAULT_MIGRATION_COMMIT_PREFIX,
        interactive: opts.interactive,
        skipInstall: shouldSkipInstall,
        isVerbose: mergedArgs['verbose'] ?? false,
    });
}
async function runMigration() {
    return (0, handle_errors_1.handleErrors)(process.env.NX_VERBOSE_LOGGING === 'true', async () => {
        // Spawning `nx _migrate` re-resolves the workspace's nx, normally the
        // very installation running this code: bin/nx.ts delegated the outer
        // `migrate` command to it, while `_migrate` skips that delegation. A
        // new-flag invocation reaching this fallback therefore lands on an nx
        // that parsed the flags, so it needs no capability check. Two lookups
        // can still diverge from the running install, both properties of the
        // spawn machinery rather than of this fallback: a `.nx/installation`
        // beside a root package.json, and, once the spawn falls back to the
        // package manager, a lookup that misses the workspace install and lands
        // on an nx on PATH (pnpm exec).
        const forwardedArgv = process.argv.slice(3);
        const runLocalMigrate = () => runOrReturnExitCode(() => (0, child_process_2.runNxArgvSync)(['_migrate', ...forwardedArgv], {
            stdio: ['inherit', 'inherit', 'inherit'],
        }));
        if (!(0, version_skew_guard_1.targetsExistingRun)(process.argv.slice(3)) &&
            process.env.NX_USE_LOCAL !== 'true' &&
            process.env.NX_MIGRATE_USE_LOCAL === undefined) {
            // The version spec mirrors nxCliPath's; keep the two in sync.
            const cliVersionSpec = process.env.NX_MIGRATE_CLI_VERSION || 'latest';
            const target = await (0, version_skew_guard_1.resolveNewMigrateFlagsRunTarget)({
                argv: process.argv.slice(3),
                cliVersionSpec,
                fromEnvOverride: !!process.env.NX_MIGRATE_CLI_VERSION,
                ownNxVersion: versions_1.nxVersion,
                resolveVersion: (spec) => 
                // A probe must not prompt, write pnpm excludes, or install; a
                // minimum-release-age violation surfaces as a rejection and
                // routes local.
                (0, resolve_package_version_1.resolvePackageVersionRespectingMinReleaseAge)('nx', spec, {
                    applySideEffects: false,
                }),
                readLocalNxVersion: () => readLocalNxVersion(workspace_root_1.workspaceRoot),
            });
            if (target === 'local-nx') {
                return runLocalMigrate();
            }
            const p = await nxCliPath();
            if (p === null) {
                return runLocalMigrate();
            }
            // ensure local registry from process is not interfering with the install
            // when we start the process from temp folder the local registry would override the custom registry
            if (process.env.npm_config_registry &&
                process.env.npm_config_registry.match(/^https:\/\/registry\.(npmjs\.org|yarnpkg\.com)/)) {
                delete process.env.npm_config_registry;
            }
            // Intentionally not the workspace's nx: `p` is an nx CLI freshly
            // installed into a temp dir by nxCliPath() (latest, or
            // NX_MIGRATE_CLI_VERSION), so migrations run with an up-to-date migrate
            // implementation. `p` is <tmpDir>/node_modules/.bin/nx, a shell shim;
            // spawning the entry point that install's own manifest names instead
            // keeps the forwarded argv out of a shell. That install declares nx
            // itself, so it is read without ascending: an nx above the temp dir is
            // one nothing asked for, and the shim below is the answer instead.
            const tempNxEntry = (0, child_process_2.readInstalledNxBin)((0, path_1.dirname)((0, path_1.dirname)((0, path_1.dirname)(p))));
            return runOrReturnExitCode(() => tempNxEntry
                ? (0, child_process_2.runNxArgvSync)(['_migrate', ...forwardedArgv], {
                    stdio: ['inherit', 'inherit', 'inherit'],
                    nxBin: tempNxEntry,
                })
                : (0, child_process_1.execSync)(`${(0, shell_quoting_1.quoteShellArg)(p)} _migrate ${forwardedArgv
                    .map(shell_quoting_1.quoteShellArg)
                    .join(' ')}`, {
                    stdio: ['inherit', 'inherit', 'inherit'],
                    windowsHide: true,
                }));
        }
        return runLocalMigrate();
    });
}
/**
 * Resolves a migration's collection once and derives everything the run loop
 * needs from that single read: the implementation context (`collection` +
 * `collectionPath`, handed to `runNxOrAngularMigration`) and, for agentic runs,
 * the workspace-relative documentation path handed to the agent.
 *
 * Read fresh per migration (not cached across the loop) so a prior migration's
 * reinstall is reflected, exactly as before. Error handling matches each field's
 * role:
 * - Migrations that run an implementation REQUIRE the collection; an unreadable
 *   collection throws and aborts that migration (caught by the run loop).
 * - Prompt-only migrations don't run an implementation, so the collection is
 *   read only to resolve documentation - a failure there is non-fatal: the
 *   prompt still runs and the supplementary doc is skipped with a warning.
 */
function resolveMigrationForRun(root, migration, resolveDocumentation) {
    let resolvedCollection;
    if (!(0, migration_shape_1.isPromptOnlyMigration)(migration)) {
        resolvedCollection = (0, execute_migration_1.readMigrationCollection)(migration.package, root);
    }
    else if (resolveDocumentation && migration.documentation) {
        try {
            resolvedCollection = (0, execute_migration_1.readMigrationCollection)(migration.package, root);
        }
        catch {
            // Non-fatal: documentation is supplementary; the warning below fires.
        }
    }
    let documentationPath;
    if (resolveDocumentation && migration.documentation) {
        documentationPath = resolvedCollection
            ? (0, execute_migration_1.resolveDocumentationFileToWorkspacePath)(root, (0, path_1.dirname)(resolvedCollection.collectionPath), migration.documentation)
            : undefined;
        if (!documentationPath) {
            logger_1.logger.warn(`Could not resolve the "documentation" file "${migration.documentation}" declared for migration "${migration.package}: ${migration.name}". It will be skipped as additional context for the AI agent.`);
        }
    }
    return { resolvedCollection, documentationPath };
}
async function nxCliPath(nxWorkspaceRoot) {
    const version = process.env.NX_MIGRATE_CLI_VERSION || 'latest';
    const isVerbose = process.env.NX_VERBOSE_LOGGING === 'true';
    await (0, provenance_1.ensurePackageHasProvenance)('nx', version);
    try {
        const packageManager = (0, package_manager_1.detectPackageManager)();
        const pmc = (0, package_manager_1.getPackageManagerCommand)(packageManager);
        const { dirSync } = require('tmp');
        const tmpDir = dirSync().name;
        (0, fileutils_1.writeJsonFile)((0, path_1.join)(tmpDir, 'package.json'), {
            dependencies: {
                nx: version,
            },
            license: 'MIT',
        });
        const root = nxWorkspaceRoot ?? workspace_root_1.workspaceRoot;
        const isNonJs = !(0, fs_1.existsSync)((0, path_1.join)(root, 'package.json'));
        (0, package_manager_1.copyPackageManagerConfigurationFiles)(isNonJs ? (0, installation_directory_1.getNxInstallationPath)(root) : root, tmpDir);
        // Let's print the output of the install process to the console when verbose
        // is enabled, so it's easier to debug issues with the installation process
        const stdio = isVerbose
            ? ['ignore', 'inherit', 'inherit']
            : 'ignore';
        if (pmc.preInstall) {
            // ensure package.json and repo in tmp folder is set to a proper package manager state
            (0, child_process_1.execSync)(pmc.preInstall, {
                cwd: tmpDir,
                stdio,
                windowsHide: true,
            });
            // if it's berry ensure we set the node_linker to node-modules
            if (packageManager === 'yarn' && pmc.ciInstall.includes('immutable')) {
                (0, child_process_1.execSync)('yarn config set nodeLinker node-modules', {
                    cwd: tmpDir,
                    stdio,
                    windowsHide: true,
                });
            }
        }
        (0, child_process_1.execSync)(`${pmc.install} ${pmc.ignoreScriptsFlag ?? ''}`, {
            cwd: tmpDir,
            stdio,
            windowsHide: true,
        });
        // Set NODE_PATH so that these modules can be used for module resolution
        addToNodePath((0, path_1.join)(tmpDir, 'node_modules'));
        addToNodePath((0, path_1.join)(nxWorkspaceRoot ?? workspace_root_1.workspaceRoot, 'node_modules'));
        return (0, path_1.join)(tmpDir, `node_modules`, '.bin', 'nx');
    }
    catch (e) {
        console.error(`Failed to install the ${version} version of the migration script. Falling back to the workspace's installed nx.`);
        if (isVerbose) {
            console.error(e);
        }
        return null;
    }
}
function addToNodePath(dir) {
    // NODE_PATH is a delimited list of paths.
    // The delimiter is different for windows.
    const delimiter = require('os').platform() === 'win32' ? ';' : ':';
    const paths = process.env.NODE_PATH
        ? process.env.NODE_PATH.split(delimiter)
        : [];
    // Add the tmp path
    paths.push(dir);
    // Update the env variable.
    process.env.NODE_PATH = paths.join(delimiter);
}
