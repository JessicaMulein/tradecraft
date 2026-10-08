"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCompliantVersion = resolveCompliantVersion;
const packument_1 = require("./packument");
const pick_1 = require("./pick");
/**
 * Resolves an already catalog-dereferenced spec to a cooldown-compliant version
 * under the given policy: fetches the packument, then picks. Throws
 * MinReleaseAgeViolationError when the PM at this version would refuse to resolve.
 */
async function resolveCompliantVersion(packageName, spec, policy) {
    const metadata = await (0, packument_1.fetchRegistryMetadata)(packageName);
    return (0, pick_1.pickMinReleaseAgeCompliantVersion)(spec, metadata, policy);
}
