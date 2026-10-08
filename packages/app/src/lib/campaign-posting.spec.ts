/**
 * Posting lifecycle (campaign-career task 12.2).
 *
 * A campaign is created through the Campaign API. The first posting is played
 * to an end twice: once to record the model calls, then again through
 * ReplayGateway with the same actions. HQ then hands the surviving asset over,
 * buys a requisition, and starts a second posting in another city.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPostingContext,
  campaignContent,
  campaignSources,
  loadCampaignConfig,
  loadCampaignContent,
  step,
  type CampaignChoice,
  type CampaignContent,
  type PostingContext,
  type PostingResult,
  type RecruitmentWeights,
} from '@tradecraft/campaign';
import {
  ScenarioConfigSchema,
  asTruth,
  isAsset,
  revealedSpec,
  type Action,
  type DocId,
  type InterceptId,
  type KeySubmission,
  type LocId,
  type NpcId,
  type OutcomeRecord,
  type PostingContext as SlicePostingContext,
} from '@tradecraft/engine';
import {
  RecordingGateway,
  ReplayGateway,
  describeCall,
  type CallInput,
  type CallRecord,
  type Gateway,
  type ModelsConfig,
  type RecordSink,
} from '@tradecraft/llm';
import {
  InMemorySaveStore,
  PlayerViewEngine,
  createCampaignApi,
  type CampaignRuntime,
  type EngineApi,
  type TurnChunk,
} from '@tradecraft/player-view';
import { afterEach, describe, expect, it } from 'vitest';

import { createGame } from './composition-root.js';
import { WALK_REPO_ROOT, walkModels, walkScenario } from './game-harness-config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');
const PERSONAL_FILE = 'doc:dossier/personal-file';

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const sources = campaignSources([CORE], new Set(['core'])).sources;
const content = withCities(campaignContent(loaded.value, sources));
const loadedConfig = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!loadedConfig.ok) {
  throw new Error(loadedConfig.issues.map((issue) => issue.message).join('; '));
}
const config = loadedConfig.value;

const weights: RecruitmentWeights = {
  pitch: { w1: 20, w2: 1, w3: 0, w4: 0 },
  firstContact: { a: 1, b: 1, c: 1, d: 1 },
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
  exposure: { k1: 1, k2: 1, k3: 1 },
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
};

const models = walkModels();
const scenario = ScenarioConfigSchema.parse({
  ...walkScenario('easy'),
  mole: false,
  narration: 'off',
  recruitment: weights,
});

type Step =
  | { readonly kind: 'act'; readonly action: Action }
  | { readonly kind: 'say'; readonly line: string }
  | { readonly kind: 'endScene' };

interface PreparedPosting {
  readonly records: readonly CallRecord[];
  readonly steps: readonly Step[];
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function withCities(campaign: CampaignContent): CampaignContent {
  const city = (id: string, name: string) =>
    ({
      def: {
        id,
        name,
        period: { from: 1948, to: 1962 },
        languages: [{ id: 'german' }],
        services: ['svc-east'],
      },
      covers: [{ id: 'clerk' }],
    }) as unknown as CampaignContent['set']['cities'][string];
  return {
    ...campaign,
    set: {
      ...campaign.set,
      cities: { east: city('east', 'East'), west: city('west', 'West') },
    },
  };
}

function createChoice(): Extract<CampaignChoice, { kind: 'create' }> {
  return {
    kind: 'create',
    seed: 'career-seed',
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  };
}

function mustState<T extends { ok: boolean }>(
  result: T,
): Extract<T, { ok: true }> {
  if (!result.ok) {
    const reason =
      'error' in result && result.error !== null && typeof result.error === 'object' && 'reason' in result.error
        ? String(result.error.reason)
        : 'career step failed';
    throw new Error(reason);
  }
  return result as Extract<T, { ok: true }>;
}

/** Walk the same opening the API will, so the recording uses its posting seed. */
function openingContext(): PostingContext {
  let state = mustState(step(undefined, { kind: 'choice', choice: createChoice() }, content, config)).value;
  const offer = state.view.offers[0];
  if (offer === undefined) {
    throw new Error('missing offer');
  }
  state = mustState(
    step(state, { kind: 'choice', choice: { kind: 'accept-offer', offer: offer.id } }, content, config),
  ).value;
  state = mustState(
    step(state, { kind: 'choice', choice: { kind: 'legend', cover: 'clerk', name: 'Helen' } }, content, config),
  ).value;
  const chosen = state.view.offers.find((row) => row.id === state.view.chosen);
  if (chosen === undefined) {
    throw new Error('missing chosen offer');
  }
  return mustState(buildPostingContext(state, chosen, content, { config, weights })).value;
}

