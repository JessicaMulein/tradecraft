/**
 * Unit tests for the offline Authoring Aid and promotion (content-expansion
 * task 5.13; design, "Authoring Aid"; Req 16.2, 16.5, 16.6, 16.7, 16.8).
 *
 * These cover the parts task 5.13 implements, all with a MOCKED model client
 * and an in-memory filesystem so no endpoint or disk is touched:
 *
 * - the endpoint refusal/acceptance table (Req 16.7);
 * - the prompt always carrying the Style Guide, the in-period Anachronism
 *   Entries, the Real-Person Blocklist and the Sensitivity Term List (Req 16.6);
 * - a draft written to the Draft Area with a `generated: true` Provenance Record
 *   (Req 16.2) and invalid output written to a `.rejected.json` sidecar;
 * - promote success (lint clean → write with reviewer/time, delete draft) and
 *   failure (lint error → nothing changes), Req 16.5, 16.8.
 */

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  SLICE_KIND_REGISTRATIONS,
  CONTENT_EXPANSION_KIND_REGISTRATIONS,
  type ContentKindRegistration,
} from '@tradecraft/content';

import type { ParsedPack } from '../lint/parsed-files.js';
import type { LintReport } from '../lint/output.js';
import {
  endpointDecision,
  isLocalEndpoint,
  parseAuthoringConfig,
  type AuthoringConfig,
} from './config.js';
import { buildPrompt, collectPromptInputs, schemaForKind } from './prompt.js';
import {
  runAuthorCore,
  type AuthorClient,
  type AuthorClock,
  type AuthorMessage,
  type DraftSink,
} from './author-core.js';
import { buildPromotedFile, runPromoteCore, type PromoteFs } from './promote-core.js';
import { runAuthor, runPromote } from './index.js';

// --- shared fixtures -------------------------------------------------------

const REGISTRY: ContentKindRegistration[] = [
  ...SLICE_KIND_REGISTRATIONS,
  ...CONTENT_EXPANSION_KIND_REGISTRATIONS,
];

const localConfig: AuthoringConfig = {
  endpoint: 'http://localhost:1234/v1',
  model: 'test-model',
  temperature: 0.9,
  maxTokens: 2000,
  allowRemote: false,
};

/** A valid Location Type the model "returns" and the samples use. */
function locationType(id: string): Record<string, unknown> {
  return {
    id,
    public: true,
    allowedActions: ['talk'],
    baseRisk: 0.1,
    allowsDeadDrops: false,
    namePatterns: ['Café {pick:names}'],
    descriptionPool: ['A warm coffee house.'],
    atmosphereTags: ['smoky'],
  };
}

/** An era pack carrying the four quality lists the prompt must include. */
function eraPack(): ParsedPack {
  return {
    dir: '/packs/era',
    id: 'era',
    files: [
      { relPath: 'pack.yaml', parsed: true, content: { id: 'era', version: '1.0.0', contentSchema: 2, role: 'era' } },
      { relPath: 'era.yaml', parsed: true, content: [{ id: 'cold-war', period: { from: 1945, to: 1965 } }] },
      {
        relPath: 'style-guide.yaml',
        parsed: true,
        content: [
          { id: 'terse', appliesTo: ['fact-line'], check: 'max-words', value: 20, message: 'Keep it terse.' },
        ],
      },
      {
        relPath: 'anachronisms.yaml',
        parsed: true,
        content: [
          { term: 'the Wall', pattern: 'the wall', earliest: 1961, note: 'Berlin Wall' },
          { term: 'the internet', pattern: 'internet', earliest: 1990, note: 'way out of period' },
        ],
      },
      {
        relPath: 'blocklist.yaml',
        parsed: true,
        content: [{ name: 'A Real Person', note: 'a notable period individual' }],
      },
      {
        relPath: 'sensitivity.yaml',
        parsed: true,
        content: [{ term: 'a slur', pattern: 'a slur' }],
      },
    ],
  };
}

