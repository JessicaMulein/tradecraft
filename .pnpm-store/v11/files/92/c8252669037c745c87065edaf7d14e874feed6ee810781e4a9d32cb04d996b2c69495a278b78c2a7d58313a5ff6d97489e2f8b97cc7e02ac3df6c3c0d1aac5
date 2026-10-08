"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEANINGFUL_OVERHEAD = exports.MIN_RECOMMENDATION_RUN_DURATION = void 0;
exports.prefetchRemoteCacheOnboardingUrl = prefetchRemoteCacheOnboardingUrl;
exports.recommendationToPayloadString = recommendationToPayloadString;
exports.buildRecommendations = buildRecommendations;
exports.formatReport = formatReport;
exports.formatReportMarkdown = formatReportMarkdown;
exports.buildExitSummaryPayload = buildExitSummaryPayload;
const native_1 = require("../../native");
const terminal_link_1 = require("../../utils/terminal-link");
const nx_cloud_utils_1 = require("../../utils/nx-cloud-utils");
const url_shorten_1 = require("../../nx-cloud/utilities/url-shorten");
const get_cloud_options_1 = require("../../nx-cloud/utilities/get-cloud-options");
const git_utils_1 = require("../../utils/git-utils");
const logger_1 = require("../../utils/logger");
const NX_AGENTS_URL = 'https://nx.dev/ci/features/distribute-task-execution';
// Fallback for the remote-cache CTA when the short onboarding URL can't be
// fetched: the generic Cloud get-started page (still drives to onboarding).
const NX_CLOUD_GET_STARTED_URL = 'https://cloud.nx.app/get-started';
const NX_PERFORMANCE_URL = 'https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution';
/** utm tag attributing report clicks back to it; the content names the CTA clicked. */
const utm = (content) => `?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=${content}`;
const NX_PERFORMANCE_LINK = `${NX_PERFORMANCE_URL}${utm('parallelization')}`;
const NX_AGENTS_LINK = `${NX_AGENTS_URL}${utm('nx-agents')}`;
const NX_REMOTE_CACHE_LINK = `${NX_CLOUD_GET_STARTED_URL}${utm('remote-cache')}`;
// Defaults to the get-started link; a disconnected workspace gets a short Nx
// Cloud onboarding URL instead (see prefetchRemoteCacheOnboardingUrl).
let remoteCacheLink = NX_REMOTE_CACHE_LINK;
// Give up on the short URL after this long so a slow/hung Cloud API never
// lingers past the exit report. Covers two sequential round trips (features
// GET, onboarding POST); the 30s CTA floor leaves room. Timing out also aborts
// the request - Promise.race alone would leave the socket holding the event
// loop open, which strands programmatic callers that never process.exit.
const ONBOARDING_URL_TIMEOUT = 5000;
/**
 * Point the remote-cache CTA at a short Nx Cloud onboarding URL for a
 * disconnected GitHub workspace - the VCS flow where Cloud opens the nx.json PR.
 * Non-GitHub remotes keep the get-started link (handles every provider) and skip
 * the network entirely. Runs in CI too - terminal + job summary.
 *
 * Best-effort: the get-started link stays on failure/timeout. Fired at run start;
 * the CTA needs a >30s run (MIN_RECOMMENDATION_RUN_DURATION), so the fetch
 * always resolves first.
 */
async function prefetchRemoteCacheOnboardingUrl(nxJson) {
    if ((0, nx_cloud_utils_1.isNxCloudDisabled)(nxJson) || (0, nx_cloud_utils_1.isNxCloudUsed)(nxJson)) {
        return;
    }
    if ((0, git_utils_1.getVcsRemoteInfo)()?.domain !== 'github.com') {
        return;
    }
    const abortController = new AbortController();
    try {
        const url = await Promise.race([
            (0, url_shorten_1.createNxCloudOnboardingURL)('nx-cli-perf-report', undefined, undefined, false, false, undefined, abortController.signal),
            new Promise((resolve) => {
                // unref so the pending timer never keeps the CLI alive on its own.
                setTimeout(() => {
                    abortController.abort();
                    resolve(null);
                }, ONBOARDING_URL_TIMEOUT).unref();
            }),
        ]);
        // createNxCloudOnboardingURL never throws - on an unreachable API it returns a
        // paste-a-token URL (accessToken=undefined). Only accept a real short link.
        if (url?.startsWith(`${(0, get_cloud_options_1.getCloudUrl)()}/connect/`)) {
            remoteCacheLink = url;
        }
        else {
            logger_1.logger.verbose(`Keeping the get-started remote-cache link (${url === null ? 'onboarding URL timed out' : `got: ${url}`})`);
        }
    }
    catch (e) {
        logger_1.logger.verbose(`Keeping the get-started remote-cache link: ${e}`);
    }
}
/**
 * Whole-phrase CTA: the whole sentence is the link. The Rust TUI popup keeps no
 * copy of this string; it gets the phrase + href from the exit payload's `links`.
 */