function sliceContext(ctx: PostingContext): SlicePostingContext {
  return ctx as unknown as SlicePostingContext;
}

class MemorySink implements RecordSink {
  readonly records: CallRecord[] = [];

  append(record: CallRecord): void {
    this.records.push(record);
  }
}

function cannedGateway(configModels: ModelsConfig): Gateway {
  return {
    stream() {
      return (async function* () {
        yield 'Quietly.';
      })();
    },
    structured<T>(
      _role: string,
      _input: CallInput,
      schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
    ): Promise<T> {
      const pitch = schema.safeParse({ intent: 'pitch-ego' });
      if (pitch.success) {
        return Promise.resolve(pitch.data);
      }
      for (const candidate of [{ claims: [] }, { propositions: [] }, {}]) {
        const parsed = schema.safeParse(candidate);
        if (parsed.success) {
          return Promise.resolve(parsed.data);
        }
      }
      return Promise.reject(new Error('the canned gateway has no value for this schema'));
    },
    streamNarration() {
      return {
        async *[Symbol.asyncIterator]() {
          yield 'Quietly.';
        },
        cancel() {
          /* fact-only: nothing to abort */
        },
        firstSentenceSeen: false,
        cancelled: false,
      };
    },
    describeCall(kind, role, input, schema) {
      return describeCall(configModels, kind, role, input, schema);
    },
  };
}

async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const chunks: TurnChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function ended(chunks: readonly TurnChunk[]): boolean {
  return chunks.some((chunk) => chunk.kind === 'ended');
}

function hasAsset(api: EngineApi): boolean {
  const world = (api as PlayerViewEngine).state;
  return Object.values(world.relationships).some((rel) => rel !== undefined && isAsset(rel));
}

function localPredicate(predicate: string): string {
  return predicate.slice(predicate.lastIndexOf('/') + 1);
}

function locationsNamedBy(claim: { prop: { place?: LocId; object?: unknown } }): LocId[] {
  const out: LocId[] = [];
  if (claim.prop.place !== undefined) {
    out.push(claim.prop.place);
  }
  if (typeof claim.prop.object === 'string' && claim.prop.object.startsWith('loc:')) {
    out.push(claim.prop.object as LocId);
  }
  return out;
}

/** Records every catalogue action, line and scene close while a posting is played. */
class Tape {
  readonly steps: Step[] = [];
  over = false;

  constructor(readonly api: EngineApi) {}

  offered(pick: (action: Action) => boolean): Action | undefined {
    return this.api.actions().find((row) => row.quote.allowed && pick(row.action))?.action;
  }

  async play(action: Action): Promise<void> {
    this.steps.push({ kind: 'act', action });
    if (ended(await drain(this.api.act(action)))) {
      this.over = true;
    }
  }

  async say(line: string): Promise<void> {
    this.steps.push({ kind: 'say', line });
    if (ended(await drain(this.api.say(line)))) {
      this.over = true;
    }
  }

  async endScene(): Promise<void> {
    this.steps.push({ kind: 'endScene' });
    if (ended(await drain(this.api.endScene()))) {
      this.over = true;
    }
  }

  async wait(phases: 1 | 2 | 3 | 4): Promise<void> {
    const action = this.offered((row) => row.kind === 'wait' && row.phases === phases);
    if (action === undefined) {
      throw new Error(`the catalogue offers no ${phases}-phase wait`);
    }
    await this.play(action);
  }

