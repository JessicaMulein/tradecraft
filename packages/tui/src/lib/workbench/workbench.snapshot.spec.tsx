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
      "Intercept int:numbers-1
      chan:numbers · org:hostile · outbound · 5 chars · NUM1
      header crib: NR
      tradecraft error: fixed header "NR"

      Frequency
      H:1  K:1  O:2  R:1

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