const NX_REMOTE_CACHE_CTA = 'Drastically reduce your run duration by sharing a cache across your team and CI';
const NX_DISTRIBUTE_CTA = 'Distribute across machines with Nx Agents';
function phraseLink(phrase, taggedUrl) {
    return { visible: phrase, href: taggedUrl };
}
// Discriminate positively — test for what each part *is*. A `!isRecTaskRows` catch-all
// would misclassify a future `RecPart` member as a link; TS can't catch that (it never
// checks a predicate body), so `recommendationLinks`' `.filter(isRecLink)` would ship
// `{text: undefined, href: undefined}` to the popup.
function isRecLink(part) {
    return typeof part !== 'string' && 'href' in part;
}
function isRecTaskRows(part) {
    return Array.isArray(part);
}
/**
 * Project a recommendation to a string, formatting each non-text part with the caller's
 * renderers. The three output targets (payload, terminal, Markdown) share this one dispatch.
 * After the string and task-rows branches a part is a {@link RecLink}, so `render.link`
 * takes it directly — and a new {@link RecPart} member that is neither would fail to satisfy
 * that `RecLink` parameter, turning "forgot to handle it" into a compile error right here.
 */
function renderRecommendation(rec, render) {
    return rec
        .map((part) => {
        if (typeof part === 'string') {
            return part;
        }
        if (isRecTaskRows(part)) {
            return render.taskRows(part);
        }
        return render.link(part);
    })
        .join('');
}
/**
 * The recommendation string the napi payload ships and the Rust popup matches against.
 * Links are URL-less (the popup re-links them from {@link PerformanceSummaryPayload.links}).
 */
function recommendationToPayloadString(rec) {
    return renderRecommendation(rec, {
        link: (link) => link.visible,
        taskRows: taskRowsToText,
    });
}
/** Task rows as the text block the terminal and payload embed: newline-led, space-aligned columns. */
function taskRowsToText(tasks) {
    return ['', ...formatTopTaskRows(tasks)].join('\n');
}
/**
 * The recommendation as a terminal string. With OSC 8 the phrase becomes a hyperlink
 * (the phrase visible, the tagged URL the target); without it the tagged URL is appended
 * as ` → <url>` — `terminalLink` can't do this since it drops the URL when hyperlinks
 * are off.
 */
function recommendationToTerminalString(rec, hyperlinks) {
    return renderRecommendation(rec, {
        link: (link) => hyperlinks
            ? (0, terminal_link_1.terminalLink)(link.visible, link.href)
            : `${link.visible} → ${link.href}`,
        taskRows: taskRowsToText,
    });
}
/** The popup links (phrase + href) for every link in a recommendation list, for OSC 8 re-linking. */
function recommendationLinks(recommendations) {
    return recommendations.flatMap((rec) => rec
        .filter(isRecLink)
        .map((part) => ({ text: part.visible, href: part.href })));
}
/** Below this run duration (ms), the run is already fast — recommend nothing. */
exports.MIN_RECOMMENDATION_RUN_DURATION = 30_000;
/** At/below this hit rate, recommend remote cache (if off); above it caching works. */
const LOW_CACHE_HIT_RATE = 0.1;
/** Below this (ms) overhead is noise, not worth a recommendation. */
exports.MEANINGFUL_OVERHEAD = 1000;
/** Recommend --parallel when recoverable slot time is at least this fraction of the run. */
const PARALLEL_LEAD_FRACTION = 0.2;
/** Append "s" unless `count` is 1 (regular plurals only). */
function pluralize(count, noun) {
    return count === 1 ? noun : `${noun}s`;
}
/** Slot-contention time recoverable by parallelism or more machines (the "recoverable" number both the report and TUI payload show). Derived, never stored, so the halves can't drift from their sum. */
function recoverableTime(s) {
    return s.recoverableByParallel + s.recoverableByMachines;
}
/** Render the longest critical-path tasks as aligned columns: task (left), duration (right). */
function formatTopTaskRows(tasks) {
    // Non-empty by construction: the only recommendation carrying task rows requires
    // `criticalPathTop.length > 0` to apply, so no empty array reaches the widths below.
    const idWidth = Math.max(...tasks.map((t) => t.id.length));
    const durations = tasks.map((t) => (0, native_1.formatDuration)(t.duration));
    const durWidth = Math.max(...durations.map((d) => d.length));
    return tasks.map((t, i) => {
        const id = t.id.padEnd(idWidth);
        const dur = durations[i].padStart(durWidth);
        return `  ${id}    ${dur}`;
    });
}
// Bottleneck predicates, shared so the speed levers below stay mutually exclusive: a run
// gets one parallelism lever, never both "raise --parallel" and "distribute". Each names
// the run shape it diagnoses.
/** Spare cores: raising local --parallel recovers a meaningful slice and is the dominant half. */
const parallelLeverApplies = (c) => !c.distributing &&
    c.runDuration > 0 &&
    c.recoverableByParallel >= PARALLEL_LEAD_FRACTION * c.runDuration &&
    c.recoverableByParallel >= c.recoverableByMachines;
