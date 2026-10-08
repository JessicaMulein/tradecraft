"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetSgrAfterAgent = resetSgrAfterAgent;
exports.logMigrationBoundary = logMigrationBoundary;
exports.logAgenticSuccessOutcome = logAgenticSuccessOutcome;
exports.logWaivedAgenticStep = logWaivedAgenticStep;
exports.countLandedCommits = countLandedCommits;
exports.countWaivedAgenticSteps = countWaivedAgenticSteps;
exports.formatWaivedAgenticSteps = formatWaivedAgenticSteps;
exports.retainedMigrations = retainedMigrations;
exports.logFailureRecap = logFailureRecap;
exports.buildTallyBodyLine = buildTallyBodyLine;
exports.buildRetainedAtSuccessBody = buildRetainedAtSuccessBody;
exports.buildDirectiveBlockBodyLines = buildDirectiveBlockBodyLines;
const tslib_1 = require("tslib");
const pc = tslib_1.__importStar(require("picocolors"));
const logger_1 = require("../../utils/logger");
const migration_shape_1 = require("./migration-shape");
/**
 * Pure presentation helpers for the migrate run phase (`--run-migrations` and
 * the single-migration worker). Shared glyph vocabulary:
 *   `→` start, `✓` success, `✗` failure, `↷` skipped, `ℹ` info, `─` boundary
 *
 * Inputs are typed structurally (e.g. `{ name: string }[]`) so this module
 * stays decoupled from the migration executor in migrate.ts.
 */
/**
 * Some agent TUIs (codex, opencode) don't fully reset their cursor / SGR state
 * when they exit, which corrupts subsequent orchestrator output. Emit an SGR
 * reset + newline so our log lines land on a clean row instead of being
 * overlaid by leftover status bars.
 */
function resetSgrAfterAgent() {
    process.stdout.write('\x1b[0m\n');
}
/**
 * Per-migration boundary header. Anchors the orchestrator log at the start of
 * each migration with the migration index and identity.
 */
function logMigrationBoundary(index, total, pkg, name) {
    const label = `── Migration ${index} of ${total} · ${pkg}:${name} `;
    const targetWidth = 73;
    const dashes = Math.max(3, targetWidth - label.length);
    logger_1.logger.info(`${label}${'─'.repeat(dashes)}`);
}
/**
 * Logs the outcome line that closes an agentic phase. Vocabulary:
 *   ✓ <label>[ (<sha>)]: <summary>
 */
function logAgenticSuccessOutcome(label, sha, summary) {
    const shaPart = sha ? ` (${sha})` : '';
    logger_1.logger.info(`${pc.green('✓')} ${label}${shaPart}: ${summary}`);
}
/**
 * Logs the skip line for a migration that waived its AI step through
 * `skipAgentic`, plus a verbose note for any `agentContext` the waiver
 * dropped. A hybrid waives its paired prompt; a generator-only migration
 * waives the validation pass, so callers must reach here only once they know
 * one was on the table. Under `inside-agent` only a hybrid can, so the
 * hand-off dropped alongside is always a prompt's; a waived generator-only
 * migration keeps its own. The note is author-facing, hence `--verbose`.
 */
function logWaivedAgenticStep(migration, agentContext) {
    logger_1.logger.info(pc.dim((0, migration_shape_1.isHybridMigration)(migration)
        ? '↷ Prompt phase skipped. The migration reported nothing left for the AI step to do.'
        : '↷ Validation skipped. The migration reported its changes need no AI review.'));
    if (agentContext.length === 0)
        return;
    logger_1.logger.verbose(`${migration.package}: ${migration.name} returned skipAgentic: true alongside agentContext, which was dropped. agentContext exists to feed the AI step this migration waived.`);
}
/**
 * Counts the migrations whose own commit actually landed — including the
 * HEAD-resolve-race case (`commit: { kind: 'landed', sha: null }`). Used by
 * the end-of-run "<K> commits created" tally and by the success-path
 * accounting in `executeMigrations`. Counts landed-commit *records* rather
 * than distinct shas; absorbed predecessors (`kind: 'absorbed'`) are not
 * counted because the absorbing commit's record already contributes one.
 */
function countLandedCommits(outcomes) {
    return outcomes.filter((o) => o.commit.kind === 'landed').length;
}
/**
 * Counts the migrations that waived the AI step they would otherwise have
 * run. Shared by the success tally and the failure recap so the two can't
 * report different numbers.
 */
function countWaivedAgenticSteps(outcomes) {
    return outcomes.filter((o) => o.status === 'completed' && o.waivedAgenticStep === true).length;
}
/**
 * The recap phrase for waived AI steps. "not needed" rather than
 * "skipped"/"deferred", which both recaps reserve for work the user still
 * owes.
 */
