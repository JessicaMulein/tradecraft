"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readNpmPolicy = readNpmPolicy;
exports.pickNpmVersion = pickNpmVersion;
const child_process_1 = require("child_process");
const os_1 = require("os");
const path_1 = require("path");
const semver_1 = require("semver");
const constants_1 = require("../constants");
const errors_1 = require("../errors");
const npmrc_1 = require("../../package-manager-config/npmrc");
const pick_1 = require("../pick");
const RANK_UNKNOWN = 0; // global/builtin/default - not detectable here
const RANK_USER = 1;
const RANK_PROJECT = 2;
const RANK_ENV = 3;
/**
 * Reads npm's merged effective config (project + user + global + builtin npmrc
 * plus npm_config_* env) by spawning `npm config list --json` once at the
 * workspace root, then derives the cooldown cutoff from `min-release-age`
 * (days) and `before` (absolute date).
 */
async function readNpmPolicy(root, pmVersion, env = process.env) {
    let config;
    try {
        const raw = (0, child_process_1.execSync)('npm config list --json', {
            cwd: root,
            encoding: 'utf-8',
            windowsHide: true,
        });
        config = JSON.parse(raw);
    }
    catch {
        return {
            outcome: 'ambiguous',
            reason: 'Unable to read the effective npm configuration.',
        };
    }
    const mraRaw = config['min-release-age'];
    const beforeRaw = config['before'];
    const hasMra = mraRaw !== undefined && mraRaw !== null;
    const hasBefore = beforeRaw !== undefined && beforeRaw !== null;
    if (hasMra && hasBefore) {
        // 11.10-11.14 has no per-source guard and npm itself can TypeError when a
        // git: dep is involved, so we don't try to mimic it.
        if (!(0, semver_1.gte)(pmVersion, '11.15.0')) {
            return {
                outcome: 'ambiguous',
                reason: 'Both min-release-age and before are set; npm 11.10-11.14 may error.',
            };
        }
        // 11.15+ resolves the two keys by emulating npm's per-source flatten
        // (before wins within a source; normal precedence wins across sources).
        return resolveBothKeys(mraRaw, beforeRaw, pmVersion, root, env);
    }
    if (hasBefore) {
        return buildPolicyFromBefore(beforeRaw, pmVersion);
    }
    if (hasMra) {
        return buildPolicyFromMinReleaseAge(mraRaw, pmVersion);
    }
    return { outcome: 'inactive' };
}
/**
 * Emulates npm 11.15+ config flatten for the case where both `min-release-age`
 * and `before` resolve to a value. npm iterates config sources from lowest to
 * highest precedence, each overwriting the flat `before`. Within one source,
 * `before` wins (the `Object.hasOwn(obj, 'before')` guard skips the
 * min-release-age flatten); across sources, the highest-precedence source's
 * contribution wins.
 */
