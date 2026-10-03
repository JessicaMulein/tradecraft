/**
 * The Hostile Service's mole report ingestion (design, "Hostile Service AI":
 * `dailyTick` step 3, "Mole report ingestion, if a mole exists"; Requirement
 * 12.4).
 *
 * When the scenario enables the internal mole, one Station staff NPC secretly
 * reports to the Hostile Service (generation stamps the mole's true allegiance
 * and its `REPORTS_TO` / `MEMBER_OF` facts, task 5.5). Each day the mole passes
 * back what the Station knows or suspects, and the service folds that into its
 * belief model — exactly the beliefs the step-5 adaptation (`./adaptation.ts`)
 * and the Abort Pressure hook consume, so a mole is how the service learns the
 * Station is onto the Cell or the target and reroutes/aborts in response.
 *
 * ## This leaf is projection-driven (19.1's pattern)
 *
 * The Station's Knowledge Slice is ground truth owned elsewhere, and the mole's
 * identity is a `WorldState` detail this leaf does not derive. So — exactly as
 * the detection, doubling and adaptation leaves do — the caller projects the
 * report in: who the mole is ({@link MoleReport.mole}) and the Propositions the
 * Station knows/suspects that the mole relays ({@link MoleReport.propositions},
 * already Truth-free Propositions). The leaf never reaches into the Station
 * slice, the Relationship model or the Truth Store; it only folds the projected
 * report into {@link HostileBeliefs}.
 *
 * ## What it owns
 *
 * - {@link ingestMoleReport} — the pure step: for a supplied {@link MoleReport}
 *   it folds each relayed Proposition through {@link adoptBelief} (which dedupes
 *   once per belief key), emits a single hidden `mole-report` event summarising
 *   the day's relay, and a hidden `belief-adopted` event for each Proposition
 *   that was *newly* adopted (an already-held belief emits nothing). It returns
 *   the updated beliefs, the newly-adopted Propositions (so the daily tick can
 *   feed them to step-5 adaptation), and the events.
 *
 * A `report` of `undefined` (no mole in play) is a no-op: unchanged beliefs, no
 * newly-adopted Propositions and no events. A mole that relays nothing still
 * emits the `mole-report` summary event (the mole reported in; it just had
 * nothing new), but adopts nothing.
 *
 * ## Determinism / purity
 *
 * No draws. The relayed Propositions are processed in a stable belief-key order
 * so the newly-adopted list and the `belief-adopted` events are deterministic;
 * the same report and beliefs always yield the same result (Requirement 1.2).
 * The leaf imports only the core model, the state event type and the belief
 * transitions it folds through — it stays Relationship-free,
 * Action-Resolver-free and Truth-Store-free.
 */

import type { GameTime, NpcId, Proposition } from '../model/core.js';
import type { EventId, SimEvent } from '../model/state.js';
import { adoptBelief, beliefKey, type HostileBeliefs } from './beliefs.js';

// ---------------------------------------------------------------------------
// The mole report (the projection)
// ---------------------------------------------------------------------------

/**
 * A day's mole report, projected in by the caller when a mole is in play. The
 * mole is one Station staff NPC whose true allegiance is the Hostile Service;
 * `propositions` are the Station-known/suspected Propositions it relays back.
 * The caller projects these from the Station's Knowledge Slice (the leaf does
 * not own it); an empty `propositions` list is a mole that reported in with
 * nothing new.
 */
export interface MoleReport {
  /** The mole's NPC id (a Station staffer secretly serving the service). */
  readonly mole: NpcId;
  /** The Propositions the Station knows/suspects that the mole relays. */
  readonly propositions: readonly Proposition[];
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/** The result of ingesting a day's mole report. */
export interface MoleReportResult {
  /** The belief model after adopting the report's newly-known Propositions. */
  readonly beliefs: HostileBeliefs;
  /**
   * The Propositions newly adopted this tick (not already held). The daily tick
   * feeds these to the step-5 belief-driven adaptation, so the Cell adapts to
   * what the mole just told the service. Empty when the mole relayed nothing new.
   */
  readonly adopted: readonly Proposition[];
  /** The hidden events: one `mole-report` summary, then a `belief-adopted` per new belief. */
  readonly events: readonly SimEvent[];
}

/** Deterministically mint a mole-report / belief-adopted event id. */
function moleEventId(tag: string, at: GameTime, seq: number): EventId {
  return `hostile-evt:${tag}:${at.day}:${at.phase}:${seq}`;
}

/**
 * The `summary` string a `mole-report` event carries: the mole and how many
 * Propositions it relayed this day. Deterministic and Truth-free (it names the
 * mole's id and counts, no ground-truth payload beyond the hidden event itself).
 */
function reportSummary(mole: NpcId, relayed: number, adopted: number): string {
  return `mole:${mole} relayed:${relayed} adopted:${adopted}`;
}

/**
 * Ingest a day's mole report into the service's belief model (design, step 3;
 * Req 12.4). Pure, no draws.
 *
 * When `report` is `undefined` (no mole enabled) this is a no-op: the beliefs
 * are returned unchanged with no newly-adopted Propositions and no events.
 *
 * Otherwise, for the supplied {@link MoleReport} it:
 *
 * 1. folds each relayed Proposition through {@link adoptBelief}, which adopts a
 *    belief once per {@link beliefKey} — a Proposition the service already holds
 *    adds nothing and is not re-adopted;
 * 2. emits one hidden `mole-report` event summarising the relay (the mole
 *    reported in, even if it relayed nothing new); and
 * 3. emits a hidden `belief-adopted` event for each Proposition that was *newly*
 *    adopted, in the same stable belief-key order the beliefs were folded in.
 *
 * The relayed Propositions are processed in a stable belief-key order (and
 * deduped by key within the day's report) so the newly-adopted list and the
 * `belief-adopted` events are deterministic regardless of the caller's order.
 */
export function ingestMoleReport(
  beliefs: HostileBeliefs,
  report: MoleReport | undefined,
  at: GameTime,
): MoleReportResult {
  // No mole in play: a clean no-op (design: step 3 runs "if a mole exists").
  if (report === undefined) {
    return { beliefs, adopted: [], events: [] };
  }

  // Dedupe the day's own report by belief key and process in a stable key order
  // so the result does not depend on the caller's Proposition ordering.
  const byKey = new Map<string, Proposition>();
  for (const prop of report.propositions) {
    const key = beliefKey(prop);
    if (!byKey.has(key)) {
      byKey.set(key, prop);
    }
  }
  const ordered = [...byKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, prop]) => prop);

  let next = beliefs;
  const adopted: Proposition[] = [];
  for (const prop of ordered) {
    const result = adoptBelief(next, prop);
    next = result.beliefs;
    if (result.adopted) {
      adopted.push(prop);
    }
  }

  // One summary event for the day's relay, then one belief-adopted per new belief.
  const events: SimEvent[] = [];
  let seq = 0;
  events.push({
    id: moleEventId('mole-report', at, seq),
    at,
    visibility: 'hidden',
    kind: 'mole-report',
    summary: reportSummary(report.mole, ordered.length, adopted.length),
  });
  seq += 1;
  for (const prop of adopted) {
    events.push({
      id: moleEventId('belief-adopted', at, seq),
      at,
      visibility: 'hidden',
      kind: 'belief-adopted',
      prop,
    });
    seq += 1;
  }

  return { beliefs: next, adopted, events };
}
