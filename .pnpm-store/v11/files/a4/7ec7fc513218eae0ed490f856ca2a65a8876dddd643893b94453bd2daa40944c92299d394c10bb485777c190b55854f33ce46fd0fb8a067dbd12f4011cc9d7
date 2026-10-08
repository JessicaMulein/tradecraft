"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPnpmPolicy = readPnpmPolicy;
exports.pickPnpmVersion = pickPnpmVersion;
const child_process_1 = require("child_process");
const semver_1 = require("semver");
const constants_1 = require("../constants");
const errors_1 = require("../errors");
const pick_1 = require("../pick");
// Ordered newest-bound-first so the first matching row applies.
const PNPM_BEHAVIOR_ROWS = [
    {
        minVersion: '12.0.0',
        major: 12,
        strictMode: 'default-loose',
        strictAutoOnWhenExplicit: true,
        excludeGrammar: 'v2-globs-unions',
        writesExcludes: true,
    },
    {
        minVersion: '11.1.3',
        major: 11,
        strictMode: 'default-loose',
        strictAutoOnWhenExplicit: true,
        excludeGrammar: 'v2-globs-unions',
        writesExcludes: true,
    },
    {
        minVersion: '11.1.0',
        major: 11,
        strictMode: 'default-loose',
        strictAutoOnWhenExplicit: true,
        excludeGrammar: 'v2-globs-unions',
        writesExcludes: false,
    },
    {
        minVersion: '11.0.4',
        major: 11,
        strictMode: 'default-loose',
        strictAutoOnWhenExplicit: true,
        excludeGrammar: 'v2-globs-unions',
        writesExcludes: false,
    },
    {
        minVersion: '11.0.0',
        major: 11,
        strictMode: 'default-loose',
        strictAutoOnWhenExplicit: false,
        excludeGrammar: 'v2-globs-unions',
        writesExcludes: false,
    },
    {
        minVersion: '10.19.0',
        major: 10,
        strictMode: 'always',
        strictAutoOnWhenExplicit: false,
        excludeGrammar: 'v2-globs-unions',
        writesExcludes: false,
    },
    {
        minVersion: '10.16.0',
        major: 10,
        strictMode: 'always',
        strictAutoOnWhenExplicit: false,
        excludeGrammar: 'v1-exact-names',
        writesExcludes: false,
    },
];
function findBehaviorRow(pmVersion) {
    return PNPM_BEHAVIOR_ROWS.find((row) => (0, semver_1.gte)(pmVersion, row.minVersion));
}
// Asks pnpm for its own resolved config rather than re-deriving how pnpm layers
// .npmrc / env / pnpm-workspace.yaml / global config across versions. Returns
// null if pnpm cannot be run or its output is not parseable JSON, so the caller
// defers to a real install.
function readPnpmConfigList(root) {
    let raw;
    try {
        raw = (0, child_process_1.execSync)('pnpm config list --json', {
            cwd: root,
            encoding: 'utf-8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    }
    catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object'
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
// Extracts the cooldown keys from pnpm's reported config. pnpm 11 reports them
// camelCase; pnpm 10 reported them kebab-case, so read both forms. The exclude
// list comes back as a JSON array (set in a yaml surface) or a comma-joined
// string (set via .npmrc / env).
function parseCooldownConfig(config) {
    const read = (camelKey, kebabKey) => config[camelKey] ?? config[kebabKey];
    return {
        windowMinutes: toNumber(read('minimumReleaseAge', 'minimum-release-age')) ?? undefined,
        excludes: parseExcludeValue(read('minimumReleaseAgeExclude', 'minimum-release-age-exclude')),
        strictExplicit: toBoolean(read('minimumReleaseAgeStrict', 'minimum-release-age-strict')),
        ignoreMissingTimeExplicit: toBoolean(read('minimumReleaseAgeIgnoreMissingTime', 'minimum-release-age-ignore-missing-time')),
    };
}
function parseExcludeValue(value) {
    const entries = Array.isArray(value)
        ? value.map((entry) => String(entry))
        : typeof value === 'string'
            ? value.split(',')
            : [];
    return entries
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}
function toBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    return undefined;
}
/**
 * Reads pnpm's effective cooldown configuration once by asking pnpm itself
 * (`pnpm config list --json`) instead of re-implementing how it layers config
 * surfaces (a moving target across pnpm versions). The window and excludes come
 * straight from pnpm; the strict default, exclude grammar, and loose-fallback
 * semantics stay version-keyed because pnpm does not report those resolved
 * values.
 */
async function readPnpmPolicy(root, pmVersion) {
    // A pnpm major newer than the table knows can behave differently; defer to a
    // real install rather than guessing.
    if ((0, semver_1.gte)(pmVersion, '13.0.0')) {
        return {
            outcome: 'ambiguous',
            reason: `pnpm ${pmVersion} is newer than the known cooldown behavior table.`,
        };
    }
    const row = findBehaviorRow(pmVersion);
    if (!row) {
        return { outcome: 'inactive' };
    }
    const config = readPnpmConfigList(root);
    if (config === null) {
        // Could not read pnpm's resolved config; defer to a real install rather than
        // guess the policy.
        return {
            outcome: 'ambiguous',
            reason: 'Unable to read the pnpm minimum-release-age configuration.',
        };
    }
    const { windowMinutes: explicitWindow, excludes, strictExplicit, ignoreMissingTimeExplicit, } = parseCooldownConfig(config);
    // An explicitly configured window (from whatever surface pnpm honors) wins;
    // otherwise v11 and v12 fall back to the built-in 1440-minute (1 day) default,
    // while v10 has no default (no cooldown).
    let windowMinutes;
    let windowExplicit;
    if (explicitWindow !== undefined) {
        windowMinutes = explicitWindow;
        windowExplicit = true;
    }
    else if (row.major >= 11) {
        windowMinutes = 1440;
        windowExplicit = false;
    }
    else {
        return { outcome: 'inactive' };
    }
    // 0 disables; negatives push the cutoff into the future -> everything passes.
    if (windowMinutes <= 0) {
        return { outcome: 'inactive' };
    }
    const windowMs = windowMinutes * constants_1.MS_PER_MINUTE;
    const cutoffMs = Date.now() - windowMs;
    const sourceDescription = `pnpm minimumReleaseAge (${windowMinutes} min)`;
    const strict = resolveStrict(row, strictExplicit, windowExplicit);
    // v10 always errors on missing time; v11 and above default to skip unless a
    // surface explicitly disabled it.
    const ignoreMissingTime = row.major >= 11 ? (ignoreMissingTimeExplicit ?? true) : false;
    const behavior = {
        packageManager: 'pnpm',
        strict,
        // Loose fallback only exists from v11 onwards when strict is off.
        looseFallback: row.major >= 11 && !strict,
        writesExcludes: row.writesExcludes,
        missingTimeMap: row.major === 10 ? 'error' : ignoreMissingTime ? 'skip' : 'error',
    };
    const isExcluded = buildExcludeMatcher(excludes, row.excludeGrammar);
    if (isExcluded === null) {
        // An invalid exclude entry is a version-dependent landmine in pnpm; do not
        // mimic its crash, just defer.
        return {
            outcome: 'ambiguous',
            reason: 'Invalid pnpm minimumReleaseAgeExclude entry.',
        };
    }
    return {
        outcome: 'active',
        policy: {
            packageManagerVersion: pmVersion,
            cutoffMs,
            windowMs,
            sourceDescription,
            isExcluded,
            behavior,
        },
    };
}
function resolveStrict(row, strictExplicit, windowExplicit) {
    if (row.strictMode === 'always') {
        return true;
    }
    if (strictExplicit !== undefined) {
        return strictExplicit;
    }
    // >=11.0.4: an explicitly set window with no explicit strict flag turns
    // strict on. The invisible built-in 1440 default is NOT in explicitlySetKeys,
    // so it stays loose - the normal pnpm 11 state.
    return row.strictAutoOnWhenExplicit && windowExplicit;
}
function toNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') {
            return null;
        }
        const num = Number(trimmed);
        return Number.isFinite(num) ? num : null;
    }
    return null;
}
/**
 * Builds the exclude predicate matching pnpm's version-policy semantics.
 * Returns null when any entry is invalid (pnpm would error on it), so the
 * caller can defer to a real install rather than apply a partial policy.
 */
