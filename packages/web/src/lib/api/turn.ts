/**
 * The Turn Gate and Turn Recorder (design, "Turn pipeline and recorder";
 * Requirements 5.2, 5.3, 5.5, 8.1, 8.4).
 *
 * The Turn Pipeline is a transaction. The gate therefore runs an `EngineApi`
 * turn to completion in the background, whatever the client does, and records
 * every chunk. A request handler only *follows* the recorder; closing the
 * connection stops following and nothing else.
 */

import type { TurnChunk, TurnStream } from '@tradecraft/player-view';

import type { WebError } from './errors.js';

export type RecorderEvent =
  | { readonly type: 'chunk'; readonly chunk: TurnChunk }
  | { readonly type: 'end'; readonly ok: boolean; readonly error?: WebError };

/** Records one turn's chunks so a client can follow, or replay after a reload. */
export class TurnRecorder {
  private readonly events: RecorderEvent[] = [];
  private finished = false;
  private waiters: (() => void)[] = [];

  constructor(readonly id: number) {}

  push(chunk: TurnChunk): void {
    this.events.push({ type: 'chunk', chunk });
    this.wake();
  }

  end(ok: boolean, error?: WebError): void {
    if (this.finished) {
      return;
    }
    this.events.push({ type: 'end', ok, ...(error !== undefined ? { error } : {}) });
    this.finished = true;
    this.wake();
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** Every event so far. */
  snapshot(): readonly RecorderEvent[] {
    return [...this.events];
  }

  /**
   * Replay from the start, then continue live until the terminal event. The
   * consumer may stop at any time; stopping has no effect on the recording.
   */
  async *follow(): AsyncGenerator<RecorderEvent> {
    let index = 0;
    for (;;) {
      while (index < this.events.length) {
        const event = this.events[index++] as RecorderEvent;
        yield event;
        if (event.type === 'end') {
          return;
        }
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) {
      w();
    }
  }
}

export type TurnKind = 'act' | 'say' | 'end-scene' | 'retry';

export type GateResult =
  | { readonly kind: 'started'; readonly recorder: TurnRecorder; readonly done: Promise<void> }
  | { readonly kind: 'busy' }
  | { readonly kind: 'paused' }
  | { readonly kind: 'not-paused' };

export interface TurnGateOptions {
  /** Called when a turn commits (`done` or `ended`) or fails after starting. */
  readonly onCommit: () => void;
  readonly log?: (message: string, cause?: unknown) => void;
}

/** One turn at a time (Requirement 5.2). */
export class TurnGate {
  private running = false;
  private pausedFlag = false;
  private nextId = 1;
  private last: TurnRecorder | undefined;
  private pausedInfo: { readonly endpoint: string; readonly message: string } | undefined;
  private currentDone: Promise<void> = Promise.resolve();

  constructor(private readonly options: TurnGateOptions) {}

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.pausedFlag;
  }

  get paused(): { readonly endpoint: string; readonly message: string } | undefined {
    return this.pausedInfo;
  }

  get lastTurn(): TurnRecorder | undefined {
    return this.last;
  }

  /** Resolves when no turn is in flight (used on shutdown). */
  idle(): Promise<void> {
    return this.currentDone;
  }

  /** Forget a paused state (a new game or a load replaces the paused turn). */
  reset(): void {
    this.pausedFlag = false;
    this.pausedInfo = undefined;
  }

  run(kind: TurnKind, open: () => TurnStream): GateResult {
    if (this.running) {
      return { kind: 'busy' };
    }
    if (this.pausedFlag && kind !== 'retry') {
      return { kind: 'paused' };
    }
    if (!this.pausedFlag && kind === 'retry') {
      return { kind: 'not-paused' };
    }

    const recorder = new TurnRecorder(this.nextId++);
    this.last = recorder;
    this.running = true;
    const done = this.drive(recorder, open);
    this.currentDone = done;
    return { kind: 'started', recorder, done };
  }

  private async drive(recorder: TurnRecorder, open: () => TurnStream): Promise<void> {
    let committed = false;
    let paused = false;
    try {
      for await (const chunk of open()) {
        recorder.push(chunk);
        if (chunk.kind === 'paused') {
          paused = true;
          this.pausedInfo = chunk.error;
        } else if (chunk.kind === 'done' || chunk.kind === 'ended') {
          committed = true;
        }
      }
      this.pausedFlag = paused;
      if (!paused) {
        this.pausedInfo = undefined;
      }
      recorder.end(true);
    } catch (cause) {
      this.options.log?.('turn failed', cause);
      // A failure mid-stream may have changed state, so references go stale.
      committed = true;
      this.pausedFlag = false;
      this.pausedInfo = undefined;
      recorder.end(false, { code: 'internal' });
    } finally {
      this.running = false;
      if (committed) {
        this.options.onCommit();
      }
    }
  }
}

/** Format one SSE event (design: `event: chunk`, then a terminal `event: end`). */
export function sseFrame(event: RecorderEvent): string {
  if (event.type === 'chunk') {
    return `event: chunk\ndata: ${JSON.stringify(event.chunk)}\n\n`;
  }
  const body: { ok: boolean; error?: WebError } = { ok: event.ok };
  if (event.error !== undefined) {
    body.error = event.error;
  }
  return `event: end\ndata: ${JSON.stringify(body)}\n\n`;
}
