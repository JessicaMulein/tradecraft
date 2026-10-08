import {
  EntityRegistry,
  type EntityEntry,
  type EntityId,
} from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { checkLeak, type LeakContext } from '../leak-guard/leak-guard.js';
import {
  checkSpecifics,
  type Phase,
  type SpecificsContext,
} from '../specifics-guard/specifics-guard.js';
import {
  streamNarration,
  type NarrationMode,
  type NarrationOptions,
  type StreamRequest,
  type StreamSource,
} from './stream-narration.js';

/**
 * Property 15: Narrator containment.
 *
 * "For any reachable state, action result and fuzzed Narrator output:
 *
 *   - the Narrator prompt references only entities in the player's known set
 *     (unknown persons appear only as descriptors);
 *   - every released Flavour sentence passes both the Leak Guard against the
 *     player's known set and the Specifics Guard against the supplied Fact
 *     Lines and scene descriptor;
 *   - the Truth Store, Case File and Journal fact log are deep-equal to the
 *     same run with narration off."
 *
 * (design.md, Correctness Properties; Validates: Requirements 20.2, 20.3, 20.4,
 * 20.6.)
 *
 * The streaming loop {@link streamNarration} is where the second and third
 * clauses are enforced at the Narrator's output edge. It takes the
 * deterministic Fact Lines, drains a fuzzed Narrator token stream, and releases
 * Flavour one sentence at a time only after the Leak Guard (player's known set)
 * and the Specifics Guard (Fact Lines + scene descriptor) both pass — else it
 * regenerates once and otherwise goes fact-only (Requirements 20.3, 20.4,
 * 20.5). It never feeds Flavour to the extractor, Case File or Journal: the
 * released Flavour is a plainly separate field the fact log never reads
 * (Requirement 20.6).
 *
 * This test sweeps the whole flow across many fuzzed Narrator outputs, Fact
 * Line sets, scene descriptors, known-entity sets and modes, and asserts the
 * containment guarantees Property 15 names at this boundary:
 *
 *   1. Containment of released Flavour. Whatever the Narrator streams, every
 *      sentence that reaches the player passes *both* guards re-checked
 *      independently — no invented name, place, numeral, date or
 *      out-of-knowledge entity ever leaks through (Req 20.3, 20.4). This is the
 *      strong adversary: the fuzzer freely mixes clean prose with leaking
 *      entity names and invented specifics.
 *
 *   2. The fact-only fallback. When no clean Flavour survives two attempts, the
 *      result is `fact-only` with empty Flavour and the Fact Lines intact
 *      (Req 20.5); when the source fails it is `failed`, likewise fact-only.
 *      Either way the player keeps exactly the Fact Lines.
 *
 *   3. All three modes respect containment. `off` never calls the source and
 *      releases no Flavour (Req 20.8); `brief` caps at one sentence; `full`
 *      caps at the frame's three — and in every mode the released Flavour is
 *      guard-clean and the Fact Lines are preserved verbatim.
 *
 *   4. The fact log is independent of narration. The Fact Lines the result
 *      carries are deep-equal to the Fact Lines fed in, for *every* mode and
 *      outcome — the fact surface a Case File / Journal would read is identical
 *      whether narration is full, brief or off (Req 20.6, Property 15's
 *      deep-equal clause at this boundary).
 */

// ---------------------------------------------------------------------------
// Fixtures: a fixed small world of registered entities
// ---------------------------------------------------------------------------

/**
 * Secrets the Leak Guard must protect (`npc:mira`, `loc:safehouse`,
 * `org:hostile`) plus one entity the player may be told about (`npc:viktor`).
 * Each distinctive alias is a word the fuzzer can drop into a sentence to force
 * a leak when the entity is outside the known set.
 */
const entries: EntityEntry[] = [
  {
    id: 'npc:viktor',
    canonicalName: 'Viktor',
    aliases: [{ text: 'Herr Lang', distinctive: true }],
  },
  { id: 'npc:mira', canonicalName: 'Mira', aliases: [] },
  {
    id: 'loc:safehouse',
    canonicalName: 'Lindengasse',
    aliases: [{ text: 'the safehouse', distinctive: true }],
  },
  { id: 'org:hostile', canonicalName: 'Vostok', aliases: [] },
  {
    id: 'evt:fair',
    canonicalName: 'Harvest fair',
    aliases: [{ text: 'Harvest fair', distinctive: true }],
  },
];

const registry = EntityRegistry.from(entries);

/** The ids the fuzzer may choose to put in (or out of) the player's known set. */
const ALL_IDS: readonly EntityId[] = [
  'npc:viktor',
  'npc:mira',
  'loc:safehouse',
  'org:hostile',
  'evt:fair',
];