/** A city pack with one existing Location Type, so the prompt has a sample. */
function cityPack(): ParsedPack {
  return {
    dir: '/packs/city',
    id: 'city-vienna',
    files: [
      { relPath: 'pack.yaml', parsed: true, content: { id: 'city-vienna', version: '1.0.0', contentSchema: 2, role: 'city' } },
      { relPath: 'location-types.yaml', parsed: true, content: [locationType('existing-kaffeehaus')] },
    ],
  };
}

/** A model client that returns a fixed string, recording the messages it saw. */
function fakeClient(response: string): AuthorClient & { readonly seen: AuthorMessage[][] } {
  const seen: AuthorMessage[][] = [];
  return {
    seen,
    async complete(messages) {
      seen.push([...messages]);
      return response;
    },
  };
}

/** An in-memory draft sink. */
function memorySink(): DraftSink & { readonly files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    write(path, contents) {
      files.set(path, contents);
    },
  };
}

const fixedClock: AuthorClock = { now: () => new Date('1953-06-01T09:30:00.000Z') };

/** Read a file from a sink map, asserting both the key and the entry exist. */
function readFrom(files: Map<string, string>, key: string | undefined): string {
  expect(key).toBeDefined();
  const value = files.get(key as string);
  expect(value).toBeDefined();
  return value as string;
}

// --- endpoint check (Req 16.7) ---------------------------------------------

