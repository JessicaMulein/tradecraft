/**
 * The Station mole-report projection (slice-integration task; design, "Turn
 * Pipeline" step 8; Requirement 3.6).
 *
 * When a mole is enabled, one Station staffer secretly serves the Hostile
 * Service and relays what the Station knows back to it each day. The engine's
 * Hostile Full Tick builds that day's mole report from `draft.station.reportable`
 * when the mole is at liberty (see `engine/src/lib/hostile/project.ts`): a plain
 * list of {@link Proposition}s the mole passes to the service's belief model,
 * where the step-5 belief-driven adaptation and the Abort Pressure hook read it.
 *
 * The engine cannot compute `reportable` itself — the Case File is Player-View
 * data the engine never reads — so the Player View projects it in at each
 * commit. {@link projectStationReportable} is that projection: a pure function
 * of the committed Draft and the player's Case File that returns the Draft with
 * `station.reportable` rebuilt. The Turn Pipeline calls it in the commit step so
 * the next day's Hostile tick relays what the Station holds as of this turn.
 *
 * ## What the mole relays (Req 3.6)
 *
 * The design names three sources, all resolving to real Propositions the mole
 * can honestly pass back:
 *
 * - **The Station Knowledge Slice** — `station.knowledge.known` (true facts the
 *   Station holds) plus `station.knowledge.falseBeliefs` (what it believes but
 *   that does not hold). Both are what the Station "knows or suspects", which is
 *   what a mole relays.
 * - **The Case File summary** — every held Claim's Proposition. These are the
 *   leads the player has recorded; a mole inside the Station sees them.
 * - **The player's sent trace Cables** — a `trace` Cable names a target entity.
 *   Its contribution is the Propositions, drawn from the first two sources, that
 *   name that target (as subject or object): what the Station knows or the
 *   player has recorded *about a target the player asked HQ to trace* is exactly
 *   what the player's own focus exposes to the mole. Because those Propositions
 *   already come from the Knowledge Slice or a Claim, a trace Cable selects a
 *   subset the full first two sources already contain — so including those two
 *   in full honours the clause, and the Cables need not add Propositions of
 *   their own.
 *
 * The sources are unioned and deduped by {@link Proposition} identity
 * (predicate, subject, object, place, window), so the result is stable and the
 * Hostile tick's `adoptBelief` — which dedupes by the same key — never sees the
 * same belief twice from one report.
 *
 * ## Truth boundary and purity
 *
 * This module reads only Player-View-safe data: the Draft's Station Knowledge
 * Slice (already Truth-free Propositions) and the Case File's held Claims. It
 * never opens the Truth Store and never mints a Proposition of its own — it only
 * relays Propositions that already exist in the Draft or the Case File. It is
 * pure: it returns a new Draft and never mutates its inputs, and the result is a
 * deterministic function of the two.
 */

import type { Proposition, WorldState } from '@tradecraft/engine';

import type { CaseFile } from '../casefile/casefile.js';

/**
 * The stable identity key for a {@link Proposition} in the reportable union:
 * predicate, subject, object, place and window flattened to one string. It
 * matches the engine's belief dedupe key (`beliefKey` in `hostile/beliefs.ts`)
 * so the projection and the tick agree on when two Propositions are "the same".
 */
function propKey(prop: Proposition): string {
  const object =
    typeof prop.object === 'string' ? prop.object : JSON.stringify(prop.object);
  const place = prop.place ?? '';
  const window = prop.window === undefined ? '' : JSON.stringify(prop.window);
  return `${prop.predicate}|${prop.subject}|${object}|${place}|${window}`;
}

/**
 * Rebuild `station.reportable` from the Station Knowledge Slice and the Case
 * File summary (Req 3.6), and return the Draft with the rebuilt list. Pure; does
 * not mutate `draft` or `caseFile`.
 *
 * The Knowledge Slice (`known` + `falseBeliefs`) and every held Claim's
 * Proposition are included in full. The player's sent `trace` Cables select,
 * from those same sources, the Propositions naming each traced target — a subset
 * already present — so including the first two sources in full satisfies the
 * Cable clause of Req 3.6 without the Cables contributing new Propositions. The
 * union is deduped by {@link propKey} and emitted in a stable order (Knowledge
 * Slice `known`, then `falseBeliefs`, then Case File Claims in list order), so
 * the projection is deterministic.
 */
export function projectStationReportable(
  draft: WorldState,
  caseFile: CaseFile,
): WorldState {
  const slice = draft.station.knowledge;

  // The ordered candidate Propositions: the Station Knowledge Slice (known then
  // false beliefs), then the Case File summary (held Claims in list order). The
  // sent trace Cables' targets are already covered here, since a trace Cable can
  // only surface facts that live in one of these two sources.
  const candidates: Proposition[] = [
    ...slice.known,
    ...slice.falseBeliefs,
    ...caseFile.list().map((claim) => claim.prop),
  ];

  // Dedupe by Proposition identity, preserving first-seen order.
  const seen = new Set<string>();
  const reportable: Proposition[] = [];
  for (const prop of candidates) {
    const key = propKey(prop);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    reportable.push(prop);
  }

  return {
    ...draft,
    station: { ...draft.station, reportable },
  };
}
