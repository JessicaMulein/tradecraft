/**
 * Property 16: Preview determinism and gating (content-expansion task 5.10;
 * design, "Correctness Properties"; Preview CLI).
 *
 * **Feature: content-expansion, Property 16.**
 *
 * **Validates: Requirements 14.3, 14.5.**
 *
 * > For any pack set, city, seed, preset and preview kind:
 * > - two runs produce byte-identical output;
 * > - output without `--reveal` contains no truth-branded field, true
 * >   allegiance, MICE value, cipher spec or concealed Proposition (slice
 * >   Property 3 applied to preview output).
 * > (design, Property 16)
 *
 * The Preview CLI renders a generated world through the `player-view`
 * projections and writes plain UTF-8 with `\n` line endings, so a given
 * `(packs, city, seed, preset, kind, reveal, count)` always produces the
 * identical bytes (Req 14.3) — the design's golden previews rest on this. And
 * `--reveal` is the only switch that lets a renderer print the ground truth it
 * otherwise hides: without it the preview shows only projection output
 * (Req 14.5). This property pins both halves against the real core pack, over
 * arbitrary seeds and every preview kind, so it exercises the engine's
 * `generateGame`/`advanceWorld` and the real projections rather than a fixture.
 *
 * The determinism half drives the pure {@link previewText} twice from the one
 * loaded Content Set for the same selection and asserts the two strings are
 * byte-identical (and carry no CR, so the `\n`-only line ending that makes the
 * bytes stable holds). It sweeps `reveal` and `count` too, since the contract is
 * over the whole selection tuple.
 *
 * The gating half is slice Property 3 applied to the preview: it collects the
 * generated world's own ground truth — every unidentified NPC's persona name
 * and its true allegiance org, every NPC's MICE lever values, and the decrypted
 * plaintext of every Intercept — and asserts that none of it appears in the
 * no-`--reveal` output of any kind, while the `--reveal` output of the gated
 * kinds (`npcs`, `intercepts`) does surface it. The oracle recomputes the truth
 * straight from the `WorldState` and the cipher key material (the same seams the
 * reveal renderers use), so a passing run pins the gate against the ground truth
 * rather than against the renderer.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  decryptToFieldMessage,
  resolveCipherSpec,
  revealedSpec,
  revealTruth,
  worldCipherKeyLookup,
  type Intercept,
  type WorldState,
} from '@tradecraft/engine';
import { personLabel } from '@tradecraft/player-view';

import {
  buildPreviewWorld,
  loadPreviewContent,
  needsAdvance,
  previewText,
  PREVIEW_KINDS,
  REVEAL_WARNING,
  type PreviewContent,
  type PreviewKind,
  type PreviewTextOptions,
  type PreviewWorld,
} from './index.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors preview.spec.ts)
// ---------------------------------------------------------------------------

/** The repo root, four directories up from this file. */
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
/** The core pack directory, loaded once and shared by every case. */
const CORE_DIR = join(REPO_ROOT, 'packages', 'content', 'packs', 'core');

/** The loaded core Content Set and side files (slow to load; done once). */
let loaded: PreviewContent;

beforeAll(() => {
  loaded = loadPreviewContent([CORE_DIR], ['core']);
});

/** A varied, non-empty seed set to sweep the generator over. */
const SEEDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo-123',
  'z',
  'q1',
  'seed-99',
] as const;

/**
 * The selection {@link previewText} renders for a seed/kind, with the display
 * flags filled in. The city and preset are fixed to the shipped Core City and
 * `standard` preset — the pack set and city are the Core City Path the loaded
 * fixture provides — and the property sweeps the parts that vary the bytes.
 */
function options(
  seed: string,
  kind: PreviewKind,
  reveal: boolean,
  count: number,
): PreviewTextOptions {
  return { city: 'core', preset: 'standard', seed, kind, count, reveal };
}

/** Build the preview world for a kind (advanced only for the clock kinds). */
function worldFor(seed: string, kind: PreviewKind): PreviewWorld {
  return buildPreviewWorld(loaded, {
    city: 'core',
    preset: 'standard',
    seed,
    advanceDays: needsAdvance(kind),
  });
}

