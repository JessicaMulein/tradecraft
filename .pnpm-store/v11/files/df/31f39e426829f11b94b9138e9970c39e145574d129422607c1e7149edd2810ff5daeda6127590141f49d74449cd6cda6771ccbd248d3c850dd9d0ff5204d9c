"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveChangelogRenderer = resolveChangelogRenderer;
const register_1 = require("../../../plugins/js/utils/register");
const utils_1 = require("../../../tasks-runner/utils");
const workspace_root_1 = require("../../../utils/workspace-root");
function resolveChangelogRenderer(changelogRendererPathOrImplementation) {
    // An implementation was provided directly via the programmatic API
    if (typeof changelogRendererPathOrImplementation === 'function') {
        return changelogRendererPathOrImplementation;
    }
    const interpolatedChangelogRendererPath = (0, utils_1.interpolate)(changelogRendererPathOrImplementation, {
        workspaceRoot: workspace_root_1.workspaceRoot,
    });
    // TS renderers go through loadTsFile (native-strip -> swc/ts-node + paths).
    // JS renderers use require() with a lazy tsconfig-paths fallback so workspace
    // alias imports still resolve, without paying registration cost up front.
    const r = /\.[cm]?ts$/.test(interpolatedChangelogRendererPath)
        ? (0, register_1.loadTsFile)(interpolatedChangelogRendererPath)
        : (0, register_1.requireWithTsconfigFallback)(interpolatedChangelogRendererPath);
    return r.default || r;
}
