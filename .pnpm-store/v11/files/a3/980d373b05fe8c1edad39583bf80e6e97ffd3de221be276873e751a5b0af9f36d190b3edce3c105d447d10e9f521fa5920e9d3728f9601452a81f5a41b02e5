import type { PerformanceSummaryPayload } from '../../native';
import type { NxJsonConfiguration } from '../../config/nx-json';
import type { PerformanceSummary, TaskDurationRow } from './performance-analysis';
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
export declare function prefetchRemoteCacheOnboardingUrl(nxJson: NxJsonConfiguration): Promise<void>;
/**
 * A recommendation built from structured parts so the link text comes from the link
 * definition (not a substring scanned out of the assembled report). A part is literal
 * text, a {@link RecLink}, or a {@link RecTaskRows}, projected to each output string by
 * {@link renderRecommendation}.
 *
 * String parts must be single-line — multi-line content needs its own structured part (as
 * {@link RecTaskRows} is). TS can't enforce this: `string` is already a handled member, so
 * a multi-line one compiles and then breaks the Markdown nested list.
 */
type RecPart = string | RecLink | RecTaskRows;
export type Recommendation = RecPart[];
/**
 * A docs link inside a recommendation: a sentence is the visible text and the whole of
 * it links to the utm-tagged URL. With OSC 8 the phrase is a hyperlink; without it the
 * tagged URL is appended as ` → <url>`. The payload string is URL-less — the Rust popup
 * re-links the phrase from {@link PerformanceSummaryPayload.links}.
 */
interface RecLink {
    visible: string;
    href: string;
}
/**
 * The critical path's longest tasks as data, so each renderer formats them natively:
 * the terminal and payload as space-aligned columns, Markdown as a nested list
 * (HTML collapses space runs, so aligned columns don't survive rendering there).
 */
type RecTaskRows = TaskDurationRow[];
/**
 * The recommendation string the napi payload ships and the Rust popup matches against.
 * Links are URL-less (the popup re-links them from {@link PerformanceSummaryPayload.links}).
 */
export declare function recommendationToPayloadString(rec: Recommendation): string;
/** Below this run duration (ms), the run is already fast — recommend nothing. */
export declare const MIN_RECOMMENDATION_RUN_DURATION = 30000;
/** Below this (ms) overhead is noise, not worth a recommendation. */
export declare const MEANINGFUL_OVERHEAD = 1000;
/**
 * The recommendations the report shows, in display order: every candidate in
 * {@link RECOMMENDATIONS} whose criteria apply to this run. Shared by the terminal report,
 * the GitHub-summary Markdown, and the TUI payload.
 */
export declare function buildRecommendations(s: PerformanceSummary): Recommendation[];
/** The full performance report as a terminal string (the TUI popup renders natively from {@link buildExitSummaryPayload} instead). */
export declare function formatReport(s: PerformanceSummary): string;
/**
 * The performance report as GitHub-flavored Markdown for the Actions job summary
 * (`$GITHUB_STEP_SUMMARY`). Mirrors {@link formatReport}'s content — the same stats and
 * recommendations — and, when the run had failures, lists them above the stats. Links
 * render as Markdown links rather than OSC 8 hyperlinks.
 *
 * `command` (the nx command, e.g. `run-many -t build`) is appended to the heading so
 * stacked reports from multiple nx commands in one job summary stay distinguishable.
 */
export declare function formatReportMarkdown(s: PerformanceSummary, command: string): string;
/**
 * Build the payload for the TUI's exit-countdown popup, which renders natively in Rust
 * (the terminal path uses {@link formatReport}). The shape is the generated napi
 * {@link PerformanceSummaryPayload}, imported not re-declared so the producer and the
 * Rust struct can't drift.
 */
export declare function buildExitSummaryPayload(s: PerformanceSummary): PerformanceSummaryPayload;
export {};
