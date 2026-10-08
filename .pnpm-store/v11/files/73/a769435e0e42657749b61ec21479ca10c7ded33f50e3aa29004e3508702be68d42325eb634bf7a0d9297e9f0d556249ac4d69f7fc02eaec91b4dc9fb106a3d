"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBunPolicy = readBunPolicy;
exports.pickBunVersion = pickBunVersion;
const path_1 = require("path");
const semver_1 = require("semver");
const bunfig_1 = require("../../package-manager-config/bunfig");
const constants_1 = require("../constants");
const errors_1 = require("../errors");
const pick_1 = require("../pick");
const SEVEN_DAYS_MS = 7 * constants_1.MS_PER_DAY;
/**
 * Reads bun's cooldown config from bunfig.toml. nx mirrors only the surfaces
 * bun reads at resolution time in this context: the project `bunfig.toml` and
 * the global bunfig, which lives at `$XDG_CONFIG_HOME/.bunfig.toml` when
 * XDG_CONFIG_HOME is set and at `$HOME/.bunfig.toml` otherwise (verified
 * against bun's getHomeConfigPath). Local overrides global per key. No env,
 * no .npmrc, no CLI surface exists in this context.
 */
async function readBunPolicy(root, pmVersion) {
    let global;
    let local;
    try {
        global = readGlobalBunInstall();
        local = readLocalBunInstall(root);
    }
    catch {
        return {
            outcome: 'ambiguous',
            reason: 'Unable to read bunfig.toml.',
        };
    }
    if (global === 'error' || local === 'error') {
        // A non-number / negative value makes bun's config load fail (install
        // dies); we can't reason about the effective window, so defer to install.
        return {
            outcome: 'ambiguous',
            reason: 'Invalid minimumReleaseAge in bunfig.toml.',
        };
    }
    // Local overrides global per key.
    const ageRaw = local.minimumReleaseAge ?? global.minimumReleaseAge;
    const excludesRaw = local.minimumReleaseAgeExcludes ?? global.minimumReleaseAgeExcludes;
    if (ageRaw === undefined || ageRaw === null) {
        return { outcome: 'inactive' };
    }
    if (typeof ageRaw !== 'number' || !Number.isFinite(ageRaw)) {
        return {
            outcome: 'ambiguous',
            reason: `Invalid bun minimumReleaseAge value: ${String(ageRaw)}.`,
        };
    }
    if (ageRaw < 0) {
        // bun hard-errors on a negative window; install would die.
        return {
            outcome: 'ambiguous',
            reason: 'bun minimumReleaseAge must be a positive number of seconds.',
        };
    }
    if (ageRaw === 0) {
        // 0 disables the gate.
        return { outcome: 'inactive' };
    }
    const excludes = new Set(excludesRaw ?? []);
    const windowMs = ageRaw * constants_1.MS_PER_SECOND;
    const cutoffMs = Date.now() - windowMs;
    return {
        outcome: 'active',
        policy: {
            packageManagerVersion: pmVersion,
            cutoffMs,
            windowMs,
            sourceDescription: `bun minimumReleaseAge (${ageRaw} second${ageRaw === 1 ? '' : 's'})`,
            // Exact, case-sensitive byte equality on the package name only.
            isExcluded: (packageName) => excludes.has(packageName),
            behavior: { packageManager: 'bun' },
        },
    };
}
function readLocalBunInstall(root) {
    return readBunInstall((0, path_1.join)(root, 'bunfig.toml'));
}
function readGlobalBunInstall() {
    const base = (0, bunfig_1.getBunGlobalConfigBase)(process.env);
    if (!base) {
        return {};
    }
    return readBunInstall((0, path_1.join)(base, '.bunfig.toml'));
}
function readBunInstall(path) {
    const parsed = (0, bunfig_1.readBunfigRaw)(path);
    // bun skips a bunfig it cannot read and resolves on, so its settings do not
    // apply. Only a parse failure kills the install.
    if (parsed === null || parsed === 'unreadable') {
        return {};
    }
    if (parsed === 'invalid') {
        return 'error';
    }
    const install = parsed.install;
    if (typeof install !== 'object' || install === null) {
        return {};
    }
    const installObj = install;
    const result = {};
    if ('minimumReleaseAge' in installObj) {
        const value = installObj.minimumReleaseAge;
        // bun rejects a non-number value (config load fails); negative is rejected
        // too but we surface that uniformly in the reader for a clearer reason.
        if (typeof value !== 'number') {
            return 'error';
        }
        result.minimumReleaseAge = value;
    }
    if ('minimumReleaseAgeExcludes' in installObj) {
        const value = installObj.minimumReleaseAgeExcludes;
        // bun's bunfig parser hard-errors on a non-array, or any non-string element
        // (install dies); mirror that so the reader maps it to ambiguous.
        if (!Array.isArray(value) || value.some((e) => typeof e !== 'string')) {
            return 'error';
        }
        result.minimumReleaseAgeExcludes = value;
    }
    // The singular `minimumReleaseAgeExclude` key is never read by bun; ignore it.
    return result;
}
/**
 * bun resolution. Exact pins and ranges mirror bun's resolver
 * (find_best_version_with_filter, byte-identical 1.3.0 -> 1.3.14); dist-tag
 * degrade uses the shared cross-PM rule:
 * - exact pin too new -> hard error (TooRecentVersion), no fallback.
 * - range -> the `latest` dist-tag is checked first: in-range and age-passing ->
 *   return it immediately. Otherwise walk newest to oldest skipping age-blocked;
 *   the first age-passing candidate must also be stable (gap to the next-newer
 *   version >= min(window, 7d), inclusive); unstable -> keep walking but remember
 *   it; stop past `now - (window + 7d)`; no stable -> newest age-passing fallback.
 *   No in-range version at all -> err.not_found (a plain, non-cooldown error).
 * - dist-tag too new -> degrade via the shared channel-aware rule (see
 *   `degradeTagToCompliant` for the ordering); none compliant ->
 *   TooRecentVersion.
 * Missing/unparseable publish times are treated as timestamp 0 (always pass);
 * future timestamps are blocked.
 */
