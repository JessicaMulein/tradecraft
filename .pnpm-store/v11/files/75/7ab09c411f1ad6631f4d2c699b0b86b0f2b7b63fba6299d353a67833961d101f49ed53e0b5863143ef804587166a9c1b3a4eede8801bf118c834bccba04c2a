export interface RegistryMetadata {
    name: string;
    versions: string[];
    time: Record<string, string> | null;
    distTags: Record<string, string>;
}
/**
 * Fetches the full packument for a package and normalizes the quirks of
 * `npm view --json`: `versions` may be a scalar when a single version exists,
 * `time` may be absent (third-party registries) and is exposed as null,
 * `dist-tags` carries a hyphen.
 */
export declare function fetchRegistryMetadata(pkg: string): Promise<RegistryMetadata>;