describe('endpoint check — local vs remote (Req 16.7)', () => {
  it('recognises the local hosts', () => {
    expect(isLocalEndpoint('http://localhost:1234/v1')).toBe(true);
    expect(isLocalEndpoint('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLocalEndpoint('http://[::1]:1234/v1')).toBe(true);
    expect(isLocalEndpoint('https://api.example.com/v1')).toBe(false);
    expect(isLocalEndpoint('not a url')).toBe(false);
  });

  it('allows a local endpoint regardless of allowRemote or --remote', () => {
    const cfg = { ...localConfig, allowRemote: false };
    expect(endpointDecision(cfg, false).allowed).toBe(true);
    expect(endpointDecision({ ...cfg, allowRemote: true }, true).allowed).toBe(true);
  });

  it('refuses a remote endpoint when allowRemote is false, whatever --remote', () => {
    const cfg = { ...localConfig, endpoint: 'https://api.example.com/v1', allowRemote: false };
    expect(endpointDecision(cfg, false).allowed).toBe(false);
    expect(endpointDecision(cfg, true).allowed).toBe(false);
  });

  it('refuses a remote endpoint when allowRemote is true but --remote is absent', () => {
    const cfg = { ...localConfig, endpoint: 'https://api.example.com/v1', allowRemote: true };
    expect(endpointDecision(cfg, false).allowed).toBe(false);
  });

  it('allows a remote endpoint only when allowRemote AND --remote are both set', () => {
    const cfg = { ...localConfig, endpoint: 'https://api.example.com/v1', allowRemote: true };
    expect(endpointDecision(cfg, true).allowed).toBe(true);
  });
});

describe('parseAuthoringConfig', () => {
  it('applies the defaults for temperature, maxTokens and allowRemote', () => {
    const cfg = parseAuthoringConfig({ endpoint: 'http://localhost:1234/v1', model: 'm' });
    expect(cfg).toEqual({
      endpoint: 'http://localhost:1234/v1',
      model: 'm',
      temperature: 0.9,
      maxTokens: 2000,
      allowRemote: false,
    });
  });

  it('rejects a config with no endpoint', () => {
    expect(() => parseAuthoringConfig({ model: 'm' })).toThrow(/endpoint/);
  });
});

// --- prompt contents (Req 16.6) --------------------------------------------

describe('prompt building — always includes the four quality lists (Req 16.6)', () => {
  const packs = [eraPack(), cityPack()];

  it('gathers the quality lists and in-period anachronisms only', () => {
    const inputs = collectPromptInputs(packs, 'location-type', REGISTRY);
    expect(inputs.styleGuide).toHaveLength(1);
    expect(inputs.blocklist).toHaveLength(1);
    expect(inputs.sensitivity).toHaveLength(1);
    // "the Wall" (1961) is in 1945–1965; "the internet" (1990) is not.
    expect(inputs.anachronisms.map((a) => a.term)).toEqual(['the Wall']);
    expect(inputs.samples).toHaveLength(1);
    expect(inputs.period).toEqual({ from: 1945, to: 1965 });
  });

  it('threads the lists, the period and the schema into the prompt text', () => {
    const inputs = collectPromptInputs(packs, 'location-type', REGISTRY);
    const { system, user } = buildPrompt(
      { kind: 'location-type', count: 2, brief: 'quiet backstreet cafés' },
      inputs,
    );
    expect(system).toContain('terse'); // style guide
    expect(system).toContain('the wall'); // in-period anachronism pattern
    expect(system).not.toContain('internet'); // out-of-period anachronism excluded
    expect(system).toContain('A Real Person'); // blocklist
    expect(system).toContain('a slur'); // sensitivity
    expect(system).toContain('1945'); // period window
    expect(system).toContain('"type"'); // JSON Schema fragment
    expect(user).toContain('Draft 2 new item(s)');
    expect(user).toContain('quiet backstreet cafés'); // brief
    expect(user).toContain('existing-kaffeehaus'); // sample for de-duplication
  });
});

// --- draft writing (Req 16.2) ----------------------------------------------

describe('runAuthorCore — draft writing with provenance (Req 16.2)', () => {
  const packs = [eraPack(), cityPack()];

  it('writes valid items to the Draft Area with a generated Provenance Record', async () => {
    const client = fakeClient(JSON.stringify({ items: [locationType('new-cafe')] }));
    const sink = memorySink();

    const result = await runAuthorCore({
      config: localConfig,
      remoteFlag: false,
      packs,
      registry: REGISTRY,
      request: { pack: 'city-vienna', kind: 'location-type', count: 1 },
      client,
      sink,
      clock: fixedClock,
    });

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.draftPath).toBe(
      'content-drafts/city-vienna/location-type/1953-06-01T09-30-00-000Z.yaml',
    );

    expect(result.draftPath).toBeDefined();
    const written = parseYaml(readFrom(sink.files, result.draftPath));
    expect(written.provenance).toEqual({
      generated: true,
      model: 'test-model',
      promptHash: result.promptHash,
      generatedAt: '1953-06-01T09:30:00.000Z',
    });
    expect(written.items).toHaveLength(1);
    expect(written.items[0].id).toBe('new-cafe');
  });

  it('writes invalid output to a .rejected.json sidecar and keeps the valid items', async () => {
    const client = fakeClient(
      JSON.stringify({ items: [locationType('ok-cafe'), { id: 'broken' /* missing fields */ }] }),
    );
    const sink = memorySink();

    const result = await runAuthorCore({
      config: localConfig,
      remoteFlag: false,
      packs,
      registry: REGISTRY,
      request: { pack: 'city-vienna', kind: 'location-type', count: 2 },
      client,
      sink,
      clock: fixedClock,
    });

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.draftPath).toBeDefined();
    expect(result.rejectedPath).toBe(`${result.draftPath}.rejected.json`);

    const sidecar = JSON.parse(readFrom(sink.files, result.rejectedPath));
    expect(sidecar.rejected).toHaveLength(1);
    expect(sidecar.rejected[0].item.id).toBe('broken');
    expect(sidecar.model).toBe('test-model');
  });

  it('refuses a remote endpoint before making any call (Req 16.7)', async () => {
    const client = fakeClient('{"items":[]}');
    const sink = memorySink();

    await expect(
      runAuthorCore({
        config: { ...localConfig, endpoint: 'https://api.example.com/v1' },
        remoteFlag: false,
        packs,
        registry: REGISTRY,
        request: { pack: 'city-vienna', kind: 'location-type', count: 1 },
        client,
        sink,
        clock: fixedClock,
      }),
    ).rejects.toThrow(/not on the local machine/);
    expect(client.seen).toHaveLength(0);
    expect(sink.files.size).toBe(0);
  });

  it('throws when the model returns text that is not JSON', async () => {
    await expect(
      runAuthorCore({
        config: localConfig,
        remoteFlag: false,
        packs,
        registry: REGISTRY,
        request: { pack: 'city-vienna', kind: 'location-type', count: 1 },
        client: fakeClient('I cannot comply.'),
        sink: memorySink(),
        clock: fixedClock,
      }),
    ).rejects.toThrow(/invalid JSON/);
  });
});

