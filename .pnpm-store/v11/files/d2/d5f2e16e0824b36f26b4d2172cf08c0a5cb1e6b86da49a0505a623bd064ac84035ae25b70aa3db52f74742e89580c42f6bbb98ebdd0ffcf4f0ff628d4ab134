/**
 * Wrap `text` in an OSC 8 hyperlink to `url` (unchanged `text` where unsupported).
 * Lets us keep tracking querystrings out of the visible output (CLOUD-4642).
 */
export declare function terminalLink(text: string, url: string): string;
/**
 * OSC 8 support detection, adapted from `supports-hyperlinks`. Defaults to false
 * so we never print raw escape sequences to a terminal that can't render them.
 * Exported so callers can vary the *visible* text by support.
 */
export declare function supportsHyperlinks(): boolean;
/**
 * Exported for testing. VTE packs versions as an integer (e.g. "5402" = 0.54.2);
 * everything else is dot-separated.
 */
export declare function parseVersion(versionString?: string): {
    major: number;
    minor: number;
    patch: number;
};
