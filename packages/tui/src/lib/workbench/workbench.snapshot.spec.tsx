/**
 * Snapshot tests for the Ink Workbench pane (task 22.9; Requirements 13.2,
 * 13.6). These capture the rendered frame of the Intercept metadata, frequency
 * table, shift preview and the key/plaintext entry, from a fixed, deterministic
 * fixture so the snapshot stays stable. The frequency table and shift preview
 * are composed deterministically from the fixed ciphertext.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import {
  caesarShiftPreview,
  frequencyTable,
  keyCoincidence,
  type WorkbenchView,
} from '@tradecraft/player-view';

import { Workbench } from './workbench.js';

/** "HELLO" caesar-shifted forward by 3. */
const CIPHERTEXT = 'KHOOR';

/** A view-safe Workbench fixture (the `WorkbenchView` shape; carries no truth). */
const view: WorkbenchView = {
  id: 'int:numbers-1',
  channel: 'chan:numbers',
  owner: 'org:hostile',
  direction: 'outbound',
  at: { day: 2, phase: 1 },
  length: CIPHERTEXT.length,
  callsign: 'NUM1',
  ciphertext: CIPHERTEXT,
  frequency: frequencyTable(CIPHERTEXT),
  coincidence: keyCoincidence(CIPHERTEXT),
  shiftPreview: caesarShiftPreview(CIPHERTEXT),
  tradecraftError: { kind: 'fixed-header', header: 'NR' },
  header: 'NR',
};

/**
 * Strip ANSI colour escapes from a rendered frame. ink emits colour codes only
 * when the runner reports colour support, so snapshotting the raw frame would
 * differ between the direct `vitest` run and the `nx`/CI run; the plain text is
 * stable across both.
 */
function plain(frame: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

afterEach(() => {
  cleanup();
});

describe('Workbench snapshot', () => {
  it('renders the metadata, frequency table, shift preview and entry panel', () => {
    const { lastFrame } = render(<Workbench view={view} onSubmit={vi.fn()} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "NUM1
      an unnamed frequency · outbound · 5 chars
      header crib: NR
      tradecraft error: fixed header "NR"

      Frequency
      H:1  K:1  O:2  R:1

      Key length
      whole text 0.100 · 4 0.000  5 0.000  6 0.000  7 0.000
      Near 0.065 is one alphabet: slide the shift. A length that rises is a word of that many letters.
      Trying a word below does not spend a phase.

      Ciphertext
      KHOOR
      Shift preview (shift 0)
      KHOOR

      Submit: key
      cipher: Caesar · shift 0
      ↑/↓ shift · Tab mode · ←/→ cipher · type key/plaintext · Enter to submit"
    `);
  });
});
