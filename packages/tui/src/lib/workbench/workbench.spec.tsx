/**
 * Component tests for the Ink Workbench pane (task 22.5; design, "TUI";
 * Requirements 9.5, 9.6, 25.3). These render the real component with
 * ink-testing-library and assert that it shows the Intercept metadata, the
 * frequency table and the shift preview, and that driving the key/plaintext
 * entry through simulated key presses builds the right {@link KeySubmission}
 * and calls `onSubmit`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import {
  caesarShiftPreview,
  frequencyTable,
  type KeySubmission,
  type WorkbenchView,
} from '@tradecraft/player-view';

import { Workbench } from './workbench.js';

// Terminal escape sequences ink decodes into `useInput` key presses.
const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  tab: '\t',
  enter: '\r',
  backspace: '\u007F',
} as const;

/** "HELLO" caesar-shifted forward by 3, so reading back shift 3 recovers it. */
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

/** Advance a tick so ink flushes input-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

afterEach(() => {
  cleanup();
});

describe('Workbench rendering', () => {
  it('shows the Intercept metadata, ciphertext and call sign', () => {
    const { lastFrame } = render(<Workbench view={view} onSubmit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('int:numbers-1');
    expect(frame).toContain('chan:numbers');
    expect(frame).toContain('org:hostile');
    expect(frame).toContain('outbound');
    expect(frame).toContain('NUM1');
    expect(frame).toContain('KHOOR');
  });

  it('surfaces the revealed tradecraft error and header crib', () => {
    const { lastFrame } = render(<Workbench view={view} onSubmit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('fixed header');
    expect(frame).toContain('NR');
  });

  it('renders the frequency table with the letters present in the ciphertext', () => {
    const { lastFrame } = render(<Workbench view={view} onSubmit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    // KHOOR: K,H,R once each; O twice.
    expect(frame).toContain('O:2');
    expect(frame).toContain('K:1');
    expect(frame).toContain('H:1');
    expect(frame).toContain('R:1');
  });

  it('shows the shift preview read back at the selected shift', async () => {
    const { lastFrame, stdin } = render(<Workbench view={view} onSubmit={vi.fn()} />);
    await tick();
    // Step the shift up to 3; the preview recovers HELLO.
    stdin.write(KEY.up);
    stdin.write(KEY.up);
    stdin.write(KEY.up);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('shift 3');
    expect(frame).toContain('HELLO');
  });
});

describe('Workbench submission', () => {
  it('submits a caesar key built from the selected shift', async () => {
    const onSubmit = vi.fn<(s: KeySubmission) => void>();
    const { stdin } = render(<Workbench view={view} onSubmit={onSubmit} />);
    await tick();
    // Default mode is key, kind caesar; raise the shift to 3 and submit.
    stdin.write(KEY.up);
    stdin.write(KEY.up);
    stdin.write(KEY.up);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual<KeySubmission>({
      kind: 'key',
      spec: { kind: 'caesar', shift: 3 },
    });
  });

  it('submits a plaintext guess typed into the entry', async () => {
    const onSubmit = vi.fn<(s: KeySubmission) => void>();
    const { stdin } = render(<Workbench view={view} onSubmit={onSubmit} />);
    await tick();
    // Tab to plaintext mode, type a guess, submit.
    stdin.write(KEY.tab);
    await tick();
    for (const ch of 'HELLO') {
      stdin.write(ch);
    }
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual<KeySubmission>({
      kind: 'plaintext',
      text: 'HELLO',
    });
  });

  it('submits a vigenere key with the typed keyword', async () => {
    const onSubmit = vi.fn<(s: KeySubmission) => void>();
    const { stdin } = render(<Workbench view={view} onSubmit={onSubmit} />);
    await tick();
    // Key mode (default); cycle caesar -> vigenere, type the keyword, submit.
    stdin.write(KEY.right);
    await tick();
    for (const ch of 'LEMON') {
      stdin.write(ch);
    }
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual<KeySubmission>({
      kind: 'key',
      spec: { kind: 'vigenere', key: 'LEMON' },
    });
  });

  it('does not call onSubmit when the entry is incomplete', async () => {
    const onSubmit = vi.fn<(s: KeySubmission) => void>();
    const { stdin } = render(<Workbench view={view} onSubmit={onSubmit} />);
    await tick();
    // Cycle to vigenere with no keyword typed, then press Enter.
    stdin.write(KEY.right);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