// --- promote (Req 16.5, 16.8) ----------------------------------------------

/** An in-memory PromoteFs whose lint result is scripted per test. */
function memoryPromoteFs(
  initial: Record<string, string>,
  report: LintReport,
): PromoteFs & {
  readonly store: Map<string, string>;
  readonly deleted: string[];
  mergedSeen?: { target: string; contents: string };
} {
  const store = new Map(Object.entries(initial));
  const deleted: string[] = [];
  const self = {
    store,
    deleted,
    mergedSeen: undefined as { target: string; contents: string } | undefined,
    readFile(path: string): string {
      const v = store.get(path);
      if (v === undefined) {
        throw new Error(`no such file ${path}`);
      }
      return v;
    },
    writeFile(path: string, contents: string): void {
      store.set(path, contents);
    },
    deleteFile(path: string): void {
      store.delete(path);
      deleted.push(path);
    },
    lintWithMerged(target: string, contents: string): LintReport {
      self.mergedSeen = { target, contents };
      return report;
    },
  };
  return self;
}

const cleanReport: LintReport = {
  findings: [],
  suppressions: [],
  summary: { errors: 0, warnings: 0, info: 0 },
};

const errorReport: LintReport = {
  findings: [
    { rule: 'CE-REF', severity: 'error', pack: 'city-vienna', file: 'location-types.yaml', path: 'items[1]', message: 'dangling ref' },
  ],
  suppressions: [],
  summary: { errors: 1, warnings: 0, info: 0 },
};

describe('buildPromotedFile — merge with reviewer provenance (Req 16.5)', () => {
  it('appends draft items and stamps reviewedBy/reviewedAt on the draft provenance', () => {
    const target = `- ${''}`;
    const targetContent = [locationType('existing')];
    const draftContent = {
      provenance: { generated: true, model: 'm', promptHash: 'h', generatedAt: 't' },
      items: [locationType('drafted')],
    };
    void target;

    const { yaml, addedCount, totalCount } = buildPromotedFile(
      targetContent,
      draftContent,
      'Reviewer R',
      '1953-06-01T00:00:00.000Z',
    );
    expect(addedCount).toBe(1);
    expect(totalCount).toBe(2);

    const parsed = parseYaml(yaml);
    expect(parsed.provenance).toEqual({
      generated: true,
      model: 'm',
      promptHash: 'h',
      generatedAt: 't',
      reviewedBy: 'Reviewer R',
      reviewedAt: '1953-06-01T00:00:00.000Z',
    });
    expect(parsed.items.map((i: { id: string }) => i.id)).toEqual(['existing', 'drafted']);
  });
});

