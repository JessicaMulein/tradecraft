import type { MigrateInclude } from './migrate';
import { type MigrateMultiMajorChoice } from './migrate-analytics';
export declare const MULTI_MAJOR_MODE_FLAG = "--multi-major-mode";
export type MultiMajorMode = 'direct' | 'gradual';
/**
 * Result of running the multi-major check.
 *
 * - `chosen`: the version to actually migrate to (always concrete semver when
 *   the function ran past the dist-tag resolution; otherwise the input value).
 * - `originalTarget`: set only when an actual redirect happened (gradual mode
 *   auto-picked a smaller step, OR the interactive prompt returned a version
 *   different from the resolved target). Holds the concrete resolved target
 *   so callers can suggest re-running toward it.
 * - `gradual`: set only when the redirect came from gradual mode (flag or
 *   env). Tells callers it's safe to propagate `--multi-major-mode=gradual`
 *   to a continuation command; left unset when the redirect came from the
 *   interactive prompt so the user isn't silently locked into gradual.
 * - `decision`: the collapsed outcome (`gradual` | `direct`) folded into the
 *   generate completion analytics event; left unset on the early returns
 *   where the multi-major gate didn't apply.
 */
export type MultiMajorResult = {
    chosen: string;
    originalTarget?: string;
    gradual?: boolean;
    decision?: MigrateMultiMajorChoice;
};
export declare function isNxTarget(targetPackage: string, targetVersion: string): boolean;
export declare function maybePromptOrWarnMultiMajorMigration(args: {
    include: MigrateInclude;
    options: {
        multiMajorMode?: MultiMajorMode;
        interactive?: boolean;
    };
    targetPackage: string;
    targetVersion: string;
}): Promise<MultiMajorResult>;
