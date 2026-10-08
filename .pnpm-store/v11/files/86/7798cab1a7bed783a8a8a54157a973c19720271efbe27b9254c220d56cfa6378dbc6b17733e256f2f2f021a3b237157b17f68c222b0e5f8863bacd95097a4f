"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MULTI_MAJOR_MODES = exports.MIGRATE_INCLUDE_VALUES = exports.DEFAULT_MIGRATION_COMMIT_PREFIX = exports.yargsInternalMigrateCommand = exports.yargsMigrateCommand = void 0;
exports.customCommitPrefixHasNoEffect = customCommitPrefixHasNoEffect;
const handle_import_1 = require("../../utils/handle-import");
const documentation_1 = require("../yargs-utils/documentation");
const shared_options_1 = require("../yargs-utils/shared-options");
const cli_args_1 = require("./agentic/cli-args");
const step_actions_1 = require("./step-actions");
exports.yargsMigrateCommand = {
    command: 'migrate [packageAndVersion]',
    describe: `Creates a migrations file or runs migrations from the migrations file.
  - Migrate packages and create migrations.json (e.g., nx migrate @nx/workspace@latest)
  - Run migrations (e.g., nx migrate --run-migrations=migrations.json). Use flag --if-exists to run migrations only if the migrations file exists.
  - Run a single migration from migrations.json by id (e.g., nx migrate --run-migration=@nx/js:my-migration).`,
    builder: (yargs) => (0, documentation_1.linkToNxDevAndExamples)(withMigrationOptions(yargs), 'migrate'),
    handler: async () => process.exit(await (await (0, handle_import_1.handleImport)('./migrate.js', __dirname)).runMigration()),
};
exports.yargsInternalMigrateCommand = {
    command: '_migrate [packageAndVersion]',
    describe: false,
    builder: (yargs) => withMigrationOptions(yargs),
    handler: async (args) => process.exit(await (await (0, handle_import_1.handleImport)('./migrate.js', __dirname)).migrate(process.cwd(), args, process.argv.slice(3))),
};
exports.DEFAULT_MIGRATION_COMMIT_PREFIX = 'chore: [nx migration] ';
/** Allowed values for `--include` / `migrate.include`. */
exports.MIGRATE_INCLUDE_VALUES = ['required', 'optional', 'all'];
/** Allowed values for `--multi-major-mode` / `migrate.multiMajorMode`. */
exports.MULTI_MAJOR_MODES = ['direct', 'gradual'];
/**
 * Whether a custom commit prefix would be silently ignored: commits aren't
 * enabled and the agentic flow can't enable them either. Shared by the yargs
 * `.check()` (CLI args) and the nx.json overlay (merged args) so the rule lives
 * in one place. `agentic` may flip commits on by default, so a configured
 * agentic value (other than `false`, and not paired with `--no-create-commits`)
 * keeps the prefix in play.
 */
