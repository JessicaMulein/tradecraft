/**
 * Path of the current user's native binary cache. Nothing about the constant is
 * owner-only — `ensureSecureNativeFileCacheLocation` is what establishes that,
 * and on Windows nothing does, since the OS temp dir is already per-account.
 */
export declare const NATIVE_CACHE_ROOT: string;
export declare function getNativeFileCacheLocationToDelete(): string | null;
/**
 * Create the native file cache dir, or return `null` if it cannot be created
 * *securely* — in which case the caller loads the binding in place.
 *
 * The stable top-level container is verified as safe for private children. The
 * uid directory and every directory loaded through are owner-only.
 * `ensureOwnedPrivateDir` refuses a directory or symlink another local user
 * planted before us.
 */
export declare function ensureSecureNativeFileCacheLocation(cacheRoot?: string): string | null;