// ---------------------------------------------------------------------------
// Ground-truth oracle (slice Property 3 applied to the preview)
// ---------------------------------------------------------------------------

/**
 * The ground-truth strings the gated preview must hide without `--reveal`: the
 * persona name and true-allegiance org of every NPC the player has not
 * identified at game start, and every NPC's MICE lever values rendered to the
 * full precision a leak would carry. These are exactly the fields the `npcs`
 * reveal renderer prints, read straight from the `WorldState`.
 *
 * Identified NPCs (station staff, the player's own contacts) legitimately show
 * their persona name even without `--reveal`, so their names are not forbidden;
 * the `personLabel` seam tells the two apart the same way the renderer does.
 */
function npcTruthStrings(world: WorldState): {
  hiddenNames: readonly string[];
  trueOrgs: readonly string[];
  miceValues: readonly string[];
} {
  const hiddenNames: string[] = [];
  const trueOrgs: string[] = [];
  const miceValues: string[] = [];
  for (const npc of Object.values(world.npcs)) {
    // Only an NPC whose player label is NOT its persona name is unidentified;
    // its name is ground truth the plain preview must not print.
    if (personLabel(world, npc.id).label !== npc.persona.name) {
      hiddenNames.push(npc.persona.name);
    }
    trueOrgs.push(revealTruth(npc.trueAllegiance).org);
    // MICE levers are full-precision doubles in [0, 1]; only a distinctive
    // (long) decimal is a reliable oracle, since a short value like "0" or "1"
    // collides with crowd counts and Route costs that legitimately appear. A
    // leaked lever carries its full precision, so the long-string guard catches
    // a real leak without a false positive.
    const mice = revealTruth(npc.mice);
    for (const lever of [mice.money, mice.ideology, mice.coercion, mice.ego]) {
      const text = String(lever);
      if (text.length >= 6) {
        miceValues.push(text);
      }
    }
  }
  return { hiddenNames, trueOrgs, miceValues };
}

/**
 * The decrypted plaintext of every Intercept in the world, recovered with the
 * true cipher spec against the world's own cipher key material — exactly what
 * the `intercepts` reveal renderer prints and what the plain preview must hide.
 */