function buildExcludeMatcher(patterns, grammar) {
    if (patterns.length === 0) {
        return () => false;
    }
    if (grammar === 'v1-exact-names') {
        // 10.16-10.18: exact-name membership only; version specs are not matched
        // and invalid entries are silently ignored.
        const names = new Set(patterns);
        return (name) => names.has(name);
    }
    const rules = [];
    for (const pattern of patterns) {
        const parsed = parseVersionPolicyRule(pattern);
        if (parsed === null) {
            return null;
        }
        rules.push({
            matchesName: createNameMatcher(parsed.packageName),
            exactVersions: parsed.exactVersions,
        });
    }
    return (name, version) => {
        for (const rule of rules) {
            if (!rule.matchesName(name)) {
                continue;
            }
            if (rule.exactVersions.length === 0) {
                return true;
            }
            return rule.exactVersions.includes(version);
        }
        return false;
    };
}
// Mirrors @pnpm/config.version-policy parseVersionPolicyRule. Returns null for
// invalid entries (invalid version union / name pattern with version union).
function parseVersionPolicyRule(pattern) {
    const { name: packageName, versionPart } = (0, pick_1.splitPackageDescriptor)(pattern);
    if (versionPart === null) {
        return { packageName, exactVersions: [] };
    }
    const exactVersions = [];
    for (const versionRaw of versionPart.split('||')) {
        const version = (0, semver_1.valid)(versionRaw);
        if (version === null) {
            // ERR_PNPM_INVALID_VERSION_UNION.
            return null;
        }
        exactVersions.push(version);
    }
    if (packageName.includes('*')) {
        // ERR_PNPM_NAME_PATTERN_IN_VERSION_UNION.
        return null;
    }
    return { packageName, exactVersions };
}
// Mirrors @pnpm/config.matcher for a single pattern: '*' anywhere becomes
// '.*', '!' prefix negates, otherwise exact (case-sensitive) equality.
function createNameMatcher(pattern) {
    if (pattern.startsWith('!')) {
        const inner = createNameMatcher(pattern.slice(1));
        return (name) => !inner(name);
    }
    if (pattern === '*') {
        return () => true;
    }
    const escaped = escapeRegExp(pattern).replace(/\\\*/g, '.*');
    if (escaped === pattern) {
        return (name) => name === pattern;
    }
    const regexp = new RegExp(`^${escaped}$`);
    return (name) => regexp.test(name);
}
function escapeRegExp(value) {
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
}
// --- pick -------------------------------------------------------------------
/**
 * pnpm resolution under an active cooldown. Exact pins and ranges mirror pnpm's
 * resolver; dist-tag degrade uses the shared cross-PM rule:
 * - exact pin too new -> strict/v10 violation; v11 loose installs it (immature).
 * - range -> newest mature; none -> v10/strict violation, v11 loose lowest
 *   (least-immature) version unfiltered (immature).
 * - dist-tag too new -> degrade via the shared channel-aware rule (see
 *   `degradeTagToCompliant` for the ordering); none compliant -> violation
 *   (v11 loose installs the original target immature).
 */
