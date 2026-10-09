/**
 * Liaison services as the player sees them (Requirement 7.6).
 * Reliability, the agenda and penetrations are not on this view.
 */

export type TrustBand = 'none' | 'low' | 'working' | 'high';

export interface LiaisonServiceView {
  readonly id: string;
  readonly trust: TrustBand;
}

function band(trust: number): TrustBand {
  if (trust <= 0) {
    return 'none';
  }
  if (trust < 0.4) {
    return 'low';
  }
  if (trust < 0.75) {
    return 'working';
  }
  return 'high';
}

/** Project liaison services. The input may carry hidden fields; the view does not. */
export function liaisonViews(
  services: readonly {
    readonly id: string;
    readonly trust: number;
    readonly reliability?: unknown;
    readonly agenda?: unknown;
    readonly penetratedBy?: unknown;
  }[],
): readonly LiaisonServiceView[] {
  return services.map((service) => ({ id: service.id, trust: band(service.trust) }));
}