/** Already on agents: more agents recovers a meaningful slice. */
const agentsLeverApplies = (c) => c.distributing &&
    c.runDuration > 0 &&
    c.recoverable >= PARALLEL_LEAD_FRACTION * c.runDuration;
/**
 * Machine-bound: slots a higher local --parallel can't free (the core ceiling, or a
 * parallelism:false task / volume monopolizing the pool) — only more machines free them.
 */
const machineBound = (c) => !c.distributing && c.recoverableByMachines >= exports.MEANINGFUL_OVERHEAD;
/** Coordinator-dominated and not machine-bound: the machine is ~maxed on overhead. */
const coordinatorBound = (c) => !c.distributing &&
    c.recoverableByMachines < exports.MEANINGFUL_OVERHEAD &&
    c.coordinatorDominated;
/** No parallelism/machine/coordinator lever is the bottleneck → the critical path is. */
const criticalPathBound = (c) => !parallelLeverApplies(c) &&
    !agentsLeverApplies(c) &&
    !machineBound(c) &&
    !coordinatorBound(c);
/**
 * Every recommendation the report can make, in display order — cheapest lever first, the
 * deep "speed up the longest tasks" work last. The report shows exactly the applicable
 * ones: `RECOMMENDATIONS.filter((r) => r.isApplicable(c))`. Each carries its own criteria;
 * the bottleneck predicates above keep the speed levers mutually exclusive.
 */
const RECOMMENDATIONS = [
    {
        // Spare cores: the lever is local --parallel. Whole-phrase link to the perf docs; the
        // period stays outside the link.
        isApplicable: parallelLeverApplies,
        build: (c) => [
            phraseLink(`Increase parallelism to recover up to ${(0, native_1.formatDuration)(c.recoverableByParallel)}`, NX_PERFORMANCE_LINK),
            `.`,
        ],
    },
    {
        // Already on agents: more agents (not local --parallel) is the parallelism lever.
        isApplicable: agentsLeverApplies,
        build: (c) => [
            `Add more Nx Agents to recover up to ${(0, native_1.formatDuration)(c.recoverable)}.`,
        ],
    },
    {
        // Barely-used cache with no remote: set up Nx Cloud. Whole-phrase link; the payload
        // string stays URL-less (the popup re-links the phrase). Never pushed at a
        // workspace that opted out of Nx Cloud.
        isApplicable: (c) => !c.cacheSkipped &&
            !c.cloudOptedOut &&
            c.cacheableCount > 0 &&
            !c.remoteCacheEnabled &&
            c.cacheHits / c.cacheableCount <= LOW_CACHE_HIT_RATE,
        build: () => [phraseLink(NX_REMOTE_CACHE_CTA, remoteCacheLink), `.`],
    },
    {
        // Cache skipped: drop the flag to restore unchanged tasks instantly.
        isApplicable: (c) => c.cacheSkipped,
        build: () => [
            `Cache: drop --skip-nx-cache to restore unchanged tasks instantly.`,
        ],
    },
    {
        // Machine-bound, coordinator-dominated, or a recoverable critical-path-bound run: more
        // machines help, and that lever only exists in CI (canDistribute). Excludes the
        // --parallel case so the two parallelism levers never show together.
        isApplicable: (c) => c.canDistribute &&
            !parallelLeverApplies(c) &&
            (machineBound(c) ||
                coordinatorBound(c) ||
                (criticalPathBound(c) &&
                    c.runDuration > 0 &&
                    c.recoverable >= PARALLEL_LEAD_FRACTION * c.runDuration)),
        build: () => [phraseLink(NX_DISTRIBUTE_CTA, NX_AGENTS_LINK), `.`],
    },
    {
        // Critical-path-bound: shorten the chain's longest tasks (the deepest manual work, the
        // only multi-line rec). Nothing ran (fully cached) → it doesn't apply.
        isApplicable: (c) => criticalPathBound(c) && c.criticalPathTop.length > 0,
        build: (c) => [
            `Speed up or split the longest tasks on the critical path:`,
            c.criticalPathTop,
        ],
    },
];
/**
 * The recommendations the report shows, in display order: every candidate in
 * {@link RECOMMENDATIONS} whose criteria apply to this run. Shared by the terminal report,
 * the GitHub-summary Markdown, and the TUI payload.
 */