  async travelTo(to: LocId): Promise<boolean> {
    for (let waited = 0; waited < 5 && !this.over; waited += 1) {
      if (this.api.status().location.id === to) {
        return true;
      }
      const option = this.api.actions().find(
        (row) =>
          row.action.kind === 'travel' &&
          row.action.to === to &&
          row.action.countersurveillance === false,
      );
      if (option === undefined) {
        return false;
      }
      if (option.quote.allowed) {
        await this.play(option.action);
        return !this.over;
      }
      await this.wait(1);
    }
    return this.api.status().location.id === to;
  }

  async read(doc: DocId): Promise<void> {
    const action = this.offered((row) => row.kind === 'read' && row.doc === doc);
    if (action === undefined) {
      throw new Error(`the catalogue offers no read of ${doc}`);
    }
    await this.play(action);
  }
}

function solveIntercept(api: EngineApi, id: InterceptId): KeySubmission {
  const intercept = (api as PlayerViewEngine).state.intercepts[id];
  if (intercept === undefined) {
    throw new Error(`no collected Intercept ${id}`);
  }
  return { kind: 'key', spec: revealedSpec(intercept) };
}

function breakable(api: EngineApi, id: InterceptId): boolean {
  const intercept = (api as PlayerViewEngine).state.intercepts[id];
  if (intercept === undefined) {
    return false;
  }
  const spec = revealedSpec(intercept);
  return spec.kind !== 'otp' || intercept.tradecraftError?.kind === 'pad-reuse';
}

/** Travel until someone can be pitched, and recruit them. */
async function recruit(tape: Tape): Promise<void> {
  const pitched = new Set<string>();
  const visited = new Set<string>();
  for (let attempt = 0; attempt < 48 && !hasAsset(tape.api) && !tape.over; attempt += 1) {
    const scene = (tape.api as PlayerViewEngine).state.player.scene;
    if (scene !== undefined) {
      await tape.say('Come and work for me.');
      if (tape.over || hasAsset(tape.api)) {
        return;
      }
      await tape.endScene();
      continue;
    }
    const talk = tape.offered((row) => row.kind === 'talk' && !pitched.has(row.npc));
    if (talk !== undefined && talk.kind === 'talk') {
      pitched.add(talk.npc);
      await tape.play(talk);
      continue;
    }
    const here = tape.api.status().location.id;
    visited.add(here);
    const travel = tape.offered(
      (row) => row.kind === 'travel' && row.countersurveillance === false && !visited.has(row.to),
    );
    if (travel !== undefined) {
      await tape.play(travel);
      continue;
    }
    visited.clear();
    await tape.wait(1);
  }
  if (!hasAsset(tape.api)) {
    throw new Error('the scripted posting recruited no asset');
  }
}

/**
 * Play one posting to a successful end: read the brief, recruit an asset, then
 * build an arrest the way the scripted win does. Every move is a catalogue
 * action or a dialogue line, so the recording can be replayed verbatim.
 */