function formatWaivedAgenticSteps(count) {
    return `${count} AI step${count === 1 ? '' : 's'} not needed`;
}
/**
 * Migrations whose own commit attempt failed and whose diff was never
 * absorbed by a later commit. Surfaces what the user has to commit or
 * revert after the run. Filters on `commit.kind === 'failed'` exactly —
 * `'absorbed'` means the diff cleared into a later commit, `'none'` means
 * no commit was attempted (intentional `--no-create-commits` or no-op).
 */
function retainedMigrations(outcomes) {
    return outcomes
        .filter((o) => o.commit.kind === 'failed')
        .map((o) => ({ package: o.migration.package, name: o.migration.name }));
}
/**
 * Logs a structured recap when a migration throws mid-loop. Inserted between
 * the "Failed to run X" error block and the re-throw so the user (or AI agent
 * driving the run) can see what completed before the failure without scrolling
 * back through the per-migration log to count shas.
 *
 * Counts-based rather than full migration lists so a 24-migration run that
 * fails at #12 doesn't dump 24 names into the recap — readers scroll up to
 * see specifics in the per-migration log. The "last applied" anchor pairs the
 * most recent fully-applied migration with the sha its commit actually
 * produced, so a skipped/deferred step trailing an applied one can't borrow
 * the earlier sha.
 */
function logFailureRecap(opts) {
    const { migrationIndex, totalMigrations, outcomes, migrationEmittedNextSteps, insideAgent, } = opts;
    const appliedCount = outcomes.filter((o) => o.status === 'completed' &&
        (o.kind === 'applied' || o.kind === 'no-changes')).length;
    const deferredCount = outcomes.filter((o) => o.status === 'completed' && o.kind === 'deferred').length;
    const waivedAgenticCount = countWaivedAgenticSteps(outcomes);
    const notAttempted = totalMigrations - migrationIndex;
    // Walk back to the most recent completed record whose work is anchored to
    // a sha — either its own commit (`landed`), or a later commit that
    // absorbed it (`absorbed`). Both `applied` AND `deferred` outcomes can
    // carry a successful commit (hybrid-without-agentic produces `deferred`
    // with a sha from its deterministic half). Skipped and uncommitted
    // records don't anchor.
    let lastApplied;
    for (let i = outcomes.length - 1; i >= 0; i--) {
        const o = outcomes[i];
        if (o.status !== 'completed')
            continue;
        if ((o.kind === 'applied' || o.kind === 'deferred') &&
            (o.commit.kind === 'landed' || o.commit.kind === 'absorbed')) {
            lastApplied = o;
            break;
        }
    }
    // Migrations whose own commit attempt errored AND whose diff was never
    // absorbed by a later commit. Surfaces what the user has to inspect or
    // clean up in the working tree. Single iteration over `outcomes` —
    // `outcomes` is the sole source of truth (including the in-flight
    // migration recorded by the executor's catch block), so no dedupe is
    // needed. `kind: 'failed'` excludes `kind: 'none'` (intentional no-commit:
    // `--no-create-commits` runs and no-op steps).
    const uncommittedAtFailure = [];
    for (const o of outcomes) {
        if (o.commit.kind !== 'failed')
            continue;
        uncommittedAtFailure.push({ migration: o.migration });
    }
    logger_1.logger.info('');
    logger_1.logger.info(`Run halted at migration ${migrationIndex} of ${totalMigrations}.`);
    if (appliedCount === 0 && deferredCount === 0) {
        logger_1.logger.info(`0 migrations completed. ${notAttempted} not attempted.`);
    }
    else {
        const anchorSha = lastApplied === undefined
            ? undefined
            : lastApplied.commit.kind === 'landed'
                ? lastApplied.commit.sha
                : lastApplied.commit.kind === 'absorbed'
                    ? lastApplied.commit.into.sha
                    : undefined;
        // When the anchoring commit hit a HEAD-resolve race, the sha is null;
        // render the migration name alone (without "→ null") so the recap
        // never displays the literal word "null" to the user.
        const anchor = lastApplied
            ? anchorSha
                ? ` (last: ${lastApplied.migration.name} → ${anchorSha})`
                : ` (last: ${lastApplied.migration.name})`
            : '';
        const parts = [`${appliedCount} applied${anchor}`];
        if (deferredCount > 0) {
            parts.push(`${deferredCount} deferred`);
        }
        if (waivedAgenticCount > 0) {
            parts.push(formatWaivedAgenticSteps(waivedAgenticCount));
        }
        logger_1.logger.info(`${parts.join(', ')}. ${notAttempted} not attempted.`);
        logger_1.logger.info(`See the per-migration log above for full details.`);
    }
    if (uncommittedAtFailure.length > 0) {
        logger_1.logger.info('');
        logger_1.logger.info(`Working-tree state retained from ${uncommittedAtFailure.length} migration${uncommittedAtFailure.length === 1 ? '' : 's'} whose commits could not be created:`);
        for (const o of uncommittedAtFailure) {
            logger_1.logger.info(`  - ${o.migration.package}: ${o.migration.name}`);
        }
        logger_1.logger.info('');
        logger_1.logger.info('Inspect with `git status` / `git diff` and either commit them manually or revert before re-running.');
    }
    if (migrationEmittedNextSteps.length > 0) {
        logger_1.logger.info('');
        logger_1.logger.info(`Notes from migrations that completed before the failure:`);
        for (const step of migrationEmittedNextSteps) {
            logger_1.logger.info(`  - ${step}`);
        }
    }
    logger_1.logger.info('');
    if (insideAgent) {
        logger_1.logger.info(`Report the failure and the recap above to the user. They'll need to fix the failing migration and re-run \`nx migrate --run-migrations\` themselves.`);
    }
    else {
        logger_1.logger.info(`Fix the failing migration and re-run \`nx migrate --run-migrations\` to resume.`);
    }
    logger_1.logger.info('');
}
/**
 * Builds the tally body line shown under the top end-of-run NX block. Returns
 * `null` when there is nothing meaningful to tally (e.g. an empty
 * migrations.json), so the caller can omit the body entirely instead of
 * emitting a misleading `0 prompt migrations skipped.` line.
 *
 * Rule (kept coherent across every scenario):
 * - When at least one migration was applied: `<N> migrations applied, <K> commits created[, <D> prompt migrations <skipped|deferred>][, <W> AI steps not needed]`.
 *   The `<K> commits created` part stays even at 0 — it tells the reader work
 *   was applied but not committed (the J4/J8 information made explicit).
 * - When zero migrations were applied but some prompt halves were
 *   skipped/deferred: `<D> prompt migrations <skipped|deferred>` only. Waiving
 *   never adds to `skippedPromptsCount`, so `appliedCount` is non-zero whenever
 *   `waivedAgenticStepsCount` is, and this branch can't be reached with one.
 * - When zero of either: no body line.
 */