function interceptPlaintexts(world: WorldState): readonly string[] {
  const byId = new Map<string, Intercept>();
  for (const i of Object.values(world.intercepts)) {
    if (!byId.has(i.id)) byId.set(i.id, i);
  }
  for (const t of world.transmissions) {
    if (!byId.has(t.intercept.id)) byId.set(t.intercept.id, t.intercept);
  }
  const cipherKeys = worldCipherKeyLookup(world.meta.seed, world.documents);
  const out: string[] = [];
  for (const intercept of byId.values()) {
    const spec = resolveCipherSpec(revealedSpec(intercept), cipherKeys);
    out.push(decryptToFieldMessage(intercept, spec));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Property 16a — determinism (Req 14.3)
// ---------------------------------------------------------------------------

describe('Property 16: preview determinism (Req 14.3)', () => {
  const seedArb = fc.constantFrom(...SEEDS);
  const kindArb = fc.constantFrom(...PREVIEW_KINDS);
  const revealArb = fc.boolean();
  const countArb = fc.integer({ min: 1, max: 20 });

  it('renders byte-identical output for two runs of the same selection', () => {
    fc.assert(
      fc.property(seedArb, kindArb, revealArb, countArb, (seed, kind, reveal, count) => {
        const opts = options(seed, kind, reveal, count);
        const first = previewText(loaded, opts);
        const second = previewText(loaded, opts);
        // Two runs of the same (packs, city, seed, preset, kind, reveal, count)
        // produce the identical bytes.
        expect(second).toBe(first);
        // The bytes are stable because the output uses only `\n` line endings.
        expect(first).not.toContain('\r');
        // A revealed render carries the warning header; a plain one does not.
        if (reveal) {
          expect(first.startsWith(`${REVEAL_WARNING}\n`)).toBe(true);
        } else {
          expect(first.startsWith(REVEAL_WARNING)).toBe(false);
        }
      }),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16b — gating (Req 14.5)
// ---------------------------------------------------------------------------

describe('Property 16: preview gating hides ground truth without --reveal (Req 14.5)', () => {
  const seedArb = fc.constantFrom(...SEEDS);

  it('the npcs kind lists an unidentified NPC by descriptor, never its persona name, without --reveal', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const world = worldFor(seed, 'npcs').world;
        const { hiddenNames } = npcTruthStrings(world);
        const plain = previewText(loaded, options(seed, 'npcs', false, 50));

        // In the NPC listing — the one kind the player's identification gate
        // governs — an unidentified NPC appears by its physical descriptor, so
        // its persona name must not appear without `--reveal`. (A persona name
        // may legitimately appear in a Document body that names a person; that
        // is view-safe projected content, not the identity gate. So we scope
        // the name gate to the `npcs` kind, where `personLabel` decides the
        // display, exactly as the slice's truth-isolation property scopes it to
        // the scene/people views.)
        for (const name of hiddenNames) {
          expect(plain).not.toContain(name);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('no kind leaks a MICE lever value without --reveal', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        for (const kind of PREVIEW_KINDS) {
          const world = worldFor(seed, kind).world;
          const { miceValues } = npcTruthStrings(world);
          const plain = previewText(loaded, options(seed, kind, false, 50));
          // A MICE lever's full-precision value is ground truth that stands for
          // nothing a player can read; it must not appear in any kind's plain
          // output.
          for (const value of miceValues) {
            expect(plain).not.toContain(value);
          }
        }
      }),
      { numRuns: 20 },
    );
  });

  it('no kind prints the npcs truth line that pairs an NPC with its true allegiance without --reveal', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        for (const kind of PREVIEW_KINDS) {
          const plain = previewText(loaded, options(seed, kind, false, 50));
          // The `--reveal`-only truth line is the one place a preview binds an
          // NPC to its true allegiance (`... — true allegiance <org>`); it must
          // never appear in the plain output of any kind.
          expect(plain).not.toContain('true allegiance');
        }
      }),
      { numRuns: 20 },
    );
  });

  it('no kind leaks an Intercept plaintext without --reveal', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        for (const kind of PREVIEW_KINDS) {
          const world = worldFor(seed, kind).world;
          const plaintexts = interceptPlaintexts(world);
          const plain = previewText(loaded, options(seed, kind, false, 50));
          for (const plaintext of plaintexts) {
            expect(plain).not.toContain(plaintext);
          }
        }
      }),
      { numRuns: 20 },
    );
  });

  it('the gated kinds surface the ground truth they hide only with --reveal', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        // NPCs: an unidentified persona name and a true allegiance org appear
        // with --reveal and not without. Only assert when the world actually
        // has an unidentified NPC (every core world does, but stay honest).
        const npcWorld = worldFor(seed, 'npcs').world;
        const { hiddenNames, trueOrgs } = npcTruthStrings(npcWorld);
        const npcsPlain = previewText(loaded, options(seed, 'npcs', false, 100));
        const npcsReveal = previewText(loaded, options(seed, 'npcs', true, 100));
        fc.pre(hiddenNames.length > 0);
        const leakedName = hiddenNames[0];
        expect(npcsPlain).not.toContain(leakedName);
        expect(npcsReveal).toContain(leakedName);
        // A true allegiance org surfaces under reveal (and the reveal output is
        // never the plain output).
        expect(npcsReveal).not.toBe(npcsPlain);
        expect(trueOrgs.some((org) => npcsReveal.includes(org))).toBe(true);

        // Intercepts: a decrypted plaintext appears with --reveal and not
        // without, when the world has any intercepted traffic.
        const interceptWorld = worldFor(seed, 'intercepts').world;
        const plaintexts = interceptPlaintexts(interceptWorld);
        fc.pre(plaintexts.length > 0);
        const interceptsPlain = previewText(loaded, options(seed, 'intercepts', false, 100));
        const interceptsReveal = previewText(loaded, options(seed, 'intercepts', true, 100));
        expect(plaintexts.some((p) => interceptsReveal.includes(p))).toBe(true);
        for (const p of plaintexts) {
          expect(interceptsPlain).not.toContain(p);
        }
      }),
      { numRuns: 20 },
    );
  });
});