async function playToEnd(api: EngineApi, briefId: DocId): Promise<Step[]> {
  const tape = new Tape(api);
  await tape.read(briefId);
  const dossiers = api.views
    .documents()
    .documents.filter((doc) => doc.kind === 'dossier' && !doc.read)
    .map((doc) => doc.id);
  for (const doc of dossiers) {
    if (tape.over) {
      break;
    }
    await tape.read(doc);
  }
  await recruit(tape);
  if (tape.over) {
    return tape.steps;
  }

  const claims = api.caseFile.list({});
  const named =
    claims.find((claim) => localPredicate(claim.prop.predicate) === 'PLANS') ??
    claims.find((claim) => localPredicate(claim.prop.predicate) === 'TARGETS');
  if (named === undefined || !named.prop.subject.startsWith('npc:')) {
    throw new Error('the brief and the dossiers name no one planning the operation');
  }
  const suspect = named.prop.subject as NpcId;
  const fromBrief = claims.filter((claim) => claim.source.kind === 'document' && claim.source.id === briefId);
  const places = [...new Set(fromBrief.flatMap(locationsNamedBy))];
  let watched = 0;
  for (const place of places) {
    if (tape.over) {
      break;
    }
    if ((await tape.travelTo(place)) && tape.offered((row) => row.kind === 'surveil') !== undefined) {
      const surveil = tape.offered((row) => row.kind === 'surveil');
      if (surveil !== undefined) {
        await tape.play(surveil);
        watched += 1;
      }
    }
  }
  if (watched === 0 && !tape.over) {
    throw new Error('no location the leads name could be surveilled');
  }

  const station = api.views
    .map()
    .districts.flatMap((district) => district.locations)
    .find((loc) => loc.type === 'station-hq' || loc.type.endsWith('/station-hq'));
  if (station === undefined) {
    throw new Error('the map shows no station');
  }
  if (!tape.over && !(await tape.travelTo(station.id))) {
    throw new Error('the catalogue offers no way to the station');
  }

  const collected = (): InterceptId | undefined => api.views.intercepts().intercepts[0]?.id;
  const deadline = api.status().time.day + 40;
  while (collected() === undefined && !tape.over) {
    if (api.status().time.day > deadline) {
      throw new Error('no traffic was collected at the station');
    }
    const sweep = tape.offered((row) => row.kind === 'intercept');
    if (sweep === undefined) {
      throw new Error('the catalogue offers no intercept at the station');
    }
    await tape.play(sweep);
    if (collected() === undefined && !tape.over) {
      await tape.wait(3);
    }
  }
  const first = collected();
  if (first !== undefined && !tape.over) {
    const decrypt = tape.offered((row) => row.kind === 'decrypt' && row.intercept === first);
    if (decrypt !== undefined && decrypt.kind === 'decrypt') {
      await tape.play({ ...decrypt, submission: solveIntercept(api, first) });
    }
  }

  const arrestOf = (): Action | undefined =>
    tape.offered((row) => row.kind === 'arrest' && row.npc === suspect);
  if (arrestOf() === undefined && !tape.over) {
    const trace = tape.offered(
      (row) => row.kind === 'cable' && row.body.kind === 'trace' && row.body.target === suspect,
    );
    if (trace !== undefined) {
      const held = new Set(api.views.documents().documents.map((doc) => doc.id));
      await tape.play(trace);
      for (let waited = 0; !tape.over && waited < 8; waited += 1) {
        const replies = api.views
          .documents()
          .documents.filter((doc) => !held.has(doc.id) && !doc.read)
          .map((doc) => doc.id);
        if (replies.length > 0) {
          for (const doc of replies) {
            await tape.read(doc);
          }
          break;
        }
        await tape.wait(1);
      }
    }
  }

  const tried = new Set<InterceptId>(first === undefined ? [] : [first]);
  const workDeadline = api.status().time.day + 40;
  while (arrestOf() === undefined && !tape.over) {
    if (api.status().time.day > workDeadline) {
      throw new Error(`the case against ${suspect} never reached the arrest threshold`);
    }
    const sweep = tape.offered((row) => row.kind === 'intercept');
    if (sweep !== undefined) {
      await tape.play(sweep);
    }
    for (const view of api.views.intercepts().intercepts) {
      if (tape.over || tried.has(view.id) || !breakable(api, view.id)) {
        continue;
      }
      tried.add(view.id);
      const option = tape.offered((row) => row.kind === 'decrypt' && row.intercept === view.id);
      if (option !== undefined && option.kind === 'decrypt') {
        await tape.play({ ...option, submission: solveIntercept(api, view.id) });
      }
    }
    if (arrestOf() === undefined && !tape.over) {
      await tape.wait(4);
    }
  }
  const arrest = arrestOf();
  if (arrest !== undefined && !tape.over) {
    await tape.play(arrest);
  }
  for (let waits = 0; !tape.over && waits < 8; waits += 1) {
    await tape.wait(1);
  }
  if (!tape.over) {
    throw new Error('the posting did not end');
  }
  return tape.steps;
}

async function play(api: EngineApi, steps: readonly Step[]): Promise<void> {
  for (const stepOf of steps) {
    if (stepOf.kind === 'say') {
      await drain(api.say(stepOf.line));
    } else if (stepOf.kind === 'endScene') {
      await drain(api.endScene());
    } else {
      await drain(api.act(stepOf.action));
    }
  }
}