function buildRecommendations(s) {
    // A fast run has nothing worth optimizing — stats only, no advice.
    if (s.runDuration < exports.MIN_RECOMMENDATION_RUN_DURATION) {
        return [];
    }
    const c = {
        recoverableByParallel: s.recoverableByParallel,
        recoverableByMachines: s.recoverableByMachines,
        recoverable: recoverableTime(s),
        coordinatorDominated: s.coordinatorDominated,
        runDuration: s.runDuration,
        canDistribute: s.canDistribute,
        distributing: s.distributing,
        criticalPathTop: s.criticalPathTop,
        cacheHits: s.cacheHits,
        cacheableCount: s.cacheableCount,
        cacheSkipped: s.cacheSkipped,
        remoteCacheEnabled: s.remoteCacheEnabled,
        cloudOptedOut: s.cloudOptedOut,
    };
    return RECOMMENDATIONS.filter((r) => r.isApplicable(c)).map((r) => r.build(c));
}
/** Top-of-report cache stat: hit rate or skip marker. Null when there's no cache outcome. */
function cacheStat(s) {
    if (s.cacheSkipped) {
        return 'Skipped (--skip-nx-cache)';
    }
    if (s.cacheableCount === 0) {
        return null;
    }
    const pct = Math.round((s.cacheHits / s.cacheableCount) * 100);
    return `${s.cacheHits}/${s.cacheableCount} hit (${pct}%)`;
}
/** The full performance report as a terminal string (the TUI popup renders natively from {@link buildExitSummaryPayload} instead). */
function formatReport(s) {
    const fmt = native_1.formatDuration;
    // Shows two of run duration's three parts (critical path + recoverable); the third,
    // coordinator overhead, isn't displayed, so the two don't sum to run duration.
    const recoverable = recoverableTime(s);
    const recoverablePct = s.runDuration > 0 ? Math.round((recoverable / s.runDuration) * 100) : 0;
    // Pad to the widest label ("Recoverable time:" = 17) so values align without a
    // gaping gap. Keep in sync with the Rust popup's stat_line.
    const stat = (label, value) => `  ${`${label}:`.padEnd(17)}  ${value}`;
    // No leading blank line: nx's run summary already prints trailing blanks before this.
    const cache = cacheStat(s);
    const lines = [
        stat('Run duration', fmt(s.runDuration)),
        ...(cache ? [stat('Cache', cache)] : []),
        stat('Critical path', `${fmt(s.criticalPathDuration)} (${s.criticalPathTaskCount} ${pluralize(s.criticalPathTaskCount, 'task')})`),
        stat('Recoverable time', recoverable > 0
            ? `${fmt(recoverable)} (${recoverablePct}% of the run)`
            : fmt(recoverable)),
    ];
    const hyperlinks = (0, terminal_link_1.supportsHyperlinks)();
    const recommendations = buildRecommendations(s);
    const render = (r) => recommendationToTerminalString(r, hyperlinks);
    // A rec may be multi-line (the critical-path one embeds a task list); indent
    // continuation lines under the bullet.
    const renderRec = (r) => {
        const [first, ...rest] = r.split('\n');
        return [`    - ${first}`, ...rest.map((l) => `      ${l}`)];
    };
    if (recommendations.length > 0) {
        const onlySingleLine = recommendations.length === 1 &&
            !recommendationToPayloadString(recommendations[0]).includes('\n');
        if (onlySingleLine) {
            lines.push('', `  Recommendation: ${render(recommendations[0])}`);
        }
        else {
            lines.push('', '  Recommendations:', ...recommendations.flatMap((r) => renderRec(render(r))));
        }
    }
    // No trailing newline — the caller's console.log adds the line terminator.
    return lines.join('\n');
}
/**
 * A recommendation as Markdown: every link becomes `[phrase](href)` (no OSC 8, unlike the
 * terminal renderer) — the whole sentence reads as prose and is the link text. Task rows
 * become a nested list under the recommendation's bullet (space-aligned columns don't
 * survive HTML's whitespace collapsing).
 */