/**
 * Distinctive surface forms keyed by entity, drawn straight from the registry
 * so the fuzzer's "leaking" fragments match exactly what the Leak Guard scans
 * for. A sentence built from one of these leaks iff its entity is not allowed.
 */
const SURFACE_FORMS: Readonly<Record<EntityId, readonly string[]>> = {
  'npc:viktor': registry.distinctiveAliasesOf('npc:viktor'),
  'npc:mira': registry.distinctiveAliasesOf('npc:mira'),
  'loc:safehouse': registry.distinctiveAliasesOf('loc:safehouse'),
  'org:hostile': registry.distinctiveAliasesOf('org:hostile'),
  'evt:fair': registry.distinctiveAliasesOf('evt:fair'),
};

// ---------------------------------------------------------------------------
// Sentence-fragment generators
// ---------------------------------------------------------------------------

/**
 * Clean descriptive sentences that pass both guards against an empty context:
 * no numerals, no capitalised non-initial tokens, no time-of-day word, no
 * registered entity surface form. These are the "safe Flavour" the Narrator is
 * allowed to produce freely.
 */
const CLEAN_SENTENCES: readonly string[] = [
  'The room is warm and still.',
  'Rain streaks the glass.',
  'A kettle hisses somewhere.',
  'The light is low and grey.',
  'A woman waits by the door.',
  'Smoke drifts across the floor.',
  'The air smells of coffee and damp wool.',
  'Footsteps fade down the corridor.',
];

/** A clean descriptive sentence. */
const cleanSentenceArb = fc.constantFrom(...CLEAN_SENTENCES);

/**
 * A sentence that leaks a specific entity's distinctive alias. Whether it
 * actually trips the Leak Guard depends on whether that entity is in the known
 * set — which the test decides separately — so this is a *candidate* leak.
 */
const leakSentenceArb = fc
  .constantFrom(...ALL_IDS)
  .chain((id) =>
    fc.constantFrom(...SURFACE_FORMS[id]).map((form) => ({
      id,
      text: `A figure that is ${form} slips past.`,
    })),
  );

/**
 * A sentence that invents a specific the Fact Lines never supplied: a bare
 * numeral, a weekday, a clock time or an invented proper name. These always
 * trip the Specifics Guard (none appear in the generated Fact Lines, which are
 * built from a disjoint vocabulary below).
 */
const inventedSpecificSentenceArb = fc.constantFrom(
  'You count 4 figures by the wall.',
  'It is Tuesday afternoon.',
  'You arrive at 9:15 sharp.',
  'A man named Dolokhov nods slowly.',
  'The clock shows seven oclock exactly.',
);

// ---------------------------------------------------------------------------
// Fact Line / scene descriptor generators (a vocabulary disjoint from the
// invented-specific fragments, so the Specifics Guard's verbatim allowance
// never accidentally admits an invented token)
// ---------------------------------------------------------------------------

const factLineArb = fc.constantFrom(
  'You enter the cafe.',
  'You order coffee.',
  'You sit by the window.',
  'You wait for the contact.',
  'You leave the building.',
);

const factLinesArb = fc.array(factLineArb, { minLength: 0, maxLength: 3 });

const descriptorArb = fc.constantFrom(
  '',
  'A dim cafe. Quiet. Rain outside.',
  'A crowded hall. Smoke and low talk.',
);

const phaseArb: fc.Arbitrary<Phase> = fc.constantFrom(
  'morning',
  'afternoon',
  'evening',
  'night',
);

const modeArb: fc.Arbitrary<NarrationMode> = fc.constantFrom('full', 'brief', 'off');

/** A subset of the registered ids to place in the player's known set. */
const knownSetArb = fc.subarray([...ALL_IDS]);

/**
 * A fuzzed Narrator output as an ordered list of sentence fragments mixing
 * clean prose, candidate leaks and invented specifics. Joined with spaces into
 * one Flavour block the loop will split and gate.
 */
const narratorFragmentArb = fc.oneof(
  { weight: 3, arbitrary: cleanSentenceArb.map((text) => ({ kind: 'clean' as const, text })) },
  { weight: 1, arbitrary: leakSentenceArb.map((leak) => ({ kind: 'leak' as const, ...leak })) },
  {
    weight: 1,
    arbitrary: inventedSpecificSentenceArb.map((text) => ({
      kind: 'specific' as const,
      text,
    })),
  },
);

const narratorOutputArb = fc.array(narratorFragmentArb, { minLength: 0, maxLength: 5 });

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * A scripted token-stream source mirroring the sibling spec: each call returns
 * the next scripted candidate chunked a few characters at a time (so the loop
 * proves it reassembles tokens before splitting), and it records the requests
 * it received. When it runs out of candidates it repeats the last one.
 */
