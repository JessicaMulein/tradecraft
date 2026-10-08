"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const metadata_1 = require("./metadata");
const completion_providers_1 = require("./completion-providers");
const project_graph_1 = require("../../project-graph/project-graph");
// `nx <target> <project>` infix completion. Every unique target name in
// the cached graph gets its own path; union with a conventional set so
// cold workspaces still get the everyday names.
//
// This file is imported LAST in registrations.ts so we can skip target
// names that collide with real Nx commands ('run', 'add', 'generate',
// ...). Otherwise a workspace that happens to have e.g. a `run` target
// would silently shadow the command-specific completer.
const CONVENTIONAL_TARGETS = [
    'build',
    'serve',
    'test',
    'lint',
    'e2e',
    'dev',
    'start',
    'preview',
    'typecheck',
];
const targetNames = new Set(CONVENTIONAL_TARGETS);
try {
    const graph = (0, project_graph_1.readCachedProjectGraph)();
    for (const node of Object.values(graph?.nodes ?? {})) {
        for (const t of Object.keys(node?.data?.targets ?? {})) {
            targetNames.add(t);
        }
    }
}
catch {
    // No cached graph — conventional set only.
}
const reserved = new Set((0, metadata_1.getRegisteredTopLevelPaths)());
for (const targetName of targetNames) {
    if (reserved.has(targetName))
        continue;
    (0, metadata_1.registerCompletion)(targetName, {
        positionals: [
            {
                complete: (current) => (0, completion_providers_1.getProjectNamesWithTarget)(current, targetName),
            },
        ],
    });
}
