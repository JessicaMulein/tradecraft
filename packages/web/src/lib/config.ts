/**
 * The Shell Server's configuration (Requirement 12.2; design, "Data Models").
 *
 * The schema is strict: an unknown key is an error, so a `host` key can never
 * quietly widen the binding (Requirement 2.2). The Shell Server's host is a
 * constant (see `LOOPBACK_HOST` in `./security/constants.ts`) and there is no
 * setting for it.
 */

import { z } from 'zod';

export const AUDIO_FORMATS = ['opus', 'mp3', 'wav'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export const DEFAULT_ART_DIRECTION =
  '1950s Vienna, black-and-white film still, grainy, wide shot';

export const ShellConfigSchema = z.strictObject({
  /** 0 selects a free port, which the launcher prints. */
  port: z.number().int().min(0).max(65535).default(0),
  openBrowser: z.boolean().default(false),
  lockout: z
    .strictObject({
      maxFailures: z.number().int().min(1).default(8),
      windowMs: z.number().int().min(1).default(60_000),
      blockMs: z.number().int().min(1).default(60_000),
    })
    .prefault({}),
  maxBodyBytes: z.number().int().min(1024).max(10_485_760).default(65_536),
  soundtrackDir: z.string().min(1).default('soundtrack'),
  audioFormats: z.array(z.enum(AUDIO_FORMATS)).min(1).default(['opus', 'mp3']),
  /** The directory holding `box_art.jpeg` and `box_art-1-1.jpeg`. */
  artDir: z.string().min(1).default('.'),
  frames: z
    .strictObject({
      dir: z.string().min(1).default('.cache/frames'),
      artDirection: z.string().min(1).default(DEFAULT_ART_DIRECTION),
    })
    .prefault({}),
});

export type ShellConfig = z.infer<typeof ShellConfigSchema>;

/** A located configuration problem, in the format the other configs use. */
export class ShellConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(issues.join('\n'));
    this.name = 'ShellConfigError';
    this.issues = issues;
  }
}

/**
 * Validate a parsed configuration document. Throws {@link ShellConfigError}
 * with one `<path>: <message>` line per issue.
 */
export function parseShellConfig(raw: unknown): ShellConfig {
  const doc = raw === undefined || raw === null ? {} : raw;
  if (typeof doc === 'object' && !Array.isArray(doc) && 'host' in doc) {
    throw new ShellConfigError([
      `host: the Shell Server listens on 127.0.0.1 only; there is no setting for another host (got ${JSON.stringify((doc as Record<string, unknown>)['host'])})`,
    ]);
  }
  const result = ShellConfigSchema.safeParse(doc);
  if (!result.success) {
    throw new ShellConfigError(
      result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}