function resolveBothKeys(mraRaw, beforeRaw, pmVersion, root, env) {
    const surfaces = detectSurfaces(root, env);
    // Highest detected rank per key; the merged values already reflect npm's
    // per-key precedence, so we only need to know which key's source wins.
    const mraRank = surfaces.minReleaseAge ?? RANK_UNKNOWN;
    const beforeRank = surfaces.before ?? RANK_UNKNOWN;
    // Same source carries both keys -> before wins there (hasOwn guard). When the
    // before source ranks at least as high as the min-release-age source, before
    // is the last writer; otherwise min-release-age overwrites a lower-ranked
    // before.
    if (beforeRank >= mraRank) {
        return buildPolicyFromBefore(beforeRaw, pmVersion);
    }
    return buildPolicyFromMinReleaseAge(mraRaw, pmVersion);
}
// Detects which config surface(s) set each cooldown key, ranked by npm's
// precedence. Only env + project/user .npmrc are observable here; global,
// builtin, and default sources fall into RANK_UNKNOWN.
function detectSurfaces(root, env) {
    const result = {};
    const note = (key, rank) => {
        const current = result[key];
        if (current === undefined || rank > current) {
            result[key] = rank;
        }
    };
    const userNpmrc = readNpmrcKeys(env['npm_config_userconfig'] ?? env['NPM_CONFIG_USERCONFIG'], (0, path_1.join)((0, os_1.homedir)(), '.npmrc'));
    if (userNpmrc.minReleaseAge)
        note('minReleaseAge', RANK_USER);
    if (userNpmrc.before)
        note('before', RANK_USER);
    const projectNpmrc = readNpmrcKeys(undefined, (0, path_1.join)(root, '.npmrc'));
    if (projectNpmrc.minReleaseAge)
        note('minReleaseAge', RANK_PROJECT);
    if (projectNpmrc.before)
        note('before', RANK_PROJECT);
    // npm matches npm_config_* case-insensitively; replaces non-leading _ with -.
    if (readEnvKey(env, 'min-release-age') !== undefined) {
        note('minReleaseAge', RANK_ENV);
    }
    if (readEnvKey(env, 'before') !== undefined) {
        note('before', RANK_ENV);
    }
    return result;
}
function readNpmrcKeys(override, fallback) {
    const present = { minReleaseAge: false, before: false };
    // npm silently treats an .npmrc it cannot read as absent, so both non-array
    // states scan nothing.
    const entries = (0, npmrc_1.readNpmrcEntries)(override ?? fallback);
    for (const { key } of Array.isArray(entries) ? entries : []) {
        if (key === 'min-release-age') {
            present.minReleaseAge = true;
        }
        else if (key === 'before') {
            present.before = true;
        }
    }
    return present;
}
// npm's loadEnv strips the npm_config_ prefix (case-insensitive), then
// normalizes the rest with `key.replace(/(?!^)_/g, '-').toLowerCase()`, so both
// npm_config_min_release_age and npm_config_min-release-age map to the kebab key.
function readEnvKey(env, kebabKey) {
    for (const [name, value] of Object.entries(env)) {
        if (value === undefined || value === '') {
            continue;
        }
        if (!/^npm_config_/i.test(name)) {
            continue;
        }
        const normalized = name
            .slice('npm_config_'.length)
            .replace(/(?!^)_/g, '-')
            .toLowerCase();
        if (normalized === kebabKey) {
            return value;
        }
    }
    return undefined;
}
function buildPolicyFromMinReleaseAge(mraRaw, pmVersion) {
    const days = typeof mraRaw === 'number' ? mraRaw : Number(mraRaw);
    if (!Number.isFinite(days)) {
        return {
            outcome: 'ambiguous',
            reason: `Invalid npm min-release-age value: ${String(mraRaw)}.`,
        };
    }
    // 0 disables (11.15+) or sets cutoff=now (11.10-11.14, everything published
    // passes); negative pushes the cutoff into the future. Both are inert.
    if (days <= 0) {
        return { outcome: 'inactive' };
    }
    const windowMs = days * constants_1.MS_PER_DAY;
    const cutoffMs = Date.now() - windowMs;
    return {
        outcome: 'active',
        policy: createNpmPolicy({
            pmVersion,
            cutoffMs,
            windowMs,
            sourceDescription: `npm min-release-age (${days} day${days === 1 ? '' : 's'})`,
        }),
    };
}
function buildPolicyFromBefore(beforeRaw, pmVersion) {
    const cutoffMs = Date.parse(String(beforeRaw));
    if (Number.isNaN(cutoffMs)) {
        return {
            outcome: 'ambiguous',
            reason: `Invalid npm before value: ${String(beforeRaw)}.`,
        };
    }
    const windowMs = Date.now() - cutoffMs;
    // before in the future -> every published version passes; nothing to gate.
    if (windowMs <= 0) {
        return { outcome: 'inactive' };
    }
    return {
        outcome: 'active',
        policy: createNpmPolicy({
            pmVersion,
            cutoffMs,
            windowMs,
            sourceDescription: `npm before (${new Date(cutoffMs).toISOString()})`,
        }),
    };
}
function createNpmPolicy(opts) {
    return {
        packageManagerVersion: opts.pmVersion,
        cutoffMs: opts.cutoffMs,
        windowMs: opts.windowMs,
        sourceDescription: opts.sourceDescription,
        // npm has no excludes surface.
        isExcluded: () => false,
        behavior: { packageManager: 'npm' },
    };
}
/**
 * npm resolution under an active `before` filter. Exact pins and ranges mirror
 * npm-pick-manifest@11.0.3; dist-tag degrade uses the shared cross-PM rule:
 * - exact pin too new -> ETARGET (no fallback).
 * - unknown dist-tag -> ETARGET (no version to resolve against).
 * - dist-tag too new -> degrade via the shared channel-aware rule (see
 *   `degradeTagToCompliant` for the ordering); none compliant -> ENOVERSIONS.
 * - range -> filter every version by maturity FIRST; empty -> ENOVERSIONS;
 *   else newest in-range survivor; survivors but none in range -> ETARGET.
 */
