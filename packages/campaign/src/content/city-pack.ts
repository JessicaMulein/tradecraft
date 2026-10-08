/**
 * The City Pack surface campaign reads (Req 21.3). `services` are
 * content-expansion Service Definition ids. This module defines no Service
 * schema.
 *
 * A Cover Identity's `official` flag defaults to true when the pack omits it.
 */

export interface CityPackView {
  readonly id: string;
  readonly displayName: string;
  readonly years: readonly [number, number];
  readonly languages: readonly string[];
  readonly services: readonly string[];
  readonly covers: readonly string[];
}

/** True unless the Cover Identity sets `official` to false. */
export function coverOfficial(cover: { readonly official?: boolean }): boolean {
  return cover.official !== false;
}
