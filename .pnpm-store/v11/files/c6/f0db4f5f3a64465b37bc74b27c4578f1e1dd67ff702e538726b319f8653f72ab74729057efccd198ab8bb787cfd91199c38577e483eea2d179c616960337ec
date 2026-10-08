"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifySpec = classifySpec;
exports.splitPackageDescriptor = splitPackageDescriptor;
exports.isVersionMature = isVersionMature;
exports.newestInRange = newestInRange;
exports.degradeTagToCompliant = degradeTagToCompliant;
exports.blockedVersionsFrom = blockedVersionsFrom;
exports.pickMinReleaseAgeCompliantVersion = pickMinReleaseAgeCompliantVersion;
const semver_1 = require("semver");
const bun_1 = require("./behavior/bun");
const npm_1 = require("./behavior/npm");
const pnpm_1 = require("./behavior/pnpm");
const yarn_1 = require("./behavior/yarn");
/**
 * Classifies a version spec the way the package managers do: an exact semver is
 * a pin, a valid range is a range, anything else (latest, hot, canary, ...) is
 * a dist-tag. Catalog refs are dereferenced before this layer.
 */
function classifySpec(spec) {
    if ((0, semver_1.valid)(spec)) {
        return 'exact';
    }
    if ((0, semver_1.validRange)(spec)) {
        return 'range';
    }
    return 'tag';
}
/**
 * Splits an npm package descriptor into its name and the raw version part after
 * the separating `@`, honoring scoped names where the leading `@` is part of the
 * name. `versionPart` is null when there is no separator (bare name) and an
 * empty string for a trailing `@`; callers interpret the version part.
 */
function splitPackageDescriptor(entry) {
    const scoped = entry.startsWith('@');
    const at = entry.indexOf('@', scoped ? 1 : 0);
    if (at === -1) {
        return { name: entry, versionPart: null };
    }
    return { name: entry.slice(0, at), versionPart: entry.slice(at + 1) };
}
/**
 * Shared maturity test: a version passes when its publish time is at or before
 * the cutoff (inclusive), or when it is explicitly excluded.
 */
function isVersionMature(name, version, metadata, policy) {
    if (policy.isExcluded(name, version)) {
        return true;
    }
    const time = metadata.time?.[version];
    if (!time) {
        // Missing individual time: callers that diverge (pnpm blocks, yarn
        // quarantines) handle it themselves; the default is to pass like npm/bun.
        return true;
    }
    return Date.parse(time) <= policy.cutoffMs;
}
/**
 * Newest version satisfying the range, ignoring the cooldown gate. Used only to
 * compute PickOutcome.unconstrained (messaging); never gates a pick. Falls back
 * to the raw range when nothing matches.
 */
function newestInRange(metadata, range) {
    return (metadata.versions
        .filter((v) => (0, semver_1.satisfies)(v, range, { includePrerelease: false }))
        .sort(semver_1.rcompare)[0] ?? range);
}
/**
 * The prerelease channel of a version: the first dotted identifier of its
 * prerelease tag (e.g. `rc` for `23.0.0-rc.0`, `pr` for `23.0.0-pr.123`), or
 * null for a stable release. Channels keep parallel prerelease lines apart so a
 * cooldown degrade never crosses from `rc` into an internal `pr` build.
 */