async function recordPosting(ctx: PostingContext): Promise<PreparedPosting> {
  const sink = new MemorySink();
  const game = createGame({
    repoRoot: WALK_REPO_ROOT,
    scenario,
    models,
    gateway: new RecordingGateway(cannedGateway(models), sink),
    saveStore: new InMemorySaveStore(),
    outcomes: () => undefined,
    posting: sliceContext(ctx),
  });
  const view = await game.api.newGame({ seed: ctx.seed, preset: 'easy', mole: false, narration: 'off' });
  const played = await playToEnd(game.api, view.brief.id);
  await game.close();
  return { records: sink.records, steps: played };
}

function resultOf(
  api: EngineApi,
  index: number,
  ctx: PostingContext,
  outcome: OutcomeRecord,
): PostingResult {
  const people = api.views.people().people;
  const claims = api.caseFile.list({});
  const known = new Set<string>(people.map((person) => person.id));
  const surviving = outcome.survivingAssets.map((asset, assetIndex) => ({
    ...asset,
    npc: `npc:cp-${100 + assetIndex}` as `npc:${string}`,
  }));
  const outcomeForCampaign = { ...outcome, survivingAssets: surviving };
  return {
    schema: 1,
    index,
    plotTemplate: outcome.plots?.[0]?.templateId ?? 'rail-junction',
    plots: outcome.plots ?? [],
    stats: {
      decrypts: 0,
      recruits: 0,
      turned: 0,
      surveilObservations: 0,
      followsCompleted: 0,
      arrestsCorrect: 0,
      arrestsWrongful: 0,
      madeFactLines: 0,
      meetingsHeld: 0,
      dropsServiced: 0,
    },
    carry: {
      identified: people
        .filter((person) => person.identified)
        .map((person) => ({
          person: person.id as `npc:${string}`,
          name: person.label,
          aliases: [...person.aliases],
          ...(person.apparentAffiliation === undefined
            ? {}
            : { apparentAffiliation: person.apparentAffiliation }),
        })),
      unidentified: [],
      heldClaims: claims
        .filter((claim) => {
          const object = claim.prop.object;
          return known.has(claim.prop.subject) || (typeof object === 'string' && known.has(object));
        })
        .map((claim) => ({
          id: claim.id,
          prop: claim.prop,
          text: claim.prop.predicate,
          relation: claim.relation,
        })),
      grades: [],
      notes: [],
      observedBurns: [],
    },
    debrief: {
      full: asTruth({
        outcome: outcome.outcome,
        cause: 'plot',
        sections: [{ id: 'plot', text: 'The posting ended.' }],
      }),
      redacted: {
        sections: [{ id: 'plot', items: [{ kind: 'shown', item: { text: 'The posting ended.' } }] }],
      },
    },
    extract: asTruth({
      survivingHostiles: [],
      assets: surviving.map((asset, assetIndex) => ({
        person: `cp-${100 + assetIndex}` as `cp-${number}`,
        npc: { id: outcome.survivingAssets[assetIndex]?.npc ?? asset.npc },
        rel: { trust: asset.trust },
      })),
      arcClues: [],
      service: ctx.service,
      cityId: ctx.city,
    }) as unknown as PostingResult['extract'],
    outcome: outcomeForCampaign,
  };
}

