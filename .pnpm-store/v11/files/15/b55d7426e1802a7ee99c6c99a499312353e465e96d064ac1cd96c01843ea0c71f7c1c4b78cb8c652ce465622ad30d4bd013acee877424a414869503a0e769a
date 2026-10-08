"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUN_ID_SAFE = void 0;
exports.createRunId = createRunId;
exports.computePlanHash = computePlanHash;
const crypto_1 = require("crypto");
// Orchestrator-generated run ids always match; anything else could smuggle
// shell metacharacters into dispensed commands or a path out of the runs dir
// (the leading alphanumeric also rejects '.' and '..').
exports.RUN_ID_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/**
 * Creates a run id: a sortable, filesystem-safe UTC timestamp followed by a
 * random suffix (e.g. `20260715T101530-3f9a1c02`). Never derived from
 * package or Nx versions, so it stays stable across an Nx version bump
 * mid-run.
 */
function createRunId() {
    return `${compactUtcTimestamp(new Date())}-${(0, crypto_1.randomBytes)(4).toString('hex')}`;
}
function compactUtcTimestamp(date) {
    // '2026-07-15T10:15:30.123Z' -> '20260715T101530': strips separators and
    // milliseconds so the id is filesystem-safe on every platform.
    return date
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, '');
}
/**
 * Hashes a migrations.json plan so a resumed run can detect whether the plan
 * changed since a round was recorded. `nx-console` is stripped first since
 * editors write to it without changing the plan; object keys are sorted
 * recursively (arrays keep their order) so key reordering from a different
 * JSON serializer doesn't change the hash.
 */
function computePlanHash(migrationsJsonContent) {
    const parsed = (typeof migrationsJsonContent === 'string'
        ? JSON.parse(migrationsJsonContent)
        : migrationsJsonContent);
    const withoutNxConsole = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'nx-console'));
    return (0, crypto_1.createHash)('sha256')
        .update(JSON.stringify(canonicalize(withoutNxConsole)))
        .digest('hex');
}
function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value !== null && typeof value === 'object') {
        const sorted = {};
        for (const key of Object.keys(value).sort()) {
            sorted[key] = canonicalize(value[key]);
        }
        return sorted;
    }
    return value;
}
