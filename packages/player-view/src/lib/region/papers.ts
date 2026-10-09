/**
 * Papers as the player sees them (Requirement 4.5). Quality is not on this view.
 */

export interface PaperIssuerView {
  readonly kind: string;
  readonly id: string;
}

export interface PaperView {
  readonly id: string;
  readonly kind: string;
  readonly holder: string;
  readonly issuedBy: PaperIssuerView;
  readonly valid?: { readonly from: { readonly day: number; readonly phase: number }; readonly to: { readonly day: number; readonly phase: number } };
  readonly satisfies: readonly string[];
}

/** Project held papers. The input may carry a quality field; the view does not. */
export function paperViews(
  held: readonly string[],
  documents: Readonly<Record<string, {
    readonly id: string;
    readonly kind: string;
    readonly holder: string;
    readonly issuedBy: PaperIssuerView;
    readonly valid?: PaperView['valid'];
    readonly satisfies?: readonly string[];
    readonly quality?: unknown;
  }>>,
): readonly PaperView[] {
  const views: PaperView[] = [];
  for (const id of held) {
    const document = documents[id];
    if (document === undefined) {
      continue;
    }
    views.push({
      id: document.id,
      kind: document.kind,
      holder: document.holder,
      issuedBy: { kind: document.issuedBy.kind, id: document.issuedBy.id },
      ...(document.valid === undefined ? {} : { valid: document.valid }),
      satisfies: document.satisfies ?? [],
    });
  }
  return views;
}
