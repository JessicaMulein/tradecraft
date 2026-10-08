/**
 * Import-boundary rules.
 *
 * The one that matters for the design is `tui-imports-only-player-view`: the
 * client must reach the simulation through the `player-view` facade, which
 * strips every truth-bearing field. Branded `Truth<T>` types stop truth leaking
 * at compile time; this rule stops the client reaching around the facade in the
 * first place (Requirements 2.2, 13.5).
 *
 * Workspace packages are resolved to their real paths, so the rule catches both
 * `@tradecraft/engine` and `../../engine/src/index.js`. An import that cannot be
 * resolved at all is caught by `not-to-unresolvable` instead.
 *
 * Run with `pnpm dep-cruise`. Violations exit non-zero so CI fails.
 */

/** Workspace packages the TUI is allowed to depend on. */
const TUI_ALLOWED = ['player-view'];

const tuiAllowedGroup = TUI_ALLOWED.join('|');

/**
 * npm packages `content` is allowed to import. The content package owns only
 * the shape of pack data, so it stays free of every workspace package and of
 * all third-party code except its two tools: `zod` for the schemas and `yaml`
 * for reading pack files (task 2.1). `tslib` is the TypeScript runtime helper
 * every package may use. Node built-ins are allowed by `no-content-foreign`
 * only transitively through `yaml`'s own dependencies, which `doNotFollow`
 * excludes from the graph.
 */
const CONTENT_ALLOWED_NPM = ['zod', 'yaml', 'tslib'];