describe('runPromoteCore — promote only when the merged set lints clean (Req 16.5, 16.8)', () => {
  const draftYaml =
    'provenance:\n  generated: true\n  model: m\n  promptHash: h\n  generatedAt: t\nitems:\n  - id: drafted\n    public: true\n    allowedActions: [talk]\n    baseRisk: 0.1\n    allowsDeadDrops: false\n    namePatterns: ["Café {pick:names}"]\n    descriptionPool: ["x"]\n    atmosphereTags: [smoky]\n';
  const targetYaml = '- id: existing\n  public: true\n  allowedActions: [talk]\n  baseRisk: 0.1\n  allowsDeadDrops: false\n  namePatterns: ["Café {pick:names}"]\n  descriptionPool: ["x"]\n  atmosphereTags: [smoky]\n';

  it('writes the merged target and deletes the draft on a clean lint', () => {
    const fs = memoryPromoteFs(
      { '/drafts/d.yaml': draftYaml, '/packs/city/location-types.yaml': targetYaml },
      cleanReport,
    );
    const result = runPromoteCore(
      { draftFile: '/drafts/d.yaml', targetFile: '/packs/city/location-types.yaml', reviewer: 'R' },
      fs,
      { now: () => new Date('1953-06-01T00:00:00.000Z') },
    );

    expect(result.promoted).toBe(true);
    if (result.promoted) {
      expect(result.count).toBe(1);
    }
    // The draft is gone and the target now carries reviewer provenance.
    expect(fs.deleted).toContain('/drafts/d.yaml');
    expect(fs.store.has('/drafts/d.yaml')).toBe(false);
    const written = parseYaml(readFrom(fs.store, '/packs/city/location-types.yaml'));
    expect(written.provenance.reviewedBy).toBe('R');
    expect(written.items.map((i: { id: string }) => i.id)).toEqual(['existing', 'drafted']);
  });

  it('changes nothing and returns the findings on a lint error (Req 16.8)', () => {
    const fs = memoryPromoteFs(
      { '/drafts/d.yaml': draftYaml, '/packs/city/location-types.yaml': targetYaml },
      errorReport,
    );
    const result = runPromoteCore(
      { draftFile: '/drafts/d.yaml', targetFile: '/packs/city/location-types.yaml', reviewer: 'R' },
      fs,
    );

    expect(result.promoted).toBe(false);
    if (!result.promoted) {
      expect(result.report.summary.errors).toBe(1);
    }
    // Nothing deleted; the target file is unchanged.
    expect(fs.deleted).toHaveLength(0);
    expect(fs.store.get('/drafts/d.yaml')).toBe(draftYaml);
    expect(fs.store.get('/packs/city/location-types.yaml')).toBe(targetYaml);
  });
});

// --- additional edge cases (task 5.14) -------------------------------------
//
// Task 5.14 is the dedicated test task for the Authoring Aid. The blocks above
// (added in task 5.13) already cover the endpoint table, prompt contents, draft
// writing with provenance, the rejected sidecar and promote success/failure.
// The blocks below fill the remaining gaps the checklist calls out: a draft
// that yields zero valid items, the unknown-kind error, more config defaults
// and validation, the bare-array response path, promotion into a new target
// file, and the two CLIs' argument parsing — all still with a mocked client and
// an in-memory tree.

/** Run `fn` while capturing everything written to stdout and stderr. */
async function captureStdio(
  fn: () => void | Promise<void>,
): Promise<{ out: string; err: string }> {
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: unknown): boolean => {
    out += String(chunk);
    return true;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown): boolean => {
    err += String(chunk);
    return true;
  };
  try {
    await fn();
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = originalOut;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = originalErr;
  }
  return { out, err };
}

// --- a draft with zero valid items -----------------------------------------

describe('runAuthorCore — a draft with no usable items', () => {
  const packs = [eraPack(), cityPack()];

  it('writes nothing when the model returns an empty items array', async () => {
    const client = fakeClient(JSON.stringify({ items: [] }));
    const sink = memorySink();

    const result = await runAuthorCore({
      config: localConfig,
      remoteFlag: false,
      packs,
      registry: REGISTRY,
      request: { pack: 'city-vienna', kind: 'location-type', count: 2 },
      client,
      sink,
      clock: fixedClock,
    });

    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.draftPath).toBeUndefined();
    expect(result.rejectedPath).toBeUndefined();
    // The model was still called, but nothing was written to the Draft Area.
    expect(client.seen).toHaveLength(1);
    expect(sink.files.size).toBe(0);
  });

  it('writes only a sidecar (no draft) when every returned item is invalid', async () => {
    const client = fakeClient(JSON.stringify({ items: [{ id: 'broken' }, { nope: true }] }));
    const sink = memorySink();

    const result = await runAuthorCore({
      config: localConfig,
      remoteFlag: false,
      packs,
      registry: REGISTRY,
      request: { pack: 'city-vienna', kind: 'location-type', count: 2 },
      client,
      sink,
      clock: fixedClock,
    });

    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(2);
    expect(result.draftPath).toBeUndefined();
    expect(result.rejectedPath).toBeDefined();
    expect(sink.files.size).toBe(1);
    const sidecar = JSON.parse(readFrom(sink.files, result.rejectedPath));
    expect(sidecar.rejected).toHaveLength(2);
  });

  it('accepts a bare JSON array response (no { items } envelope)', async () => {
    const client = fakeClient(JSON.stringify([locationType('bare-cafe')]));
    const sink = memorySink();

    const result = await runAuthorCore({
      config: localConfig,
      remoteFlag: false,
      packs,
      registry: REGISTRY,
      request: { pack: 'city-vienna', kind: 'location-type', count: 1 },
      client,
      sink,
      clock: fixedClock,
    });

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
    const written = parseYaml(readFrom(sink.files, result.draftPath));
    expect(written.items[0].id).toBe('bare-cafe');
  });

  it('throws when the model returns a JSON scalar that is neither object nor array', async () => {
    await expect(
      runAuthorCore({
        config: localConfig,
        remoteFlag: false,
        packs,
        registry: REGISTRY,
        request: { pack: 'city-vienna', kind: 'location-type', count: 1 },
        client: fakeClient('42'),
        sink: memorySink(),
        clock: fixedClock,
      }),
    ).rejects.toThrow(/neither an .* object nor an array/);
  });
});

