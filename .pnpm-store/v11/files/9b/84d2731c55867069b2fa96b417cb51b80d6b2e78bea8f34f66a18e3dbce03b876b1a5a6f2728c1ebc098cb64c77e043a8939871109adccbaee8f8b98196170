/**
 * Prompts for analytics preference if not already set in nx.json, persists the
 * answer so later commands don't re-ask, and returns it for telemetry. Returns
 * 'unset' when not prompted (CI / non-interactive / no nx.json). `nx init`
 * passes its own root + interactive flag; the default call (bin/nx.ts) derives
 * interactive from the TTY.
 */
export declare function ensureAnalyticsPreferenceSet(root?: string, interactive?: boolean): Promise<'yes' | 'no' | 'unset'>;
export declare function promptForAnalyticsPreference(): Promise<boolean>;