function customCommitPrefixHasNoEffect(args) {
    const agenticMayEnableCommits = args.agentic !== undefined &&
        args.agentic !== false &&
        args.createCommits !== false;
    return (args.createCommits !== true &&
        !agenticMayEnableCommits &&
        args.commitPrefix !== undefined &&
        args.commitPrefix !== exports.DEFAULT_MIGRATION_COMMIT_PREFIX);
}
function withMigrationOptions(yargs) {
    return (0, shared_options_1.withVerbose)(yargs)
        .positional('packageAndVersion', {
        describe: `The target package and version (e.g, @nx/workspace@16.0.0).`,
        type: 'string',
    })
        .option('runMigrations', {
        describe: `Execute migrations from a file (when the file isn't provided, execute migrations from migrations.json).`,
        type: 'string',
    })
        .option('runMigration', {
        describe: "Run a single migration from migrations.json by id. The id is '<package>:<name>'; a bare '<name>' is accepted when it matches exactly one migration. A name that contains ':' must use the full '<package>:<name>' form.",
        type: 'string',
    })
        .option('runId', {
        // Hidden with the orchestrator itself.
        describe: 'The orchestrated migrate run to record a single migration into, or to reconcile when given without --run-migration.',
        type: 'string',
        hidden: true,
    })
        .option('stepAction', {
        describe: 'How an orchestrated reconcile resolves its single failed or died step.',
        choices: step_actions_1.STEP_ACTIONS,
        type: 'string',
        hidden: true,
    })
        .option('ifExists', {
        describe: `Run migrations only if the migrations file exists, if not continues successfully.`,
        type: 'boolean',
        default: false,
    })
        .option('from', {
        describe: 'Use the provided versions for packages instead of the ones installed in node_modules (e.g., --from="@nx/react@16.0.0,@nx/js@16.0.0").',
        type: 'string',
    })
        .option('to', {
        describe: 'Use the provided versions for packages instead of the ones calculated by the migrator (e.g., --to="@nx/react@16.0.0,@nx/js@16.0.0").',
        type: 'string',
    })
        .option('createCommits', {
        describe: 'Automatically create a git commit after each migration runs.',
        type: 'boolean',
        alias: ['C'],
    })
        .option('commitPrefix', {
        describe: 'Commit prefix to apply to the commit for each migration, when --create-commits is enabled.',
        type: 'string',
        default: exports.DEFAULT_MIGRATION_COMMIT_PREFIX,
    })
        .option('interactive', {
        describe: "Enable confirmation prompts for collecting optional package updates and migrations. Deprecated and slated for removal in Nx v24. Use '--include' instead. The flag stays valid for other interactive prompts.",
        type: 'boolean',
    })
        .option('excludeAppliedMigrations', {
        describe: 'Exclude migrations that should have been applied on previous updates. To be used with --from.',
        type: 'boolean',
        default: false,
    })
        .option('skipInstall', {
        describe: 'Skip installing packages before running migrations. Useful when the installation needs to be performed manually (e.g., to resolve peer dependency conflicts).',
        type: 'boolean',
        default: false,
    })
        .option('include', {
        describe: "Restrict which packages to migrate. Only applies when the target package supports optional updates. 'required' processes only the target package and the related packages it ships with; 'optional' processes only the optional dependency updates those packages recommend, catching up on any that may have been skipped previously; 'all' processes everything. When the target supports optional updates in an interactive terminal, prompts for the value if not provided; otherwise defaults to 'all'.",
        type: 'string',
        choices: exports.MIGRATE_INCLUDE_VALUES,
    })
        .option('multiMajorMode', {
        describe: "Skip the multi-major migration prompt/warning and pick how to handle the jump. 'direct' migrates straight to the requested target. 'gradual' migrates to the smallest recommended step (re-run `nx migrate` to continue toward the original target). Equivalent env var: NX_MULTI_MAJOR_MODE=direct|gradual.",
        type: 'string',
        choices: exports.MULTI_MAJOR_MODES,
    })
        .option('agentic', {
        describe: 'Enable the agentic flow for prompt-based migrations and AI-driven review. Pass `--agentic=<agent>` to pin a specific agent (claude-code, codex, or opencode). Pass `--agentic=false` or `--no-agentic` to disable.',
        coerce: cli_args_1.coerceAgenticArg,
    })
        .option('validate', {
        describe: 'When `--agentic` resolves to an enabled agent, run agent-driven validation after generator-only migrations that have no `prompt:` field. Defaults to on; pass `--no-validate` to opt out. Has no effect when `--agentic` is disabled, when running inside an outer agent, or when running non-interactively without an explicit agent.',
        type: 'boolean',
    })
        .check(({ createCommits, commitPrefix, from, excludeAppliedMigrations, include, agentic, }) => {
        // Only an explicit `--no-create-commits` is decidable here, before the
        // nx.json overlay runs: an explicit `false` can't be rescued by nx.json
        // (the CLI flag wins, and the agentic flow can't enable commits when
        // they're explicitly off). When `createCommits` is undefined, nx.json
        // may still enable commits, so defer to the post-overlay
        // `assertCommitPrefixHasCommits` check.
        if (createCommits === false &&
            customCommitPrefixHasNoEffect({
                createCommits,
                commitPrefix,
                agentic,
            })) {
            throw new Error('Error: Providing a custom commit prefix requires --create-commits to be enabled');
        }
        if (excludeAppliedMigrations && !from && include !== 'optional') {
            throw new Error('Error: Excluding migrations that should have been previously applied requires --from to be set');
        }
        if (typeof agentic === 'string' &&
            !cli_args_1.AGENT_IDS.includes(agentic)) {
            throw new Error(`Error: Invalid --agentic value "${agentic}". Allowed: ${cli_args_1.AGENT_IDS.join(', ')}, true, false.`);
        }
        return true;
    });
}
