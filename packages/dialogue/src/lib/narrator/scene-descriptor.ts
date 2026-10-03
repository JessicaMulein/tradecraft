/**
 * The Narrator's scene descriptor and the projection that builds it from the
 * Player View.
 *
 * The Narrator describes a scene vividly but must never invent facts, and — the
 * safety rule that matters most here — it must only ever see *view-safe* data
 * (Requirements 2.2, 20.2). The design makes that concrete: the Narrator is fed
 * a {@link SceneDescriptor} *projected from the Player View*, never from the
 * Truth Store. This module owns that projection.
 *
 * The input is a Player-View `SceneView` (packages/player-view): the current
 * Location's name, description and atmosphere, the day's time, the resolved
 * weather and crowd band, and the visible persons by name-or-descriptor. Those
 * fields are already stripped of truth by the Player View's own projection, so
 * the scene descriptor inherits that safety for free. To avoid a package-level
 * dependency from `dialogue` on `player-view` (and the import cycle it would
 * invite), the projection accepts the `SceneView` shape *structurally* through
 * {@link SceneViewInput} rather than importing the type: any object with those
 * fields — the real `SceneView` included — is accepted.
 *
 * The projection is pure and deterministic: it reads only its arguments, copies
 * the view-safe fields into a fresh descriptor, and performs no I/O. Given the
 * same `SceneView` and `kind` it returns a byte-identical descriptor.
 */

import type { CrowdLevel, EntityId, GameTime } from '@tradecraft/engine';

/**
 * What kind of scene the Narrator is describing. Mirrors the design's
 * `SceneDescriptor.kind` union; it lets the prompt builder frame an arrival
 * differently from, say, a surveillance beat without changing the facts.
 *
 * Named `NarratorSceneKind` to stand apart from the routing module's
 * `SceneKind` (which classifies *dialogue* scenes by stakes); the two name
 * different things and both reach the package barrel.
 */
export type NarratorSceneKind =
  | 'arrival'
  | 'surveillance'
  | 'follow'
  | 'dead-drop'
  | 'intercept'
  | 'wait'
  | 'scene-open'
  | 'arrest';

/** One visible person, named or described exactly as the Player View labels them. */
export interface VisibleLabel {
  /** The known name or the descriptor the player holds — never a hidden name. */
  readonly label: string;
}

/**
 * The scene descriptor the Narrator is prompted from (the design's
 * `SceneDescriptor`). Every field is view-safe: the Location name, description
 * and atmosphere tags, the time, the weather and crowd bands, and the visible
 * persons by label. There is deliberately nothing truth-bearing here — no NPC
 * ids, allegiances, MICE values or hidden names — because the projection only
 * ever copies from a Player-View `SceneView`.
 */
export interface SceneDescriptor {
  readonly location: {
    readonly name: string;
    readonly description: string;
    readonly atmosphere: readonly string[];
  };
  readonly time: GameTime;
  readonly weather: string;
  readonly crowd: CrowdLevel;
  /** Visible persons by known name or descriptor (design `visible: { label }`). */
  readonly visible: readonly VisibleLabel[];
  readonly kind: NarratorSceneKind;
}

/**
 * The structural view of a Player-View `SceneView` the projection reads. It is
 * the subset of `SceneView` fields the scene descriptor is built from; the real
 * `SceneView` carries extra fields (e.g. the Location id and risk band) that
 * the Narrator does not need and this projection drops. Keeping it structural
 * means `dialogue` never has to import `player-view`.
 */
export interface SceneViewInput {
  readonly location: {
    readonly name: string;
    readonly description: string;
    readonly atmosphere: readonly string[];
  };
  readonly time: GameTime;
  readonly weather: string;
  readonly crowd: CrowdLevel;
  readonly visible: readonly { readonly label: string }[];
}

/**
 * Project a Player-View {@link SceneViewInput} into the Narrator's
 * {@link SceneDescriptor}.
 *
 * The function copies only the view-safe fields the Narrator may see — Location
 * name, description and atmosphere, time, weather, crowd and the visible-person
 * labels — and stamps the scene `kind`. The Location id and risk band the
 * `SceneView` also carries are intentionally dropped: the Narrator needs none
 * of them, and leaving them out keeps the descriptor to exactly the surface
 * Requirement 20.2 names.
 *
 * It makes defensive copies of the array fields so the returned descriptor
 * cannot alias (and so later mutation of) the caller's view. Pure and
 * deterministic.
 *
 * @param view a Player-View `SceneView` (or any object of the same shape).
 * @param kind the scene kind to describe; defaults to `scene-open`.
 */
export function sceneDescriptorFromView(
  view: SceneViewInput,
  kind: NarratorSceneKind = 'scene-open',
): SceneDescriptor {
  return {
    location: {
      name: view.location.name,
      description: view.location.description,
      atmosphere: [...view.location.atmosphere],
    },
    time: view.time,
    weather: view.weather,
    crowd: view.crowd,
    visible: view.visible.map((p) => ({ label: p.label })),
    kind,
  };
}

/** Re-export the entity id type callers thread through the known-entity list. */
export type { EntityId };