function scriptedSource(candidates: readonly string[]): {
  source: StreamSource;
  readonly requests: StreamRequest[];
} {
  const requests: StreamRequest[] = [];
  let index = 0;
  const source: StreamSource = (request) => {
    requests.push(request);
    const text = candidates[Math.min(index, candidates.length - 1)] ?? '';
    index += 1;
    return (async function* chunk(): AsyncGenerator<string> {
      for (let i = 0; i < text.length; i += 3) {
        yield text.slice(i, i + 3);
      }
    })();
  };
  return { source, requests };
}

function leakContext(known: readonly EntityId[]): LeakContext {
  return { registry, allowed: known };
}

function specificsContext(
  factLines: readonly string[],
  sceneDescriptor: string,
  phase: Phase,
): SpecificsContext {
  return { factLines, sceneDescriptor, phase };
}

function buildOptions(
  mode: NarrationMode,
  known: readonly EntityId[],
  factLines: readonly string[],
  sceneDescriptor: string,
  phase: Phase,
): NarrationOptions {
  return {
    mode,
    leak: leakContext(known),
    specifics: specificsContext(factLines, sceneDescriptor, phase),
  };
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 15: Narrator containment (Req 20.2, 20.3, 20.4, 20.6)', () => {
  it('releases only guard-clean Flavour, falls back to fact-only, and keeps the Fact Lines independent of narration across every mode', async () => {
    await fc.assert(
      fc.asyncProperty(
        modeArb,
        knownSetArb,
        factLinesArb,
        descriptorArb,
        phaseArb,
        narratorOutputArb,
        narratorOutputArb,
        async (mode, known, factLines, descriptor, phase, firstOut, retryOut) => {
          const options = buildOptions(mode, known, factLines, descriptor, phase);

          // Two scripted attempts: the first candidate and (if the loop
          // regenerates) the second. Fuzzed independently so a regeneration may
          // itself be dirty, exercising the fact-only fallback.
          const first = firstOut.map((f) => f.text).join(' ');
          const retry = retryOut.map((f) => f.text).join(' ');
          const { source, requests } = scriptedSource([first, retry]);

          const result = await streamNarration(factLines, source, options);

          // --- (4) Fact-log independence: the Fact Lines are deep-equal to the
          // input for every mode and outcome. This is the surface a Case File /
          // Journal reads, and it never changes with narration (Req 20.6).
          expect(result.flavour).not.toBe(factLines); // separate field, not aliased
          expect(result.factLines).toEqual([...factLines]);

          // --- (3) Mode handling.
          if (mode === 'off') {
            // Never calls the source; no Flavour (Req 20.8).
            expect(requests).toHaveLength(0);
            expect(result.status).toBe('off');
            expect(result.flavour).toEqual([]);
            return;
          }

          // full/brief always consult the source at least once, at most twice.
          expect(requests.length).toBeGreaterThanOrEqual(1);
          expect(requests.length).toBeLessThanOrEqual(2);

          // --- (1) Containment: every released sentence passes BOTH guards,
          // re-checked independently of the loop (Req 20.3, 20.4).
          for (const sentence of result.flavour) {
            expect(checkLeak(sentence, options.leak).ok).toBe(true);
            expect(checkSpecifics(sentence, options.specifics).ok).toBe(true);
          }

          // The per-mode release cap holds.
          const cap = mode === 'brief' ? 1 : 3;
          expect(result.flavour.length).toBeLessThanOrEqual(cap);

          // --- (2) Status/Flavour invariant. A `flavour` status means every
          // gated sentence passed cleanly (an empty-but-clean stream settles
          // here too, with no Flavour to show). The fallback statuses —
          // `fact-only` (both attempts tripped) and `failed` (source error) —
          // carry no Flavour at all, and in both the player keeps exactly the
          // Fact Lines (Req 20.5, 16.5).
          if (result.status !== 'flavour') {
            expect(['fact-only', 'failed']).toContain(result.status);
            expect(result.flavour).toEqual([]);
          }

          // Regenerations are bounded to the single allowed retry.
          expect(result.regenerations).toBeGreaterThanOrEqual(0);
          expect(result.regenerations).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('goes fact-only (never leaks) when the Narrator stream fails, preserving the Fact Lines', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<NarrationMode>('full', 'brief'),
        knownSetArb,
        factLinesArb,
        async (mode, known, factLines) => {
          const options = buildOptions(mode, known, factLines, '', 'afternoon');
          const source: StreamSource = () => {
            throw new Error('endpoint unreachable');
          };

          const result = await streamNarration(factLines, source, options);

          expect(result.status).toBe('failed');
          expect(result.flavour).toEqual([]);
          expect(result.factLines).toEqual([...factLines]);
          expect(result.regenerations).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
