export declare const RUN_ID_SAFE: RegExp;
/**
 * Creates a run id: a sortable, filesystem-safe UTC timestamp followed by a
 * random suffix (e.g. `20260715T101530-3f9a1c02`). Never derived from
 * package or Nx versions, so it stays stable across an Nx version bump
 * mid-run.
 */
export declare function createRunId(): string;
/**
 * Hashes a migrations.json plan so a resumed run can detect whether the plan
 * changed since a round was recorded. `nx-console` is stripped first since
 * editors write to it without changing the plan; object keys are sorted
 * recursively (arrays keep their order) so key reordering from a different
 * JSON serializer doesn't change the hash.
 */
export declare function computePlanHash(migrationsJsonContent: string | object): string;