function buildTallyBodyLine(opts) {
    const { appliedCount, committedShasCount, skippedPromptsCount, waivedAgenticStepsCount, insideAgent, } = opts;
    const skipVerb = insideAgent ? 'deferred' : 'skipped';
    if (appliedCount === 0) {
        if (skippedPromptsCount === 0)
            return null;
        return `${skippedPromptsCount} prompt migration${skippedPromptsCount === 1 ? '' : 's'} ${skipVerb}.`;
    }
    const parts = [
        `${appliedCount} migration${appliedCount === 1 ? '' : 's'} applied`,
        `${committedShasCount} commit${committedShasCount === 1 ? '' : 's'} created`,
    ];
    if (skippedPromptsCount > 0) {
        parts.push(`${skippedPromptsCount} prompt migration${skippedPromptsCount === 1 ? '' : 's'} ${skipVerb}`);
    }
    if (waivedAgenticStepsCount > 0) {
        parts.push(formatWaivedAgenticSteps(waivedAgenticStepsCount));
    }
    return `${parts.join(', ')}.`;
}
/**
 * Body lines for the end-of-run retained-state warning. Fires on the success
 * path — the run completed but one or more migrations' own commits failed
 * and were never absorbed.
 */
function buildRetainedAtSuccessBody(retainedNames) {
    return [
        ...retainedNames.map((name) => `  - ${name}`),
        '',
        'Their changes are in the working tree. Inspect with `git status` / `git diff` and either commit them manually or revert.',
    ];
}
/**
 * Builds the body lines for the inside-agent directive block. Sub-sections
 * drop independently when empty. Returns an empty array when the block has
 * nothing actionable (no deferred prompts AND no migration-emitted notes) —
 * the caller skips emitting the block entirely in that case.
 */
function buildDirectiveBlockBodyLines(opts) {
    const { skippedPrompts, migrationEmittedNextSteps } = opts;
    const hasDeferred = skippedPrompts.length > 0;
    const hasNotes = migrationEmittedNextSteps.length > 0;
    if (!hasDeferred && !hasNotes)
        return [];
    const lines = [];
    if (hasDeferred) {
        lines.push('Apply the deferred prompts below, in order:');
        skippedPrompts.forEach((m, i) => {
            const kindHint = (0, migration_shape_1.isHybridMigration)(m)
                ? ' — hybrid prompt phase'
                : ' — prompt-only migration';
            lines.push(`  ${i + 1}. ${m.prompt}`);
            lines.push(`       (${m.name}${kindHint})`);
        });
    }
    if (hasNotes) {
        if (hasDeferred)
            lines.push('');
        lines.push(hasDeferred
            ? 'Then relay these migration-emitted notes to the user:'
            : 'Relay these migration-emitted notes to the user:');
        for (const step of migrationEmittedNextSteps) {
            lines.push(`  - ${step}`);
        }
    }
    lines.push('');
    lines.push(hasDeferred && hasNotes
        ? 'Finally, summarize what was done across the run and commit the changes per workspace conventions.'
        : 'Then summarize what was done across the run and commit the changes per workspace conventions.');
    return lines;
}