describe('posting lifecycle', () => {
  it(
    'plays a posting through ReplayGateway, hands an asset over, and opens the next city',
    async () => {
      const ctx = openingContext();
      const prepared = await recordPosting(ctx);
      const handed: string[] = [];
      let replayOutcome: OutcomeRecord | undefined;
      const gate: { ready: Promise<void> } = { ready: Promise.resolve() };
      const saveRoot = mkdtempSync(join(tmpdir(), 'campaign-posting-'));
      roots.push(saveRoot);

      const runtime: CampaignRuntime = {
        content,
        config,
        weights,
        saveRoot,
        startPosting(next, snapshot) {
          void snapshot;
          const posting = sliceContext(next);
          const recorded = next.seed === ctx.seed ? prepared : undefined;
          const game = createGame({
            repoRoot: WALK_REPO_ROOT,
            scenario,
            models,
            ...(recorded === undefined
              ? {}
              : { gateway: new ReplayGateway(models, recorded.records) }),
            saveStore: new InMemorySaveStore(),
            outcomes: (record) => {
              replayOutcome = record;
            },
            posting,
          });
          gate.ready = game.api.newGame({
            seed: next.seed,
            preset: 'easy',
            mole: false,
            narration: 'off',
          }).then(() => undefined);
          return game.api;
        },
        finishPosting(api, index) {
          if (replayOutcome === undefined) {
            throw new Error('the posting ended without an outcome record');
          }
          return resultOf(api, index, ctx, replayOutcome);
        },
      };

      const api = createCampaignApi(runtime);
      await api.newCampaign(createChoice());
      const first = api.view().offers[0];
      if (first === undefined) {
        throw new Error('missing offer');
      }
      expect(api.hq.choose({ kind: 'accept-offer', offer: first.id }).ok).toBe(true);
      expect(api.hq.choose({ kind: 'legend', cover: 'clerk', name: 'Helen' }).ok).toBe(true);
      expect(api.hq.choose({ kind: 'advance' }).ok).toBe(true);
      await gate.ready;
      const posting = api.posting();
      if (posting === null) {
        throw new Error('expected the first posting');
      }
      expect(prepared.records.length).toBeGreaterThan(0);
      await play(posting, prepared.steps);
      expect(api.posting()).toBeNull();
      expect(api.view().step).toBe('debrief');

      let guard = 0;
      while (api.view().step !== 'posting' && guard < 12) {
        guard += 1;
        const hq = api.hq.step();
        if (hq.kind === 'assets') {
          const pending = hq.staged.assets;
          expect(pending.length).toBeGreaterThan(0);
          for (const asset of pending) {
            const decided = api.hq.choose({ kind: 'asset-decision', asset: asset.id, decision: 'handover' });
            expect(decided.ok).toBe(true);
            handed.push(asset.id);
          }
          continue;
        }
        if (hq.kind === 'prepare') {
          const bought = api.hq.options().find((option) => option.choice.kind === 'requisition' && option.quote.allowed);
          expect(bought).toBeDefined();
          if (bought !== undefined && bought.choice.kind === 'requisition') {
            expect(api.hq.choose(bought.choice).ok).toBe(true);
          }
          expect(api.hq.choose({ kind: 'legend', cover: 'clerk', name: 'Helen' }).ok).toBe(true);
          expect(api.hq.choose({ kind: 'advance' }).ok).toBe(true);
          continue;
        }
        if (hq.kind === 'offers') {
          const elsewhere = hq.offers.find((offer) => offer.city !== ctx.city);
          if (elsewhere === undefined) {
            throw new Error(`no offer outside ${ctx.city}`);
          }
          expect(api.hq.choose({ kind: 'accept-offer', offer: elsewhere.id }).ok).toBe(true);
          continue;
        }
        expect(api.hq.choose({ kind: 'advance' }).ok || api.hq.choose({ kind: 'decline-end-offer' }).ok).toBe(true);
      }
      expect(handed.length).toBeGreaterThan(0);
      await gate.ready;
      const second = api.posting();
      if (second === null) {
        throw new Error('expected the second posting');
      }
      const documents = second.views.documents().documents;
      const file = documents.find((doc) => doc.id === PERSONAL_FILE);
      expect(file).toBeDefined();
      const before = second.caseFile.list({}).length;
      const read = second.actions().find(
        (row) => row.quote.allowed && row.action.kind === 'read' && row.action.doc === PERSONAL_FILE,
      );
      expect(read).toBeDefined();
      if (read !== undefined) {
        await drain(second.act(read.action));
      }
      const added = second.caseFile.list({}).slice(before);
      const fromFile = added.filter(
        (claim) => claim.source.kind === 'document' && claim.source.id === PERSONAL_FILE,
      );
      expect(fromFile.length).toBeGreaterThan(0);
      const world = (second as PlayerViewEngine).state;
      for (const id of handed) {
        expect(world.npcs[`npc:${id}`]).toBeUndefined();
      }

      const saved = await api.saves.save();
      const loaded = await api.saves.load(saved.id);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.value.officer.name).toBe(api.view().officer.name);
        expect(loaded.value.step).toBe(api.view().step);
        expect(loaded.value.calendar).toEqual(api.view().calendar);
      }
    },
    180_000,
  );
});
