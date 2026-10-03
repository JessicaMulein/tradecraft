/**
 * `pnpm soundtrack:encode` — encode the WAV masters in `soundtrack/` to Opus
 * files in `soundtrack/web/` (git-ignored) for the web shell. Needs `ffmpeg`
 * with libopus on the PATH. Skips files whose output is newer than the source.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'soundtrack');
const out = join(root, 'web');
mkdirSync(out, { recursive: true });

let failed = 0;
for (const name of readdirSync(root).filter((n) => n.endsWith('.wav')).sort()) {
  const src = join(root, name);
  const dst = join(out, name.replace(/\.wav$/, '.opus'));
  if (existsSync(dst) && statSync(dst).mtimeMs > statSync(src).mtimeMs) continue;
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:a', 'libopus', '-b:a', '128k', dst], { stdio: 'inherit' });
  if (r.status !== 0) { failed += 1; process.stderr.write(`failed: ${name}\n`); } else process.stdout.write(`encoded ${name}\n`);
}
process.exitCode = failed === 0 ? 0 : 1;
