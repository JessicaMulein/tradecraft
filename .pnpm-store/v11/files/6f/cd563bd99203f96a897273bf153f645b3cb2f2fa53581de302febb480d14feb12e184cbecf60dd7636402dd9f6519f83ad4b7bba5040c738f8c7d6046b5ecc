"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyNxJsonMigrateDefaults = applyNxJsonMigrateDefaults;
exports.assertCommitPrefixHasCommits = assertCommitPrefixHasCommits;
const cli_args_1 = require("./agentic/cli-args");
const command_object_1 = require("./command-object");
const MULTI_MAJOR_MODE_ENV = 'NX_MULTI_MAJOR_MODE';
/**
 * Overlays `nx.json` `migrate` defaults onto the raw CLI args: a CLI flag wins,
 * then `nx.json`, then the built-in default. Returns a new args object; the
 * input is not mutated.
 *
 * Phase-aware so each option is only filled where it is consumed, and so a
 * config value never trips the mutually-exclusive-flag guards in
 * `parseMigrationsOptions`: `include` and `multiMajorMode` in the generate
 * phase only; `createCommits` / `commitPrefix` and `agentic` / `validate` when
 * running the whole migrations file or a standalone single migration. A
 * `--run-id` invocation takes none of them: a recorded run takes its commit
 * config from run.json and is driven by the outer agent.
 *
 * `include` is carried as `includeFromConfig` so it is never mistaken for an
 * explicit `--include`: `resolveInclude` applies it only when the resolved
 * target supports optional updates.
 */
function applyNxJsonMigrateDefaults(args, migrateConfig, env = process.env) {
    if (!migrateConfig) {
        return args;
    }
    const merged = { ...args };
    // `--run-migrations` with no value is normalized to '' by yargs, so a defined
    // (even empty-string) value means we're in the run-migrations phase.
    const isRunMigrations = merged.runMigrations !== undefined;
    // A bare `--run-id` (orchestrated reconcile) must never take the
    // generate-options overlay, which would leak `include` etc. from nx.json.
    const isSingleMigration = merged.runMigration !== undefined || merged.runId !== undefined;
    // Both overlays are for an invocation that decides these options for
    // itself, which a `--run-id` invocation never does: the recorded worker and
    // the reconcile both read the commit config from run.json, and overlaying
    // `agentic` would trip the `--agentic`/`--run-id` parse conflict.
    if ((isRunMigrations || isSingleMigration) && merged.runId === undefined) {
        if (merged.createCommits === undefined &&
            migrateConfig.createCommits !== undefined) {
            assertType(migrateConfig.createCommits, 'boolean', 'createCommits');
            merged.createCommits = migrateConfig.createCommits;
        }
        // `commitPrefix` carries a yargs default, so the default value is
        // indistinguishable from "not provided" - treat it as not provided so
        // nx.json can override it.
        if ((merged.commitPrefix === undefined ||
            merged.commitPrefix === command_object_1.DEFAULT_MIGRATION_COMMIT_PREFIX) &&
            migrateConfig.commitPrefix !== undefined) {
            assertType(migrateConfig.commitPrefix, 'string', 'commitPrefix');
            merged.commitPrefix = migrateConfig.commitPrefix;
        }
        if (merged.agentic === undefined && migrateConfig.agentic !== undefined) {
            assertValidAgentic(migrateConfig.agentic);
            merged.agentic = (0, cli_args_1.coerceAgenticArg)(migrateConfig.agentic);
        }
        if (merged.validate === undefined && migrateConfig.validate !== undefined) {
            assertType(migrateConfig.validate, 'boolean', 'validate');
            merged.validate = migrateConfig.validate;
        }
    }
    if (!isRunMigrations && !isSingleMigration) {
        if (merged.include === undefined && migrateConfig.include !== undefined) {
            assertOneOf(migrateConfig.include, command_object_1.MIGRATE_INCLUDE_VALUES, 'include');
            merged.includeFromConfig = migrateConfig.include;
        }
        // The NX_MULTI_MAJOR_MODE env var is an established per-invocation override,
        // so it takes precedence over nx.json (CLI flag > env > nx.json > default).
        if (merged.multiMajorMode === undefined &&
            !env[MULTI_MAJOR_MODE_ENV] &&
            migrateConfig.multiMajorMode !== undefined) {
            assertOneOf(migrateConfig.multiMajorMode, command_object_1.MULTI_MAJOR_MODES, 'multiMajorMode');
            merged.multiMajorMode = migrateConfig.multiMajorMode;
        }
    }
    return merged;
}
function assertOneOf(value, allowed, field) {
    if (!allowed.includes(value)) {
        throw new Error(`Error: Invalid nx.json migrate.${field} "${value}". Allowed: ${allowed.join(', ')}.`);
    }
}
function assertType(value, type, field) {
    if (typeof value !== type) {
        throw new Error(`Error: Invalid nx.json migrate.${field} ${JSON.stringify(value)}. Expected a ${type}.`);
    }
}
function assertValidAgentic(agentic) {
    if (typeof agentic === 'boolean') {
        return;
    }
    if (typeof agentic !== 'string' ||
        !cli_args_1.AGENT_IDS.includes(agentic)) {
        throw new Error(`Error: Invalid nx.json migrate.agentic "${agentic}". Allowed: ${cli_args_1.AGENT_IDS.join(', ')}, true, false.`);
    }
}
/**
 * The single authority for the "a custom commit prefix needs commits enabled"
 * invariant. Run it against the final merged args (after
 * `applyNxJsonMigrateDefaults`): the yargs `.check()` only sees the CLI args,
 * but nx.json may enable commits via `createCommits` or `agentic`. The CLI
 * `.check()` only fast-fails the unrescuable explicit `--no-create-commits`
 * case; everything else is decided here.
 */
function assertCommitPrefixHasCommits(merged) {
    const { createCommits, commitPrefix, agentic } = merged;
    if ((0, command_object_1.customCommitPrefixHasNoEffect)({ createCommits, commitPrefix, agentic })) {
        throw new Error('Error: A custom migrate commit prefix requires commits to be enabled. Set `migrate.createCommits` to `true` in nx.json or pass `--create-commits`.');
    }
}
