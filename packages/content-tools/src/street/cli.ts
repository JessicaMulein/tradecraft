/**
 * `pnpm content street-data` and `pnpm content street-graph`.
 *
 * Fetch is the only subcommand that uses the network, and only after
 * `--accept-licence` names the source.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import {
  buildAccepted,
  fetchStreetSource,
  fidelityFor,
  loadStreetSources,
  periodPass,
  readWays,
  reviewTiles,
  sourceByName,
  writeBuiltPack,
  writeReviewSheets,
  type OverrideOp,
  type PeriodRecord,
} from './street.js';

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

export async function runStreet(argv: readonly string[], repoRoot: string): Promise<number> {
  const [group, action, ...rest] = argv;
  const sources = loadStreetSources(readFileSync(join(repoRoot, 'config/street-sources.yaml'), 'utf8'));
  if (group === 'street-data' && action === 'fetch') {
    const name = flag(rest, '--source') ?? rest[0];
    const source = name === undefined ? undefined : sourceByName(sources, name);
    if (source === undefined) {
      process.stderr.write('error: name a source from config/street-sources.yaml\n');
      return 1;
    }
    const result = await fetchStreetSource({
      source,
      city: flag(rest, '--city') ?? 'city',
      area: flag(rest, '--area') ?? '',
      acceptLicence: flag(rest, '--accept-licence'),
      outDir: join(repoRoot, 'data/street-sources'),
      now: new Date().toISOString().slice(0, 10),
      get: async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`fetch failed (${response.status})`);
        return response.text();
      },
    });
    process.stdout.write(`${result.notice}\n`);
    if (!result.ok) {
      process.stderr.write(`${result.error}\n`);
      return 1;
    }
    process.stdout.write(`wrote ${result.dir}\n`);
    return 0;
  }
  if (group === 'street-graph' && action === 'build') {
    const dataDir = flag(rest, '--data');
    const out = flag(rest, '--out') ?? join(repoRoot, 'packs/street-ops-local');
    if (dataDir === undefined) {
      process.stderr.write('error: --data is required\n');
      return 1;
    }
    const built = buildAccepted({
      dataDir,
      city: flag(rest, '--city') ?? 'city',
      body: readFileSync(join(dataDir, 'body.txt'), 'utf8'),
      locations: [],
      verifiedArea: [],
    });
    if (!built.ok) {
      process.stderr.write(`${built.error}\n`);
      return 1;
    }
    const ways = readWays(readFileSync(join(dataDir, 'body.txt'), 'utf8'));
    if (ways.length === 0) process.stderr.write('warning: the dataset has no named drivable streets\n');
    const written = writeBuiltPack(built.graph, out);
    process.stdout.write(`${written.attributionPath}\n${written.hash}\n`);
    return 0;
  }
  if (group === 'street-graph' && action === 'period') {
    const names = flag(rest, '--names');
    const graphPath = flag(rest, '--graph');
    const year = Number(flag(rest, '--year'));
    if (names === undefined || graphPath === undefined || Number.isNaN(year)) {
      process.stderr.write('error: --names, --graph and --year are required\n');
      return 1;
    }
    const records = parse(readFileSync(names, 'utf8')) as PeriodRecord[];
    const parsed = parse(readFileSync(graphPath, 'utf8')) as { items?: { segments: { street: string; mapped: boolean }[] }[] };
    const graph = parsed.items?.[0];
    if (graph === undefined) return 1;
    const report = periodPass(graph as never, records, year);
    const fidelity = fidelityFor(report, 0, 1);
    process.stdout.write(`${JSON.stringify({ fidelity, open: report.open, overrides: report.overrides as readonly OverrideOp[] })}\n`);
    return report.open.length === 0 ? 0 : 2;
  }
  if (group === 'street-graph' && action === 'review-sheets') {
    const graphPath = flag(rest, '--graph');
    const out = flag(rest, '--out');
    if (graphPath === undefined || out === undefined) {
      process.stderr.write('error: --graph and --out are required\n');
      return 1;
    }
    const parsed = parse(readFileSync(graphPath, 'utf8')) as { items?: Parameters<typeof reviewTiles>[0][] };
    const graph = parsed.items?.[0];
    if (graph === undefined) return 1;
    const layers = sources.filter((source) => source.kind === 'imagery').map((source) => source.layer ?? source.name);
    const imagery = join(process.cwd(), 'data', 'street-sources', 'imagery');
    const paths = writeReviewSheets(reviewTiles(graph, layers), out, existsSync(imagery) ? imagery : undefined);
    process.stdout.write(`${paths.length} sheets\n`);
    return 0;
  }
  process.stderr.write('error: use street-data fetch or street-graph build|period|review-sheets\n');
  return 1;
}
