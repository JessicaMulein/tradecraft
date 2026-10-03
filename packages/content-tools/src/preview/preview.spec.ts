/**
 * The Preview CLI (content-expansion task 5.9; design, "Preview CLI";
 * Req 14.1–14.6).
 *
 * These tests pin the Preview CLI against the real core pack (so they exercise
 * the engine's `generate`/`generateGame` and the `player-view` projections, not
 * a fixture): every kind renders non-empty, deterministic text; `--reveal`
 * prepends the warning header and lets the gated kinds show ground truth while
 * the ungated projection output is unchanged; `--count` caps a list kind;
 * `--out` writes a newline-terminated UTF-8 file; and a loader failure (a bad
 * pack set, an unknown city/preset) is reported and exits non-zero. The
 * property that preview output is byte-stable (Property 16) lives in its own
 * file (task 5.10); this file is the example-based coverage.
 *
 * The suite loads the core pack once (generation is the slow part) and shares
 * it across the cases, which stay fast because every renderer is a pure read of
 * the one generated world.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { personLabel } from '@tradecraft/player-view';

import { runCli } from '../cli.js';
import {
  buildPreviewWorld,
  loadPreviewContent,
  needsAdvance,
  previewText,
  PreviewWorldError,
  renderPreview,
  REVEAL_WARNING,
  runPreview,
  type PreviewContent,
  type PreviewKind,
  type PreviewWorld,
} from './index.js';
import { PREVIEW_KINDS, isPreviewKind } from './render.js';

/** The repo root, four directories up from this file. */
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
/** The parent of the shipped packs, which `--dirs` expands to the core pack. */
const PACKS_DIR = join(REPO_ROOT, 'packages', 'content', 'packs');
const CORE_DIR = join(PACKS_DIR, 'core');

const tempRoots: string[] = [];

afterAll(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** A fresh temp directory for an `--out` test. */
function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'tc-preview-'));
  tempRoots.push(root);
  return root;
}

