"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MinReleaseAgeViolationError = void 0;
/**
 * Raised when the user's package manager, at its detected version, would refuse
 * to resolve a version because it falls inside the minimum-release-age window.
 * Carries the PM-shaped detail and the blocked candidates so the migrate layer
 * can surface a friendly message or a PM-specific prompt.
 */
class MinReleaseAgeViolationError extends Error {
    constructor(opts) {
        super(opts.pmShapedDetail);
        this.name = 'MinReleaseAgeViolationError';
        this.packageManager = opts.packageManager;
        this.packageName = opts.packageName;
        this.spec = opts.spec;
        this.pmShapedDetail = opts.pmShapedDetail;
        this.blocked = opts.blocked;
        this.remediation = opts.remediation;
    }
}
exports.MinReleaseAgeViolationError = MinReleaseAgeViolationError;