function prereleaseChannel(version) {
    const pre = (0, semver_1.prerelease)(version);
    return pre && pre.length > 0 ? String(pre[0]) : null;
}
// The stable `major.minor.patch` of a version, ignoring any prerelease tag
// (e.g. `23.0.0` for both `23.0.0-rc.0` and `23.0.0`).
function releaseLine(version) {
    const parsed = (0, semver_1.parse)(version);
    return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : version;
}
// Publish time in epoch ms; a version with no registry time sorts last.
function publishedAtMs(metadata, version) {
    const time = metadata.time?.[version];
    const parsed = time ? Date.parse(time) : NaN;
    return Number.isNaN(parsed) ? -Infinity : parsed;
}
// Prerelease channels with a conventional maturity order, least mature first.
// A blocked target may descend to a lower rung of its own release line
// (rc.0 -> beta.x); channels off the ladder (pr, canary, ...) have no implied
// ordering and stay walled off. `next` is deliberately omitted: it is pre-rc
// in some ecosystems (Angular) but a rolling dev snapshot in others - exactly
// the kind of build a degrade must never land on.
const ORDERED_CHANNELS = ['alpha', 'beta', 'rc'];
// Whether a prerelease channel may serve as a degrade candidate for a target
// on `targetChannel`: the target's own channel always; a strictly lower rung
// when both sit on the ladder. A stable target (null channel) admits none.
function channelAdmits(targetChannel, channel) {
    if (channel === targetChannel) {
        return true;
    }
    if (targetChannel === null) {
        return false;
    }
    const rank = ORDERED_CHANNELS.indexOf(channel);
    const targetRank = ORDERED_CHANNELS.indexOf(targetChannel);
    return rank !== -1 && targetRank !== -1 && rank < targetRank;
}
/**
 * Degrades a too-new dist-tag target to a cooldown-compliant version "of the
 * same kind", shared by every package manager.
 *
 * The candidate pool is every version at or below the resolved target that is
 * stable, in the target's prerelease channel, or on a lower rung of the
 * channel ladder (alpha < beta < rc). It is ordered so that prereleases of
 * the target's exact release line come first - own channel, then lower rungs -
 * then everything else; within each group the most recently published version
 * comes first (semver breaks ties and orders versions with no publish time).
 * The first compliant version in that order wins.
 *
 * So a stable target degrades to the newest compliant stable, and a prerelease
 * target keeps a compliant prerelease of the release it points at when one
 * exists (an rc may fall to a same-line beta), otherwise drops to the newest
 * compliant version below it - never crossing into a channel with no place on
 * the ladder (e.g. an internal `pr` build) and never climbing up it. Returns
 * null when nothing in the pool is compliant; callers turn that into their
 * package manager's violation.
 *
 * `isCompliant` is the caller's per-PM maturity test (package managers differ
 * on missing publish times and excludes).
 */
function degradeTagToCompliant(target, metadata, isCompliant) {
    // semver.compare throws on a non-semver string; a tag pointing at one has no
    // channel or ordering to reason about, so report no candidate and let the
    // caller raise its violation.
    if (!(0, semver_1.valid)(target)) {
        return null;
    }
    const targetChannel = prereleaseChannel(target);
    const targetLine = releaseLine(target);
    const pool = metadata.versions.filter((version) => {
        if (!(0, semver_1.valid)(version) || (0, semver_1.compare)(version, target) > 0) {
            return false; // unparseable or newer than the target
        }
        const channel = prereleaseChannel(version);
        // Stables always stay; a prerelease stays only in the target's channel or
        // on a lower ladder rung (every prerelease is out for a stable target).
        return channel === null || channelAdmits(targetChannel, channel);
    });
    // Prereleases of the target's exact release line rank ahead of the rest -
    // own channel before lower rungs - then everything else; within each tier,
    // newest published first.
    const tier = (version) => {
        if (releaseLine(version) !== targetLine) {
            return 2;
        }
        const channel = prereleaseChannel(version);
        if (channel === targetChannel) {
            return 0;
        }
        return channel === null ? 2 : 1;
    };
    pool.sort((a, b) => {
        const tierDelta = tier(a) - tier(b);
        if (tierDelta !== 0) {
            return tierDelta;
        }
        const publishedA = publishedAtMs(metadata, a);
        const publishedB = publishedAtMs(metadata, b);
        if (publishedA !== publishedB) {
            return publishedB - publishedA;
        }
        return (0, semver_1.compare)(b, a);
    });
    return pool.find((version) => isCompliant(version)) ?? null;
}
/**
 * Maps a list of held-back versions to the blocked-candidate shape carried by
 * MinReleaseAgeViolationError, keeping only versions the registry has a publish
 * time for.
 */
function blockedVersionsFrom(metadata, versions) {
    return versions
        .filter((v) => !!metadata.time?.[v])
        .map((v) => ({ version: v, publishedAt: metadata.time[v] }));
}
/**
 * Resolves a spec to a version that complies with the effective cooldown
 * policy, dispatching to the per-PM pick rules. Throws
 * MinReleaseAgeViolationError when the PM at this version would fail.
 */
function pickMinReleaseAgeCompliantVersion(spec, metadata, policy) {
    switch (policy.behavior.packageManager) {
        case 'npm':
            return (0, npm_1.pickNpmVersion)(spec, metadata, policy);
        case 'pnpm':
            return (0, pnpm_1.pickPnpmVersion)(spec, metadata, policy);
        case 'yarn':
            return (0, yarn_1.pickYarnVersion)(spec, metadata, policy);
        case 'bun':
            return (0, bun_1.pickBunVersion)(spec, metadata, policy);
    }
}