describe('Preview CLI', () => {
  let loaded: PreviewContent;
  /** One generated world per advance mode, shared by the fast per-kind cases. */
  let plain: PreviewWorld;
  let advanced: PreviewWorld;

  beforeAll(() => {
    loaded = loadPreviewContent([CORE_DIR], ['core']);
    plain = buildPreviewWorld(loaded, {
      city: 'core',
      preset: 'standard',
      seed: 'spec-seed',
      advanceDays: false,
    });
    advanced = buildPreviewWorld(loaded, {
      city: 'core',
      preset: 'standard',
      seed: 'spec-seed',
      advanceDays: true,
    });
  });

  /** The right pre-built world for a kind (advanced only for the clock kinds). */
  const worldFor = (kind: PreviewKind): PreviewWorld =>
    needsAdvance(kind) ? advanced : plain;

  // --- every kind renders -------------------------------------------------

  it('renders every kind to non-empty text with \\n line endings', () => {
    for (const kind of PREVIEW_KINDS) {
      const text = renderPreview(kind, worldFor(kind), { reveal: false, count: 10 });
      expect(text.length).toBeGreaterThan(0);
      // Byte-stable text uses only `\n` line endings (Req 14.3): no CR.
      expect(text).not.toContain('\r');
    }
  });

  it('is deterministic for the same inputs (Req 14.3)', () => {
    for (const kind of PREVIEW_KINDS) {
      const a = buildPreviewWorld(loaded, {
        city: 'core',
        preset: 'standard',
        seed: 'det-seed',
        advanceDays: needsAdvance(kind),
      });
      const b = buildPreviewWorld(loaded, {
        city: 'core',
        preset: 'standard',
        seed: 'det-seed',
        advanceDays: needsAdvance(kind),
      });
      expect(renderPreview(kind, a, { reveal: false, count: 15 })).toBe(
        renderPreview(kind, b, { reveal: false, count: 15 }),
      );
    }
  });

  // --- the kinds' content -------------------------------------------------

  it('city summarises Districts and Routes (design)', () => {
    const text = renderPreview('city', plain, { reveal: false, count: 10 });
    expect(text).toContain('Districts');
    expect(text).toContain('Routes');
    expect(text).toContain(plain.world.city.displayName);
  });

  it('npcs hides an unidentified persona name without reveal and shows it with it', () => {
    // Pick an NPC the player has NOT identified at game start: its player label
    // is the physical descriptor, not the persona name. (Station staff and the
    // player's own contacts are identified from the start, so the persona name
    // legitimately appears for them even without `--reveal`.)
    const npc = Object.values(plain.world.npcs)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .find((n) => personLabel(plain.world, n.id).label !== n.persona.name);
    if (npc === undefined) {
      throw new Error('expected at least one unidentified NPC in the core world');
    }

    const plainText = renderPreview('npcs', plain, { reveal: false, count: 100 });
    // The persona name is hidden behind the descriptor until identification, so
    // an unidentified NPC's name must not appear without `--reveal`.
    expect(plainText).not.toContain(npc.persona.name);

    const revealed = renderPreview('npcs', plain, { reveal: true, count: 100 });
    expect(revealed).toContain(npc.persona.name);
    // The true allegiance org is revealed as a plain id, never `[object Object]`.
    expect(revealed).not.toContain('[object Object]');
  });

  it('intercepts shows ciphertext always and plaintext only with reveal (design)', () => {
    const plainText = renderPreview('intercepts', plain, { reveal: false, count: 20 });
    expect(plainText).toContain('ciphertext:');
    expect(plainText).not.toContain('plaintext:');

    const revealed = renderPreview('intercepts', plain, { reveal: true, count: 20 });
    expect(revealed).toContain('ciphertext:');
    expect(revealed).toContain('plaintext:');
  });

  it('dossiers and cables filter the world Documents by kind', () => {
    const dossiers = renderPreview('dossiers', plain, { reveal: false, count: 20 });
    expect(dossiers).toContain('[dossier]');
    expect(dossiers).not.toContain('[cable]');

    const cables = renderPreview('cables', plain, { reveal: false, count: 20 });
    expect(cables).toContain('[cable]');
    expect(cables).not.toContain('[dossier]');
  });

  it('newspaper renders a published edition after the advance', () => {
    const text = renderPreview('newspaper', advanced, { reveal: false, count: 1 });
    expect(text).toContain('Newspaper');
    expect(text).not.toContain('no edition published yet');
  });

  it('fact-lines renders third-person lines for the first days', () => {
    const text = renderPreview('fact-lines', advanced, { reveal: false, count: 10 });
    expect(text).toContain('Fact Lines');
    // At least one rendered line beyond the heading.
    expect(text.split('\n').length).toBeGreaterThan(1);
  });

  // --- --count ------------------------------------------------------------

  it('--count caps a list kind', () => {
    const two = renderPreview('npcs', plain, { reveal: false, count: 2 });
    // The heading plus exactly two item lines (each NPC is one line here).
    const items = two.split('\n').filter((l) => l.startsWith('- '));
    expect(items).toHaveLength(2);
    expect(two).toContain('NPCs (2)');
  });

  // --- --reveal header ----------------------------------------------------

  it('previewText prepends the reveal warning header only with --reveal', () => {
    const withReveal = previewText(loaded, parse(['--kind', 'npcs', '--reveal']));
    expect(withReveal.startsWith(`${REVEAL_WARNING}\n`)).toBe(true);

    const without = previewText(loaded, parse(['--kind', 'npcs']));
    expect(without.startsWith(REVEAL_WARNING)).toBe(false);
  });

  // --- --out --------------------------------------------------------------

  it('--out writes a newline-terminated UTF-8 file with the same bytes as stdout', async () => {
    const dir = tempDir();
    const outPath = join(dir, 'city.txt');

    const stdout: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
      });
    try {
      // Render once to stdout and once to the file, and compare the bytes.
      const toStdout = await runCli([
        'preview',
        '--dirs',
        CORE_DIR,
        '--packs',
        'core',
        '--seed',
        'out-seed',
        '--kind',
        'city',
      ]);
      const toFile = await runCli([
        'preview',
        '--dirs',
        CORE_DIR,
        '--packs',
        'core',
        '--seed',
        'out-seed',
        '--kind',
        'city',
        '--out',
        outPath,
      ]);
      expect(toStdout.exitCode).toBe(0);
      expect(toFile.exitCode).toBe(0);

      const fileBytes = readFileSync(outPath, 'utf8');
      expect(fileBytes.endsWith('\n')).toBe(true);
      // The first stdout chunk is the full city text + newline; the file holds
      // the identical bytes.
      expect(stdout[0]).toBe(fileBytes);
    } finally {
      spy.mockRestore();
    }
  });

  // --- loader / selection errors -> non-zero exit (Req 14.5) --------------

  it('runPreview throws a located error for an unknown preset', () => {
    expect(() =>
      runPreview({
        argv: ['--dirs', CORE_DIR, '--packs', 'core', '--seed', 's', '--kind', 'city', '--preset', 'nope'],
      }),
    ).toThrow(PreviewWorldError);
  });

  it('the CLI shell turns a loader failure into a non-zero exit', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const result = await runCli([
        'preview',
        '--dirs',
        join(REPO_ROOT, 'packages', 'content', 'packs', 'does-not-exist'),
        '--seed',
        's',
        '--kind',
        'city',
      ]);
      expect(result.exitCode).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects an unknown kind at parse time', () => {
    expect(() =>
      runPreview({ argv: ['--dirs', CORE_DIR, '--seed', 's', '--kind', 'bogus'] }),
    ).toThrow(/unknown kind/);
  });

  it('requires --seed and --kind', () => {
    expect(() => runPreview({ argv: ['--kind', 'city'] })).toThrow(/--seed is required/);
    expect(() => runPreview({ argv: ['--seed', 's'] })).toThrow(/--kind is required/);
  });

  it('exposes the preview kinds and recognises them', () => {
    for (const kind of PREVIEW_KINDS) {
      expect(isPreviewKind(kind)).toBe(true);
    }
    expect(isPreviewKind('nope')).toBe(false);
  });
});

/**
 * Parse a preview argv the way the CLI does, for the pure-text cases. It reuses
 * the exported pieces rather than the private parser: `--kind` is validated by
 * {@link isPreviewKind}, and the rest take the CLI's defaults.
 */
function parse(argv: readonly string[]): {
  readonly city: string;
  readonly preset: string;
  readonly seed: string;
  readonly kind: PreviewKind;
  readonly count: number;
  readonly reveal: boolean;
} {
  let kind: PreviewKind = 'city';
  let reveal = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--kind') {
      const value = argv[i + 1] ?? '';
      if (!isPreviewKind(value)) {
        throw new Error(`bad kind ${value}`);
      }
      kind = value;
      i += 1;
    } else if (argv[i] === '--reveal') {
      reveal = true;
    }
  }
  return { city: 'core', preset: 'standard', seed: 'spec-seed', kind, count: 10, reveal };
}