// --- unknown kind (Req 17.2) -----------------------------------------------

describe('unknown kind — refused before any model call', () => {
  const packs = [eraPack(), cityPack()];

  it('schemaForKind throws for a kind not in the registry', () => {
    expect(() => schemaForKind('not-a-real-kind', REGISTRY)).toThrow(/unknown kind/);
  });

  it('runAuthorCore throws for an unknown kind without calling the client', async () => {
    const client = fakeClient('{"items":[]}');
    const sink = memorySink();

    await expect(
      runAuthorCore({
        config: localConfig,
        remoteFlag: false,
        packs,
        registry: REGISTRY,
        request: { pack: 'city-vienna', kind: 'not-a-real-kind', count: 1 },
        client,
        sink,
        clock: fixedClock,
      }),
    ).rejects.toThrow(/unknown kind/);
    expect(client.seen).toHaveLength(0);
    expect(sink.files.size).toBe(0);
  });
});

// --- more config validation (Req 16.5, 16.7) -------------------------------

describe('parseAuthoringConfig — further validation', () => {
  it('keeps explicit values over the defaults', () => {
    const cfg = parseAuthoringConfig({
      endpoint: 'http://127.0.0.1:9/v1',
      model: 'm',
      temperature: 0.2,
      maxTokens: 512,
      allowRemote: true,
    });
    expect(cfg.temperature).toBe(0.2);
    expect(cfg.maxTokens).toBe(512);
    expect(cfg.allowRemote).toBe(true);
  });

  it('rejects an unknown key (the schema is strict)', () => {
    expect(() =>
      parseAuthoringConfig({ endpoint: 'http://localhost/v1', model: 'm', nope: 1 }),
    ).toThrow(/invalid config\/authoring\.yaml/);
  });

  it('rejects a temperature outside 0..2 and a non-integer maxTokens', () => {
    expect(() =>
      parseAuthoringConfig({ endpoint: 'http://localhost/v1', model: 'm', temperature: 5 }),
    ).toThrow(/temperature/);
    expect(() =>
      parseAuthoringConfig({ endpoint: 'http://localhost/v1', model: 'm', maxTokens: 1.5 }),
    ).toThrow(/maxTokens/);
  });

  it('treats a malformed endpoint URL as non-local (fails closed)', () => {
    expect(isLocalEndpoint('localhost:1234')).toBe(false); // no scheme → not a URL host
    const cfg = parseAuthoringConfig({ endpoint: 'http://evil.example', model: 'm' });
    expect(endpointDecision(cfg, true).allowed).toBe(false);
  });
});

// --- promote into a new (missing) target file (Req 16.5) -------------------