function pickPnpmVersion(spec, metadata, policy) {
    const behavior = policy.behavior;
    if (behavior.packageManager !== 'pnpm') {
        throw new Error('pickPnpmVersion received a non-pnpm policy.');
    }
    const wholeMapMissing = metadata.time === null;
    if (wholeMapMissing && behavior.missingTimeMap === 'error') {
        throw missingTime(metadata, policy);
    }
    const type = (0, pick_1.classifySpec)(spec);
    if (type === 'exact') {
        return pickExact(spec, metadata, policy, behavior);
    }
    if (type === 'tag') {
        return pickTag(spec, metadata, policy, behavior);
    }
    return pickRange(spec, metadata, policy, behavior, (0, pick_1.newestInRange)(metadata, spec));
}
function pickExact(spec, metadata, policy, behavior) {
    const unconstrained = spec;
    if (mature(metadata, policy, spec, behavior)) {
        return { version: spec, unconstrained };
    }
    if (behavior.looseFallback) {
        // v11 loose installs the pin anyway and records it as immature.
        return { version: spec, unconstrained, immature: true };
    }
    throw violation(metadata, policy, spec, 'exact', [spec]);
}
function pickTag(spec, metadata, policy, behavior) {
    const tagTarget = metadata.distTags[spec];
    if (!tagTarget) {
        throw violation(metadata, policy, spec, 'tag', []);
    }
    const unconstrained = tagTarget;
    if (mature(metadata, policy, tagTarget, behavior)) {
        return { version: tagTarget, unconstrained };
    }
    const degraded = (0, pick_1.degradeTagToCompliant)(tagTarget, metadata, (v) => mature(metadata, policy, v, behavior));
    if (degraded) {
        return { version: degraded, unconstrained };
    }
    // The loose fallback requires a real version: a non-semver tag target must
    // not be installed immature, or the consumer would write `pkg@<garbage>`
    // into minimumReleaseAgeExclude and break every later install
    // (ERR_PNPM_INVALID_VERSION_UNION).
    if (behavior.looseFallback && (0, semver_1.valid)(tagTarget)) {
        // No compliant candidate; loose keeps the original (immature) target.
        return { version: tagTarget, unconstrained, immature: true };
    }
    throw violation(metadata, policy, spec, 'tag', [tagTarget]);
}
function pickRange(spec, metadata, policy, behavior, unconstrained) {
    const matureInRange = matureVersions(metadata, policy, behavior);
    const newest = (0, semver_1.maxSatisfying)(matureInRange, spec, {
        includePrerelease: false,
    });
    if (newest) {
        return { version: newest, unconstrained };
    }
    if (behavior.looseFallback) {
        // pnpm v11 loose falls back to the LOWEST version in range, unfiltered.
        const lowest = (0, semver_1.minSatisfying)(metadata.versions, spec, {
            includePrerelease: false,
        });
        if (lowest) {
            return {
                version: lowest,
                unconstrained,
                immature: true,
            };
        }
    }
    const blocked = metadata.versions
        .filter((v) => (0, semver_1.satisfies)(v, spec, { includePrerelease: false }))
        .sort(semver_1.rcompare);
    throw violation(metadata, policy, spec, 'range', blocked);
}
function matureVersions(metadata, policy, behavior) {
    return metadata.versions.filter((v) => mature(metadata, policy, v, behavior));
}
// pnpm blocks a version whose individual time entry is missing (treated too
// new). The whole-map-missing skip case is handled before any pick.
function mature(metadata, policy, version, behavior) {
    if (policy.isExcluded(metadata.name, version)) {
        return true;
    }
    if (metadata.time === null) {
        // Whole map missing reached here only with missingTimeMap 'skip' -> gate
        // is effectively off for this package.
        return true;
    }
    const time = metadata.time[version];
    if (!time) {
        return false;
    }
    return Date.parse(time) <= policy.cutoffMs;
}
// --- errors -----------------------------------------------------------------
function violation(metadata, policy, spec, type, blockedVersions) {
    return new errors_1.MinReleaseAgeViolationError({
        packageManager: 'pnpm',
        packageName: metadata.name,
        spec,
        pmShapedDetail: violationDetail(metadata, policy, spec, type, blockedVersions),
        blocked: (0, pick_1.blockedVersionsFrom)(metadata, blockedVersions),
        remediation: [
            `Add ${metadata.name} (optionally with a version) to minimumReleaseAgeExclude in pnpm-workspace.yaml, wait for a matching version to age past the window, or lower ${policy.sourceDescription}.`,
        ],
    });
}
// Per pnpm version (source-verified against npm-resolver/index.ts and
// installing/commands/policyHandlers.ts):
// - v10: always NO_MATCHING.
// - 11.0.0..11.1.2: range/exact emit the single-version NO_MATURE form;
//   tags can't derive an immatureVersion from a tag name, so they fall back to
//   NO_MATCHING.
// - >=11.1.3: strict install fails via failOnImmature with the multi-entry
//   list form.
function violationDetail(metadata, policy, spec, type, blockedVersions) {
    const version = policy.packageManagerVersion;
    if (!(0, semver_1.gte)(version, '11.0.0')) {
        return noMatchingDetail(metadata, spec);
    }
    if ((0, semver_1.gte)(version, '11.1.3')) {
        return failOnImmatureDetail(metadata, policy, spec, type, blockedVersions);
    }
    if (type === 'tag') {
        return noMatchingDetail(metadata, spec);
    }
    return noMatureSingleDetail(metadata, spec, blockedVersions);
}
// ERR_PNPM_NO_MATCHING_VERSION headline (10.x always; v11 fallback).
function noMatchingDetail(metadata, spec) {
    return `No matching version found for ${metadata.name}@${spec} while fetching it from the registry`;
}
// 11.0.0..11.1.2 single-version NO_MATURE form (NoMatchingVersionError).
function noMatureSingleDetail(metadata, spec, blockedVersions) {
    const newest = blockedVersions[0];
    const time = newest ? metadata.time?.[newest] : undefined;
    const ago = time ? formatTimeAgo(Date.parse(time)) : null;
    // pnpm emits the NO_MATURE message only with an immature pick that has a
    // known publish time; otherwise it falls back to NO_MATCHING.
    if (!newest || !ago) {
        return noMatchingDetail(metadata, spec);
    }
    return `Version ${newest} (released ${ago}) of ${metadata.name} does not meet the minimumReleaseAge constraint`;
}
// >=11.1.3 failOnImmature list form. failOnImmature lists the picks the resolver
// actually selected, one per resolution; resolving a single nx package yields a
// single immature pick. Each entry's reason mirrors detectMinReleaseAgeViolation
// (published-at ISO + cutoff ISO). For a range the resolver loose-picks the
// lowest in-range version; exact/tag carry their single target.
function failOnImmatureDetail(metadata, policy, spec, type, blockedVersions) {
    const resolved = type === 'range'
        ? blockedVersions[blockedVersions.length - 1]
        : blockedVersions[0];
    const publishedAt = resolved ? metadata.time?.[resolved] : undefined;
    if (!resolved || !publishedAt) {
        return noMatchingDetail(metadata, spec);
    }
    const cutoffIso = new Date(policy.cutoffMs).toISOString();
    const publishedIso = new Date(publishedAt).toISOString();
    return ('1 version does not meet the minimumReleaseAge constraint:\n' +
        `  ${metadata.name}@${resolved} was published at ${publishedIso}, within the minimumReleaseAge cutoff (${cutoffIso})`);
}
function missingTime(metadata, policy) {
    return new errors_1.MinReleaseAgeViolationError({
        packageManager: 'pnpm',
        packageName: metadata.name,
        spec: '',
        pmShapedDetail: `The metadata of ${metadata.name} is missing the "time" field`,
        blocked: [],
        remediation: [
            `Set minimumReleaseAgeIgnoreMissingTime to true, or use a registry that serves package publish times.`,
        ],
    });
}
// Mirrors pnpm v11's formatTimeAgo buckets exactly (npm-resolver): 'just now'
// under a minute (and for future dates), days at >=48h, hours at >=90min.
function formatTimeAgo(ts) {
    if (Number.isNaN(ts)) {
        return null;
    }
    const diffMs = Date.now() - ts;
    if (diffMs < constants_1.MS_PER_MINUTE) {
        return 'just now';
    }
    const diffMin = Math.floor(diffMs / constants_1.MS_PER_MINUTE);
    const diffHour = Math.floor(diffMs / (60 * constants_1.MS_PER_MINUTE));
    const diffDay = Math.floor(diffMs / constants_1.MS_PER_DAY);
    if (diffHour >= 48)
        return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
    if (diffMin >= 90)
        return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
    return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
}
