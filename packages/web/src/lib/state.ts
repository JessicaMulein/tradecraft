/**
 * The Shell Server's in-memory state (design, "Data Models"). Nothing here is
 * persisted, and none of it is game state: the Access Token and sessions, the
 * current Action References, the turn gate and the frame cache (Requirement
 * 1.5).
 */

import type { Response } from 'express';
import type { EngineApi } from '@tradecraft/player-view';

import { ActionRefTable } from './api/action-refs.js';
import type { TurnGate } from './api/turn.js';
import type { ShellConfig } from './config.js';
import type { FrameService } from './frames/service.js';
import type { CueManifest, CueMap } from '../shared/cue/types.js';

/** Pushes named events to every open `/api/events` stream. */
export class EventBus {
  private readonly clients = new Set<Response>();

  add(res: Response): () => void {
    this.clients.add(res);
    return () => this.clients.delete(res);
  }

  broadcast(event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      res.write(frame);
    }
  }

  closeAll(): void {
    for (const res of this.clients) {
      res.end();
    }
    this.clients.clear();
  }
}

export interface ShellState {
  readonly api: EngineApi;
  readonly config: ShellConfig;
  /** Absolute paths. */
  readonly paths: {
    readonly soundtrackDir: string;
    readonly artDir: string;
    readonly staticDir: string;
    readonly clientDir: string;
  };
  stateVersion: number;
  started: boolean;
  readonly refs: ActionRefTable;
  readonly gate: TurnGate;
  readonly frames: FrameService;
  readonly events: EventBus;
  readonly audio: {
    readonly cueMap: CueMap | undefined;
    readonly manifest: CueManifest;
    readonly allowed: ReadonlySet<string>;
  };
  readonly log: (message: string, cause?: unknown) => void;
}