function pickBunVersion(spec, metadata, policy) {
    const type = (0, pick_1.classifySpec)(spec);
    if (type === 'exact') {
        if (passesGate(metadata, policy, spec)) {
            return { version: spec, unconstrained: spec };
        }
        throw tooRecent(metadata, policy, spec);
    }
    if (type === 'tag') {
        const target = metadata.distTags[spec];
        if (!target) {
            throw tooRecent(metadata, policy, spec);
        }
        if (passesGate(metadata, policy, target)) {
            return { version: target, unconstrained: target };
        }
        const degraded = (0, pick_1.degradeTagToCompliant)(target, metadata, (v) => passesGate(metadata, policy, v));
        if (degraded) {
            return { version: degraded, unconstrained: target };
        }
        throw tooRecent(metadata, policy, spec);
    }
    // bun splits its manifest into a stable `releases` list and a `prereleases`
    // list and only consults prereleases when the range itself carries a
    // prerelease comparator (npm.zig findBestVersionWithFilter, Group.Flags.pre).
    // Default node-semver semantics replicate that: a prerelease version is only
    // admitted when the range has a comparator with the same [major,minor,patch].
    const inRange = metadata.versions
        .filter((v) => (0, semver_1.satisfies)(v, spec))
        .sort(semver_1.rcompare);
    const unconstrained = inRange[0] ?? spec;
    // No in-range version at all is bun's err.not_found (NOT a cooldown error); a
    // plain Error lets the migrate install-fallback surface bun's NoMatchingVersion.
    if (inRange.length === 0) {
        throw new Error(`No matching version found for ${metadata.name}@${spec}.`);
    }
    // bun's findBestVersionWithFilter checks the `latest` dist-tag first: if it
    // satisfies the range and passes the gate, it returns immediately, before the
    // stability walk (npm.zig findBestVersionWithFilter, findByDistTag("latest")).
    const latest = metadata.distTags['latest'];
    if (latest &&
        (0, semver_1.satisfies)(latest, spec) &&
        passesGate(metadata, policy, latest)) {
        return { version: latest, unconstrained };
    }
    const picked = walkStability(metadata, policy, inRange, null);
    if (picked) {
        return { version: picked, unconstrained };
    }
    throw tooRecent(metadata, policy, spec);
}
/**
 * Walks `candidates` (already sorted newest-first) applying bun's stability
 * heuristic. `tagTarget`, when set, seeds the prior age-blocked version so the
 * gap is measured against the tag's resolved version. Returns the picked
 * version, or null when every candidate is blocked.
 */
function walkStability(metadata, policy, candidates, tagTarget) {
    const now = Date.now();
    const stabilityWindowMs = Math.min(policy.windowMs, SEVEN_DAYS_MS);
    const searchBoundMs = now - (policy.windowMs + SEVEN_DAYS_MS);
    let prevBlocked = tagTarget;
    let best = null;
    for (const version of candidates) {
        if (!passesGate(metadata, policy, version)) {
            prevBlocked = version;
            continue;
        }
        if (prevBlocked === null) {
            // Newest age-passing candidate with nothing newer blocked: take it.
            return version;
        }
        if (publishMs(metadata, version) < searchBoundMs) {
            // Past the search bound: stop and use the best age-passing version found.
            return best ?? version;
        }
        const stable = publishMs(metadata, prevBlocked) - publishMs(metadata, version) >=
            stabilityWindowMs;
        if (stable) {
            return version;
        }
        best ??= version;
        prevBlocked = version;
    }
    // No stable candidate: fall back to the newest age-passing version, if any.
    return best;
}
// A version passes when its publish time is at or before the cutoff
// (inclusive), or when it is excluded. Missing time -> timestamp 0 -> passes.
function passesGate(metadata, policy, version) {
    if (policy.isExcluded(metadata.name, version)) {
        return true;
    }
    return publishMs(metadata, version) <= policy.cutoffMs;
}
// Publish time in epoch ms; missing/unparseable -> 0 (bun's timestamp default).
function publishMs(metadata, version) {
    const time = metadata.time?.[version];
    if (!time) {
        return 0;
    }
    const parsed = Date.parse(time);
    return Number.isNaN(parsed) ? 0 : parsed;
}
function tooRecent(metadata, policy, spec) {
    const blocked = blockedCandidates(metadata, spec);
    return new errors_1.MinReleaseAgeViolationError({
        packageManager: 'bun',
        packageName: metadata.name,
        spec,
        pmShapedDetail: `${metadata.name}@${spec} was blocked by minimum-release-age (${policy.sourceDescription}).`,
        blocked,
        remediation: [
            `Add "${metadata.name}" to install.minimumReleaseAgeExcludes in bunfig.toml, or lower ${policy.sourceDescription}.`,
        ],
    });
}
function blockedCandidates(metadata, spec) {
    const matching = (0, semver_1.valid)(spec)
        ? [spec]
        : metadata.versions.filter((v) => {
            try {
                // Same release/prerelease split bun applies in its resolver.
                return (0, semver_1.satisfies)(v, spec);
            }
            catch {
                return false;
            }
        });
    return (0, pick_1.blockedVersionsFrom)(metadata, matching);
}
