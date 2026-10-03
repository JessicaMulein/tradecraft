/**
 * The Still-Frame Hook (design, "Frame service"; Requirement 11).
 *
 * A frame is view-side decoration. It is not part of the determinism contract,
 * the Content Manifest or the save, and no gameplay decision depends on it.
 *
 * ## Model budget (Requirement 11.10)
 *
 * A provider that runs a model must fit the Reference Machine's model budget
 * (slice Req 14.5): at most two resident language models. An image model
 * competes with them for memory, so a provider that loads one needs its own
 * spec before it ships. This interface only fixes the seam.
 */

import type { HereView, SceneView } from '@tradecraft/player-view';

export type FrameKind = 'scene' | 'portrait' | 'title';

export interface FrameRequest {
  readonly kind: FrameKind;
  /** sha256 of the canonical request (without the key), hex. */
  readonly key: string;
  readonly location: {
    readonly name: string;
    readonly type: string;
    readonly description: string;
    readonly atmosphere: readonly string[];
  };
  readonly phase: string;
  readonly crowd: string;
  readonly weather: string;
  /** Portrait or scene subjects: only people the player can see. */
  readonly visible: readonly { readonly label: string; readonly descriptor: string }[];
  readonly artDirection: string;
}

export interface Frame {
  readonly bytes: Uint8Array;
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface SceneFrameProvider {
  readonly id: string;
  render(req: FrameRequest, signal: AbortSignal): Promise<Frame | undefined>;
  prepare?(
    batch: readonly FrameRequest[],
    onProgress: (done: number, total: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

/** The default provider: renders nothing, so the page shows no frame. */
export const NullFrameProvider: SceneFrameProvider = {
  id: 'null',
  render: () => Promise.resolve(undefined),
};

export type FrameBuildInput = {
  readonly scene: SceneView;
  readonly here: HereView;
  readonly artDirection: string;
};
