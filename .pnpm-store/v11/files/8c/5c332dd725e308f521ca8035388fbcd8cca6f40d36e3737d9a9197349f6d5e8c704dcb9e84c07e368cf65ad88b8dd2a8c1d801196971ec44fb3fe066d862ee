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
export declare function resetSgrAfterAgent(): void;
/**
 * Per-migration boundary header. Anchors the orchestrator log at the start of
 * each migration with the migration index and identity.
 */
export declare function logMigrationBoundary(index: number, total: number, pkg: string, name: string): void;
/**
 * Logs the outcome line that closes an agentic phase. Vocabulary:
 *   ✓ <label>[ (<sha>)]: <summary>
 */
export declare function logAgenticSuccessOutcome(label: string, sha: string | null, summary: string): void;
/**
 * Logs the skip line for a migration that waived its AI step through
 * `skipAgentic`, plus a verbose note for any `agentContext` the waiver
 * dropped. A hybrid waives its paired prompt; a generator-only migration
 * waives the validation pass, so callers must reach here only once they know
 * one was on the table. Under `inside-agent` only a hybrid can, so the
 * hand-off dropped alongside is always a prompt's; a waived generator-only
 * migration keeps its own. The note is author-facing, hence `--verbose`.
 */
export declare function logWaivedAgenticStep(migration: {
    package: string;
    name: string;
    prompt?: string;
    implementation?: string;
    factory?: string;
}, agentContext: string[]): void;
/**
 * Per-migration outcome record consumed by the failure recap. One entry is
 * appended per iteration that returned without throwing; the failing migration
 * has no record.
 *
 * - `applied`: ran fully to completion, including any agentic step.
 * - `no-changes`: generator ran but produced no diff (counts as applied work).
 * - `deferred`: prompt half was not applied (agent disabled or inside-agent
 *   mode hands it off). For hybrid migrations the deterministic half still ran.
 *
 * `committedAsPartOf` is set when this migration's own commit attempt failed
 * but its diff was later absorbed into a successor migration's commit (which
 * stages the working tree's accumulated state via `git add -A`). The recap
 * uses this to anchor "last applied" honestly when the last-named commit
 * landed multiple migrations' contributions.
 */
export type MigrationOutcomeKind = 'applied' | 'no-changes' | 'deferred';
/**
 * The state of a migration's commit attempt. Tagged union so consumers don't
 * have to re-derive legal combinations from nullable fields.
 *
 * - `none`     — no commit was attempted (`--no-create-commits` or no diff to
 *                commit).
 * - `landed`   — a commit was actually created. `sha: null` only when
 *                `git rev-parse HEAD` failed transiently right after the
 *                commit landed; by contract the diff did clear.
 * - `failed`   — commit was attempted and errored (signing, hook rejection,
 *                lock, install error mid-attempt, etc.). The diff stays in
 *                the working tree until a later migration's commit absorbs
 *                it (then transitions to `absorbed`) or until the run ends
 *                (then surfaces as retained state).
 * - `absorbed` — own commit failed but a later migration's commit absorbed
 *                this diff via `git add -A`. `into.sha: null` means that
 *                absorbing commit itself hit a HEAD-resolve race; the recap
 *                renders an anchor without a sha.
 */
export type CommitState = {
    kind: 'none';
} | {
    kind: 'landed';
    sha: string | null;
} | {
    kind: 'failed';
} | {
    kind: 'absorbed';
    into: {
        name: string;
        sha: string | null;
    };
};
/**
 * Per-migration record produced by the executor loop. `status: 'completed'`
 * carries the kind (applied / no-changes / deferred); `status: 'aborted'`
 * means the migration threw before completing — the executor's catch block
 * records it so the recap can list it under retained-state alongside any
 * other migrations whose commits never landed.
 *
 * `waivedAgenticStep` is set when the migration returned `skipAgentic: true`
 * and something was actually waived: a hybrid's prompt, which is owed in every
 * agentic mode, or a generator-only migration's validation step, only when it
 * would have run. Recorded here rather than counted in the executor so the
 * success tally and the failure recap derive the same number from the same
 * records instead of threading a counter through both.
 */
export type MigrationOutcome = {
    migration: {
        package: string;
        name: string;
    };
    status: 'completed';
    kind: MigrationOutcomeKind;
    commit: CommitState;
    waivedAgenticStep?: boolean;
} | {
    migration: {
        package: string;
        name: string;
    };
    status: 'aborted';
    commit: CommitState;
};
/**
 * Counts the migrations whose own commit actually landed — including the
 * HEAD-resolve-race case (`commit: { kind: 'landed', sha: null }`). Used by
 * the end-of-run "<K> commits created" tally and by the success-path
 * accounting in `executeMigrations`. Counts landed-commit *records* rather
 * than distinct shas; absorbed predecessors (`kind: 'absorbed'`) are not
 * counted because the absorbing commit's record already contributes one.
 */
export declare function countLandedCommits(outcomes: ReadonlyArray<MigrationOutcome>): number;
/**
 * Counts the migrations that waived the AI step they would otherwise have
 * run. Shared by the success tally and the failure recap so the two can't
 * report different numbers.
 */
export declare function countWaivedAgenticSteps(outcomes: ReadonlyArray<MigrationOutcome>): number;
/**
 * The recap phrase for waived AI steps. "not needed" rather than
 * "skipped"/"deferred", which both recaps reserve for work the user still
 * owes.
 */
export declare function formatWaivedAgenticSteps(count: number): string;
/**
 * Migrations whose own commit attempt failed and whose diff was never
 * absorbed by a later commit. Surfaces what the user has to commit or
 * revert after the run. Filters on `commit.kind === 'failed'` exactly —
 * `'absorbed'` means the diff cleared into a later commit, `'none'` means
 * no commit was attempted (intentional `--no-create-commits` or no-op).
 */
export declare function retainedMigrations(outcomes: ReadonlyArray<MigrationOutcome>): Array<{
    package: string;
    name: string;
}>;
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
export declare function logFailureRecap(opts: {
    migrationIndex: number;
    totalMigrations: number;
    outcomes: ReadonlyArray<MigrationOutcome>;
    migrationEmittedNextSteps: string[];
    insideAgent: boolean;
}): void;
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
export declare function buildTallyBodyLine(opts: {
    appliedCount: number;
    committedShasCount: number;
    skippedPromptsCount: number;
    waivedAgenticStepsCount: number;
    insideAgent: boolean;
}): string | null;
/**
 * Body lines for the end-of-run retained-state warning. Fires on the success
 * path — the run completed but one or more migrations' own commits failed
 * and were never absorbed.
 */
export declare function buildRetainedAtSuccessBody(retainedNames: ReadonlyArray<string>): string[];
/**
 * Builds the body lines for the inside-agent directive block. Sub-sections
 * drop independently when empty. Returns an empty array when the block has
 * nothing actionable (no deferred prompts AND no migration-emitted notes) —
 * the caller skips emitting the block entirely in that case.
 */
export declare function buildDirectiveBlockBodyLines(opts: {
    skippedPrompts: ReadonlyArray<{
        prompt?: string;
        name: string;
        implementation?: string;
        factory?: string;
    }>;
    migrationEmittedNextSteps: string[];
}): string[];