function recommendationToMarkdownString(rec) {
    return renderRecommendation(rec, {
        link: (link) => `[${link.visible}](${link.href})`,
        taskRows: (rows) => rows
            .map((t) => `\n  - \`${t.id}\` — ${(0, native_1.formatDuration)(t.duration)}`)
            .join(''),
    });
}
/**
 * The performance report as GitHub-flavored Markdown for the Actions job summary
 * (`$GITHUB_STEP_SUMMARY`). Mirrors {@link formatReport}'s content — the same stats and
 * recommendations — and, when the run had failures, lists them above the stats. Links
 * render as Markdown links rather than OSC 8 hyperlinks.
 *
 * `command` (the nx command, e.g. `run-many -t build`) is appended to the heading so
 * stacked reports from multiple nx commands in one job summary stay distinguishable.
 */
function formatReportMarkdown(s, command) {
    const fmt = native_1.formatDuration;
    const recoverable = recoverableTime(s);
    const recoverablePct = s.runDuration > 0 ? Math.round((recoverable / s.runDuration) * 100) : 0;
    const cache = cacheStat(s);
    const lines = [`## Nx Run Report — \`${command}\``];
    // The run's outcome is the headline of a CI summary, so it goes first — above the
    // performance stats. Failures list the slowest tasks; a green run states it succeeded.
    const failedTasks = s.failedTasks;
    if (failedTasks.length > 0) {
        lines.push('', `### ❌ ${failedTasks.length} failed ${pluralize(failedTasks.length, 'task')}`, '', ...failedTasks.map((id) => `- \`${id}\``));
    }
    else {
        lines.push('', '### ✅ All tasks succeeded');
    }
    // Headline stats as a bold-label list, mirroring the terminal stat lines.
    lines.push('', '### Performance', '', `- **Run duration:** ${fmt(s.runDuration)}`, ...(cache ? [`- **Cache:** ${cache}`] : []), `- **Critical path:** ${fmt(s.criticalPathDuration)} (${s.criticalPathTaskCount} ${pluralize(s.criticalPathTaskCount, 'task')})`, `- **Recoverable time:** ${recoverable > 0
        ? `${fmt(recoverable)} (${recoverablePct}% of the run)`
        : fmt(recoverable)}`);
    const recommendations = buildRecommendations(s);
    if (recommendations.length > 0) {
        lines.push('', '### Recommendations', '');
        for (const rec of recommendations) {
            lines.push(`- ${recommendationToMarkdownString(rec)}`);
        }
    }
    return lines.join('\n');
}
/**
 * Build the payload for the TUI's exit-countdown popup, which renders natively in Rust
 * (the terminal path uses {@link formatReport}). The shape is the generated napi
 * {@link PerformanceSummaryPayload}, imported not re-declared so the producer and the
 * Rust struct can't drift.
 */
function buildExitSummaryPayload(s) {
    const hasCache = s.cacheableCount > 0;
    const recommendations = buildRecommendations(s);
    return {
        runDurationMs: s.runDuration,
        criticalPathMs: s.criticalPathDuration,
        criticalPathTaskCount: s.criticalPathTaskCount,
        recoverableMs: recoverableTime(s),
        // One nested field, not a hits/total pair: "one set, the other not" is
        // unrepresentable, so the Rust side drops its defensive match.
        cache: hasCache
            ? { hits: s.cacheHits, total: s.cacheableCount }
            : undefined,
        cacheSkipped: s.cacheSkipped,
        // The napi payload ships plain strings; a phrase link (the remote-cache CTA)
        // stays URL-less here and is re-linked from `links` by the popup.
        recommendations: recommendations.map(recommendationToPayloadString),
        // Phrase links (e.g. the remote-cache CTA) carry their href as data so the
        // popup hyperlinks the phrase in place; surfaced only when shown.
        links: recommendationLinks(recommendations),
    };
}