describe('runPromoteCore — promoting into a file that does not exist yet', () => {
  const draftYaml =
    'provenance:\n  generated: true\n  model: m\n  promptHash: h\n  generatedAt: t\nitems:\n  - id: drafted\n    public: true\n    allowedActions: [talk]\n    baseRisk: 0.1\n    allowsDeadDrops: false\n    namePatterns: ["Café {pick:names}"]\n    descriptionPool: ["x"]\n    atmosphereTags: [smoky]\n';

  it('treats a missing target as empty and writes just the draft items', () => {
    const fs = memoryPromoteFs({ '/drafts/d.yaml': draftYaml }, cleanReport);
    const result = runPromoteCore(
      { draftFile: '/drafts/d.yaml', targetFile: '/packs/city/new-file.yaml', reviewer: 'R' },
      fs,
      { now: () => new Date('1953-06-01T00:00:00.000Z') },
    );

    expect(result.promoted).toBe(true);
    if (result.promoted) {
      expect(result.count).toBe(1);
    }
    expect(fs.deleted).toContain('/drafts/d.yaml');
    const written = parseYaml(readFrom(fs.store, '/packs/city/new-file.yaml'));
    expect(written.items.map((i: { id: string }) => i.id)).toEqual(['drafted']);
    expect(written.provenance.reviewedBy).toBe('R');
  });
});

// --- CLI argument parsing (author / promote) -------------------------------

describe('runAuthor CLI — argument parsing', () => {
  it('prints usage and returns 0 for --help, touching no config or disk', async () => {
    let code = -1;
    const { out } = await captureStdio(async () => {
      code = await runAuthor({ argv: ['--help'] });
    });
    expect(code).toBe(0);
    expect(out).toContain('Usage: pnpm content author');
    expect(out).toContain('--pack');
  });

  it('rejects an unknown option before reading the config', async () => {
    await expect(runAuthor({ argv: ['--pack', 'p', '--kind', 'location-type', '--bogus'] }))
      .rejects.toThrow(/unknown option "--bogus"/);
  });

  it('requires --pack and --kind', async () => {
    await expect(runAuthor({ argv: ['--kind', 'location-type'] })).rejects.toThrow(/--pack is required/);
    await expect(runAuthor({ argv: ['--pack', 'p'] })).rejects.toThrow(/--kind is required/);
  });

  it('rejects a non-positive --count', async () => {
    await expect(
      runAuthor({ argv: ['--pack', 'p', '--kind', 'location-type', '--count', '0'] }),
    ).rejects.toThrow(/--count must be a positive integer/);
  });

  it('rejects a trailing flag with no value', async () => {
    await expect(
      runAuthor({ argv: ['--pack', 'p', '--kind', 'location-type', '--brief'] }),
    ).rejects.toThrow(/--brief needs a value/);
  });
});

describe('runPromote CLI — argument parsing', () => {
  it('prints usage and returns 0 for --help', async () => {
    let code = -1;
    const { out } = await captureStdio(() => {
      code = runPromote({ argv: ['--help'] });
    });
    expect(code).toBe(0);
    expect(out).toContain('Usage: pnpm content promote');
    expect(out).toContain('--reviewer');
  });

  it('requires a draft file, --into and --reviewer', () => {
    expect(() => runPromote({ argv: ['--into', 'f.yaml', '--reviewer', 'R'] })).toThrow(
      /a draft file is required/,
    );
    expect(() => runPromote({ argv: ['d.yaml', '--reviewer', 'R'] })).toThrow(/--into is required/);
    expect(() => runPromote({ argv: ['d.yaml', '--into', 'f.yaml'] })).toThrow(
      /--reviewer is required/,
    );
  });

  it('rejects an unknown --profile value', () => {
    expect(() =>
      runPromote({ argv: ['d.yaml', '--into', 'f.yaml', '--reviewer', 'R', '--profile', 'wild'] }),
    ).toThrow(/--profile must be "draft" or "release"/);
  });

  it('rejects a second positional argument', () => {
    expect(() =>
      runPromote({ argv: ['d.yaml', 'extra.yaml', '--into', 'f.yaml', '--reviewer', 'R'] }),
    ).toThrow(/unexpected extra argument "extra\.yaml"/);
  });
});