const contentAllowedNpmGroup = CONTENT_ALLOWED_NPM.join('|');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'tui-imports-only-player-view',
      severity: 'error',
      comment:
        'tui may import only player-view. Everything the client needs must be ' +
        'exposed through the player-view facade so the Truth Store stays ' +
        'unreachable from the UI (Req 2.2, 13.5).',
      from: { path: '^packages/tui/' },
      to: {
        path: '^packages/',
        pathNot: `^packages/(tui|${tuiAllowedGroup})/`,
      },
    },
    {
      name: 'web-imports-only-player-view',
      severity: 'error',
      comment:
        'web (the loopback web shell) may import only player-view, exactly as ' +
        'tui does, so the Truth Store stays unreachable from the browser ' +
        'shell. Only app may import web (web-shell Requirements 2, 13).',
      from: { path: '^packages/web/' },
      to: {
        path: '^packages/',
        pathNot: `^packages/(web|${tuiAllowedGroup})/`,
      },
    },
    {
      name: 'only-app-imports-web',
      severity: 'error',
      comment: 'Nothing but the composition root (app) may depend on web.',
      from: { path: '^packages/', pathNot: '^packages/(web|app)/' },
      to: { path: '^packages/web/' },
    },
    {
      name: 'content-imports-no-workspace',
      severity: 'error',
      comment:
        'content may not import any other workspace package. It owns only the ' +
        'shape of pack data, so later specs add packs, not code, on top of a ' +
        'package that depends on nothing in the workspace (task 2.1).',
      from: { path: '^packages/content/' },
      to: {
        path: '^packages/',
        pathNot: '^packages/content/',
      },
    },
    {
      name: 'content-imports-only-zod-and-yaml',
      severity: 'error',
      comment:
        'content may import only zod and yaml (plus the tslib runtime helper) ' +
        'from npm. Keeping its third-party surface this small is what lets the ' +
        'schema package stay a pure data contract (task 2.1).',
      from: { path: '^packages/content/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'],
        pathNot: `node_modules/(${contentAllowedNpmGroup})(/|$)`,
      },
    },
    {
      name: 'engine-no-player-view',
      severity: 'error',
      comment:
        'engine may not import player-view, dialogue, llm, tui, app or evals. ' +
        'The engine is the base of the stack; everything above it depends on ' +
        'the engine, never the other way round. Package manifests enforce this ' +
        'already; this rule makes the boundary explicit (Req 18.2, 18.6).',
      from: { path: '^packages/engine/' },
      to: { path: '^packages/(player-view|dialogue|llm|tui|app|evals)/' },
    },
    {
      name: 'app-is-a-leaf',
      severity: 'error',
      comment:
        'app is the composition root, so no package may import it except ' +
        'evals, which drives the assembled game (Req 18.2, 18.6).',
      from: {
        path: '^packages/',
        pathNot: '^packages/(app|evals)/',
      },
      to: { path: '^packages/app/' },
    },
    {
      name: 'player-view-no-models',
      severity: 'error',
      comment:
        'player-view may not import dialogue, llm, tui or app. The Turn ' +
        'Pipeline reaches models only through injected seams, keeping the ' +
        'facade free of any model dependency (Req 18.2, 18.6).',
      from: { path: '^packages/player-view/' },
      to: { path: '^packages/(dialogue|llm|tui|web|app)/' },
    },
    {
      name: 'no-content-tools-in-runtime',
      severity: 'error',
      comment:
        'No runtime package (engine, dialogue, llm, player-view, tui) may ' +
        'import content-tools. The authoring tools are a dev-only package run ' +
        'through `pnpm content`; nothing the shipped game runs on may depend on ' +
        'them. content-tools itself may import content, engine, player-view and ' +
        'llm, so the arrow is one-way (Req 16.1).',
      from: { path: '^packages/(engine|dialogue|llm|player-view|tui)/' },
      to: { path: '^packages/content-tools/' },
    },
    {
      name: 'no-plot-lab-in-runtime',
      severity: 'error',
      comment:
        'player-view and tui must not import plot-lab. The lab is an authoring ' +
        'check over template graphs; the shipped game never depends on it.',
      from: { path: '^packages/(player-view|tui)/' },
      to: { path: '^packages/plot-lab/' },
    },
    {
      name: 'no-tui-in-campaign',
      severity: 'error',
      comment:
        'campaign must not import tui. The career loop is headless; the ' +
        'terminal client renders views it is given.',
      from: { path: '^packages/campaign/' },
      to: { path: '^packages/tui/' },
    },
    {
      name: 'campaign-view-only',
      severity: 'error',
      comment:
        'player-view may import campaign only through the view entry. ' +
        'The Campaign API under src/lib/campaign is the exception: it drives ' +
        'step and save. Campaign Truth stays inside that folder and is not ' +
        're-exported to the rest of player-view.',
      from: {
        path: '^packages/player-view/',
        pathNot: '^packages/player-view/src/lib/campaign/',
      },
      to: {
        path: '^packages/campaign/',
        pathNot: '^packages/campaign/src/view\\.ts$',
      },
    },
    {
      name: 'ambient-hooks-only',
      severity: 'error',
      comment:
        'Only engine/ambient/hooks may import plot mutation and hostile ' +
        'belief writers. The rest of the ambient sim records pending hooks ' +
        'and lets the gateway apply them.',
      from: {
        path: '^packages/engine/src/lib/ambient/',
        pathNot: '^packages/engine/src/lib/ambient/hooks',
      },
      to: {
        path: '^packages/engine/src/lib/(clock/plot-execution|clock/plot-abort|hostile)/',
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular imports between packages make the truth/view split ' +
        'impossible to reason about.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'An import that does not resolve is a broken build waiting to happen.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  // Undeclared and unused package dependencies are left to the
  // `@nx/dependency-checks` lint rule, which reads each package manifest
  // directly. Dev dependencies live in the root manifest here, so
  // dependency-cruiser sees them as `npm-no-pkg` and cannot classify them.
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: ['(^|/)(dist|out-tsc|test-output|coverage)/'],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      // The workspace packages expose their TypeScript sources behind the
      // `@tradecraft/source` export condition (see any packages/*/package.json),
      // so dependency-cruiser must ask for it to see past `dist`. `require` is
      // kept in the list so a CJS-only third-party package still resolves and
      // does not trip `not-to-unresolvable`.
      conditionNames: [
        '@tradecraft/source',
        'import',
        'require',
        'node',
        'default',
      ],
      extensions: [
        '.ts',
        '.tsx',
        '.mts',
        '.cts',
        '.js',
        '.jsx',
        '.mjs',
        '.cjs',
      ],
      exportsFields: ['exports'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
