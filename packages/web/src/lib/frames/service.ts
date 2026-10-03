/**
 * The Frame Service (design, "Frame service"; Requirement 11).
 *
 * It sits beside the turn path, never in it: a route asks for a frame and
 * returns at once, and a provider's failure, hang or garbage output is caught
 * here and never reaches a turn (Requirement 11.7).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NullFrameProvider, type Frame, type FrameRequest, type SceneFrameProvider } from './types.js';

export type FrameEvent =
  | { readonly type: 'frame'; readonly key: string }
  | { readonly type: 'frame-progress'; readonly done: number; readonly total: number };

const EXT: Record<Frame['mediaType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const TYPE_BY_EXT: Record<string, Frame['mediaType']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export const FRAME_KEY = /^[0-9a-f]{64}$/;
const MAX_FRAME_BYTES = 20 * 1024 * 1024;

/** Whether the bytes begin like the media type claims (garbage is dropped). */
export function looksLike(frame: Frame): boolean {
  const b = frame.bytes;
  if (b.length < 12 || b.length > MAX_FRAME_BYTES) {
    return false;
  }
  switch (frame.mediaType) {
    case 'image/png':
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'image/jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/webp':
      return (
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
      );
  }
}

export interface FrameServiceOptions {
  readonly dir: string;
  readonly provider?: SceneFrameProvider;
  readonly emit: (event: FrameEvent) => void;
  readonly timeoutMs?: number;
  readonly log?: (message: string) => void;
}

export class FrameService {
  private readonly provider: SceneFrameProvider;
  private readonly inFlight = new Set<string>();
  private readonly controller = new AbortController();
  private readonly timeoutMs: number;
  private pending = new Set<Promise<void>>();

  constructor(private readonly options: FrameServiceOptions) {
    this.provider = options.provider ?? NullFrameProvider;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  /** False for the null provider: the page then reserves no space for a frame. */
  get active(): boolean {
    return this.provider !== NullFrameProvider && this.provider.id !== 'null';
  }

  async cached(key: string): Promise<boolean> {
    return (await this.read(key)) !== undefined;
  }

  async read(key: string): Promise<{ bytes: Buffer; mediaType: Frame['mediaType'] } | undefined> {
    if (!FRAME_KEY.test(key)) {
      return undefined;
    }
    for (const ext of Object.keys(TYPE_BY_EXT)) {
      try {
        const bytes = await readFile(join(this.options.dir, `${key}.${ext}`));
        return { bytes, mediaType: TYPE_BY_EXT[ext] as Frame['mediaType'] };
      } catch {
        // try the next extension
      }
    }
    return undefined;
  }

  /** Ask for one frame. Returns at once; the result arrives as a `frame` event. */
  request(req: FrameRequest): void {
    if (!this.active || this.inFlight.has(req.key)) {
      return;
    }
    this.inFlight.add(req.key);
    this.track(this.renderOne(req).finally(() => this.inFlight.delete(req.key)));
  }

  /** Prepare a Frame Batch (Requirement 11.5). Returns at once. */
  prepareBatch(batch: readonly FrameRequest[]): void {
    if (!this.active || batch.length === 0) {
      return;
    }
    this.track(this.runBatch(batch));
  }

  /** Stop outstanding work and wait for it to settle (used on shutdown). */
  async close(): Promise<void> {
    this.controller.abort();
    await Promise.allSettled([...this.pending]);
  }

  private track(p: Promise<void>): void {
    const tracked = p.catch(() => undefined).finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  private async runBatch(batch: readonly FrameRequest[]): Promise<void> {
    const total = batch.length;
    let done = 0;
    const report = (d: number, t: number): void => {
      this.options.emit({ type: 'frame-progress', done: d, total: t });
    };
    try {
      if (this.provider.prepare !== undefined) {
        const todo: FrameRequest[] = [];
        for (const r of batch) {
          if (!(await this.cached(r.key))) {
            todo.push(r);
          }
        }
        await this.withTimeout(
          this.provider.prepare(todo, (d, t) => report(d + (total - t), total), this.controller.signal),
          this.timeoutMs * Math.max(1, todo.length),
        );
        report(total, total);
        return;
      }
      for (const r of batch) {
        if (this.controller.signal.aborted) {
          return;
        }
        if (!(await this.cached(r.key))) {
          await this.renderOne(r);
        }
        done += 1;
        report(done, total);
      }
    } catch (cause) {
      this.options.log?.(`frame batch failed: ${describe(cause)}`);
    }
  }

  private async renderOne(req: FrameRequest): Promise<void> {
    try {
      if (await this.cached(req.key)) {
        this.options.emit({ type: 'frame', key: req.key });
        return;
      }
      const frame = await this.withTimeout(
        this.provider.render(req, this.controller.signal),
        this.timeoutMs,
      );
      if (frame === undefined || !looksLike(frame)) {
        return;
      }
      await mkdir(this.options.dir, { recursive: true });
      const path = join(this.options.dir, `${req.key}.${EXT[frame.mediaType]}`);
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, frame.bytes);
      await rename(tmp, path);
      this.options.emit({ type: 'frame', key: req.key });
    } catch (cause) {
      // Never the request body, only the cause (Requirement 13.3).
      this.options.log?.(`frame render failed: ${describe(cause)}`);
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('frame provider timed out')), ms);
      t.unref?.();
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(t);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'unknown error';
}