function pickNpmVersion(spec, metadata, policy) {
    const type = (0, pick_1.classifySpec)(spec);
    if (type === 'exact') {
        const unconstrained = spec;
        // npm-pick-manifest resolves `mani = versions[ver]` -> undefined for an
        // unpublished pin and throws ETARGET. `versions` is the sole source of
        // truth: an unpublished version lingers in the `time` map but is gone from
        // `versions`, so a `time` entry alone must not make it resolvable.
        const exists = metadata.versions.includes(spec);
        if (exists && (0, pick_1.isVersionMature)(metadata.name, spec, metadata, policy)) {
            return { version: spec, unconstrained };
        }
        throw etarget(metadata, policy, spec, [spec]);
    }
    if (type === 'tag') {
        const tagTarget = metadata.distTags[spec];
        if (!tagTarget) {
            // npm-pick-manifest returns undefined for an unknown tag (no dist-tag
            // entry, no version), then throws ETARGET - not ENOVERSIONS.
            throw etarget(metadata, policy, spec, []);
        }
        const unconstrained = tagTarget;
        if ((0, pick_1.isVersionMature)(metadata.name, tagTarget, metadata, policy)) {
            return { version: tagTarget, unconstrained };
        }
        const degraded = (0, pick_1.degradeTagToCompliant)(tagTarget, metadata, (v) => (0, pick_1.isVersionMature)(metadata.name, v, metadata, policy));
        if (degraded) {
            return { version: degraded, unconstrained };
        }
        throw enoVersions(metadata, policy, spec);
    }
    return pickRange(metadata, policy, spec, spec, (0, pick_1.newestInRange)(metadata, spec));
}
function pickRange(metadata, policy, range, reportedSpec, unconstrained) {
    const mature = metadata.versions.filter((v) => (0, pick_1.isVersionMature)(metadata.name, v, metadata, policy));
    // npm throws ENOVERSIONS when the date filter leaves nothing at all.
    if (mature.length === 0) {
        throw enoVersions(metadata, policy, reportedSpec);
    }
    const inRange = mature
        .filter((v) => (0, semver_1.satisfies)(v, range, { includePrerelease: false }))
        .sort(semver_1.rcompare);
    if (inRange.length === 0) {
        const blocked = metadata.versions
            .filter((v) => (0, semver_1.satisfies)(v, range, { includePrerelease: false }))
            .sort(semver_1.rcompare);
        throw etarget(metadata, policy, reportedSpec, blocked);
    }
    return { version: inRange[0], unconstrained };
}
function etarget(metadata, policy, spec, blockedVersions) {
    const beforeStr = new Date(policy.cutoffMs).toLocaleString();
    return new errors_1.MinReleaseAgeViolationError({
        packageManager: 'npm',
        packageName: metadata.name,
        spec,
        pmShapedDetail: `No matching version found for ${metadata.name}@${spec} with a date before ${beforeStr}.`,
        blocked: (0, pick_1.blockedVersionsFrom)(metadata, blockedVersions),
        remediation: [
            `Wait until a matching version is older than the configured window, or lower ${policy.sourceDescription}.`,
        ],
    });
}
function enoVersions(metadata, policy, spec) {
    return new errors_1.MinReleaseAgeViolationError({
        packageManager: 'npm',
        packageName: metadata.name,
        spec,
        pmShapedDetail: `No versions available for ${metadata.name}`,
        blocked: (0, pick_1.blockedVersionsFrom)(metadata, metadata.versions),
        remediation: [
            `Wait until a version is older than the configured window, or lower ${policy.sourceDescription}.`,
        ],
    });
}
