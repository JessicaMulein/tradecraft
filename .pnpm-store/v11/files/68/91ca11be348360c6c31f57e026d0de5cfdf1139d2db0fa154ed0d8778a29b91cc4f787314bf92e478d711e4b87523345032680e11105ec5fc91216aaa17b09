"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRegistryMetadata = fetchRegistryMetadata;
const package_manager_1 = require("../package-manager");
// `npm view <pkg> --json` collapses single-element fields to scalars.
function toArray(value) {
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}
/**
 * Fetches the full packument for a package and normalizes the quirks of
 * `npm view --json`: `versions` may be a scalar when a single version exists,
 * `time` may be absent (third-party registries) and is exposed as null,
 * `dist-tags` carries a hyphen.
 */
async function fetchRegistryMetadata(pkg) {
    const raw = await (0, package_manager_1.packageRegistryView)(pkg, '', ['--json']);
    const parsed = JSON.parse(raw);
    const time = parsed.time ?? null;
    if (time) {
        // The time map carries 'created'/'modified' alongside versions; they are
        // harmless to keep but never referenced as versions.
        delete time.created;
        delete time.modified;
    }
    return {
        name: parsed.name ?? pkg,
        versions: toArray(parsed.versions),
        time,
        distTags: parsed['dist-tags'] ?? {},
    };
}
