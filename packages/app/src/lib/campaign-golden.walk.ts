/**
 * Golden campaign replay (campaign-career task 14.1).
 *
 * Records one two-posting career and replays it. The first posting is played
 * to an arrest, then folded with a surviving asset, one at-large hostile of
 * the posting service, and the mole-hunt clue `mole-access`. HQ hands the
 * asset over and departs for the other city. The second posting is played
 * through the same script. Replay rebuilds each Posting Result from the
 * stored actions and the slice ReplayGateway, then `replayCampaign` must
 * match the checked-in state.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPostingContext,
  campaignContent,
  campaignSources,
  loadCampaignConfig,
  loadCampaignContent,
  postingResultHash,
  replayCampaign,
  step,
  type CampaignChoice,
  type CampaignContent,
  type CampaignLogEntry,
  type CampaignState,
  type CarriedNpc,
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
  parseRecords,
  type CallInput,
  type CallRecord,
  type Gateway,
  type ModelsConfig,
  type RecordSink,
} from '@tradecraft/llm';
import {
  InMemorySaveStore,
  PlayerViewEngine,
  type EngineApi,
  type TurnChunk,
} from '@tradecraft/player-view';

import { createGame } from './composition-root.js';
import { WALK_REPO_ROOT, walkModels, walkScenario } from './game-harness-config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

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

const SEED = 'career-seed';

type StepLog =
  | { readonly kind: 'act'; readonly action: Action }
  | { readonly kind: 'say'; readonly line: string }
  | { readonly kind: 'endScene' };

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
    seed: SEED,
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  };
}

function must<T>(result: { ok: boolean; error?: unknown; value?: T }): T {
  if (!result.ok || result.value === undefined) {
    const error = result.error;
    const reason =
      error !== null && typeof error === 'object' && 'reason' in error
        ? String(error.reason)
        : String(error);
    throw new Error(reason);
  }
  return result.value;
}

function choose(state: CampaignState, choice: CampaignChoice): CampaignState {
  return must(step(state, { kind: 'choice', choice }, content, config));
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

class Tape {
  readonly steps: StepLog[] = [];
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

async function playToEnd(api: EngineApi, briefId: DocId): Promise<StepLog[]> {
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
  const fromClaims = [...new Set(claims.flatMap(locationsNamedBy))];
  const places =
    fromClaims.length > 0
      ? fromClaims
      : api.views
          .map()
          .districts.flatMap((district) => district.locations)
          .map((loc) => loc.id);
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

async function play(api: EngineApi, steps: readonly StepLog[]): Promise<void> {
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

function recogniser(ctx: PostingContext): CarriedNpc {
  return {
    id: 'cp-70',
    archetype: 'hostile-case-officer',
    name: 'Viktor',
    aliases: [],
    persona: {
      name: 'Viktor',
      given: 'Viktor',
      family: 'Viktor',
      library: '',
      culture: 'de',
      gender: 'male',
      voiceTraits: [],
      mannerisms: [],
      background: 'officer',
      openness: 0.5,
    },
    descriptor: 'Viktor',
    allegiance: { true: 'svc-east', apparent: 'svc-east' },
    mice: asTruth({ money: 0, ideology: 1, coercion: 0, ego: 0 }),
    loyalty: 0.4,
    service: ctx.service,
    status: 'at-large',
    seen: [{ posting: ctx.index, city: ctx.city }],
  };
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
  const held = claims
    .filter((claim) => {
      const object = claim.prop.object;
      return known.has(claim.prop.subject) || (typeof object === 'string' && known.has(object));
    })
    .map((claim) => ({
      id: claim.id,
      prop: claim.prop,
      text: claim.prop.predicate,
      relation: claim.relation,
    }));
  const mole =
    index === 0
      ? [
          {
            id: 'mole-access',
            prop: {
              id: 'prop:mole-access',
              subject: 'npc:cp-1',
              predicate: 'KNOWS',
              object: 'org:svc-east',
            },
            text: 'A cable header matches one officer.',
            relation: 'none' as const,
          } as unknown as PostingResult['carry']['heldClaims'][number],
        ]
      : [];
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
      heldClaims: [...held, ...mole],
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
      survivingHostiles: index === 0 ? [recogniser(ctx)] : [],
      assets: surviving.map((asset, assetIndex) => ({
        person: `cp-${100 + assetIndex}` as `cp-${number}`,
        npc: { id: outcome.survivingAssets[assetIndex]?.npc ?? asset.npc },
        rel: { trust: asset.trust },
      })),
      arcClues: index === 0 ? [{ clue: 'mole-access', present: true }] : [],
      service: ctx.service,
      cityId: ctx.city,
    }) as unknown as PostingResult['extract'],
    outcome: { ...outcome, survivingAssets: surviving },
  };
}

function contextFor(state: CampaignState): PostingContext {
  if (state.step.kind !== 'posting') {
    throw new Error('a posting context is built only while a posting is in progress');
  }
  const offer = state.view.offers.find((row) => row.id === state.view.chosen);
  if (offer === undefined) {
    throw new Error('the posting has no chosen offer');
  }
  const ctx = must(buildPostingContext(state, offer, content, { config, weights }));
  if (ctx.seed !== state.step.ctx.seed) {
    throw new Error('the posting context seed does not match the campaign');
  }
  return ctx;
}

async function openPosting(
  ctx: PostingContext,
  gateway: Gateway | undefined,
  steps: readonly StepLog[] | undefined,
): Promise<PostingResult> {
  let outcome: OutcomeRecord | undefined;
  const game = createGame({
    repoRoot: WALK_REPO_ROOT,
    scenario,
    models,
    ...(gateway === undefined ? {} : { gateway }),
    saveStore: new InMemorySaveStore(),
    outcomes: (record) => {
      outcome = record;
    },
    posting: ctx as unknown as SlicePostingContext,
  });
  const view = await game.api.newGame({
    seed: ctx.seed,
    preset: 'easy',
    mole: false,
    narration: 'off',
  });
  if (steps === undefined) {
    await playToEnd(game.api, view.brief.id);
  } else {
    await play(game.api, steps);
  }
  if (outcome === undefined) {
    throw new Error('the posting ended without an outcome record');
  }
  const result = resultOf(game.api, ctx.index, ctx, outcome);
  await game.close();
  return result;
}

async function recordPosting(ctx: PostingContext): Promise<{
  readonly result: PostingResult;
  readonly actions: string;
  readonly recording: string;
}> {
  const sink = new MemorySink();
  const game = createGame({
    repoRoot: WALK_REPO_ROOT,
    scenario,
    models,
    gateway: new RecordingGateway(cannedGateway(models), sink),
    saveStore: new InMemorySaveStore(),
    outcomes: () => undefined,
    posting: ctx as unknown as SlicePostingContext,
  });
  const view = await game.api.newGame({
    seed: ctx.seed,
    preset: 'easy',
    mole: false,
    narration: 'off',
  });
  const steps = await playToEnd(game.api, view.brief.id);
  await game.close();
  const replayed = await openPosting(ctx, new ReplayGateway(models, sink.records), steps);
  return {
    result: replayed,
    actions: JSON.stringify(steps),
    recording: sink.records.map((record) => JSON.stringify(record)).join('\n'),
  };
}

function foldPosting(
  state: CampaignState,
  index: number,
  played: { readonly result: PostingResult; readonly actions: string; readonly recording: string },
): CampaignState {
  return must(
    step(
      state,
      {
        kind: 'posting-result',
        index,
        result: played.result,
        actions: played.actions,
        recording: played.recording,
      },
      content,
      config,
    ),
  );
}

function departNext(state: CampaignState, firstCity: string): CampaignState {
  let current = state;
  let guard = 0;
  while (current.step.kind !== 'posting' && guard < 16) {
    guard += 1;
    const kind = current.step.kind;
    if (kind === 'assets') {
      const pending = current.view.staged.assets;
      if (pending.length === 0) {
        throw new Error('the assets step has nothing to hand over');
      }
      for (const asset of pending) {
        current = choose(current, { kind: 'asset-decision', asset: asset.id, decision: 'handover' });
      }
      continue;
    }
    if (kind === 'offers') {
      const elsewhere = current.view.offers.find((offer) => offer.city !== firstCity);
      if (elsewhere === undefined) {
        throw new Error(`no offer outside ${firstCity}`);
      }
      current = choose(current, { kind: 'accept-offer', offer: elsewhere.id });
      continue;
    }
    if (kind === 'end-offers') {
      current = choose(current, { kind: 'decline-end-offer' });
      continue;
    }
    if (kind === 'prepare') {
      current = choose(current, { kind: 'legend', cover: 'clerk', name: 'Helen' });
      current = choose(current, { kind: 'advance' });
      continue;
    }
    current = choose(current, { kind: 'advance' });
  }
  if (current.step.kind !== 'posting') {
    throw new Error('the second posting never started');
  }
  return current;
}

/** Play the career once and write `log.json` plus `state.json`. */
export async function recordCampaignGolden(dir: string): Promise<void> {
  let state = must(step(undefined, { kind: 'choice', choice: createChoice() }, content, config));
  const first = state.view.offers[0];
  if (first === undefined) {
    throw new Error('missing offer');
  }
  state = choose(state, { kind: 'accept-offer', offer: first.id });
  state = choose(state, { kind: 'legend', cover: 'clerk', name: 'Helen' });
  const offer = state.view.offers.find((row) => row.id === state.view.chosen);
  if (offer === undefined) {
    throw new Error('missing chosen offer');
  }
  const before = must(buildPostingContext(state, offer, content, { config, weights }));
  state = choose(state, { kind: 'advance' });
  const opening = contextFor(state);
  if (JSON.stringify(before) !== JSON.stringify(opening)) {
    throw new Error('posting context changed when the posting started');
  }
  const played = await recordPosting(opening);
  if (played.result.outcome.survivingAssets.length === 0) {
    throw new Error('the first posting kept no asset to hand over');
  }
  state = foldPosting(state, 0, played);
  state = departNext(state, opening.city);
  const second = contextFor(state);
  if (!second.carry.placements.some((row) => row.as === 'recogniser')) {
    throw new Error('the second posting carries no recogniser');
  }
  const again = await recordPosting(second);
  state = foldPosting(state, 1, again);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'log.json'), `${JSON.stringify(state.log)}\n`);
  writeFileSync(join(dir, 'state.json'), `${JSON.stringify(state)}\n`);
}

async function rebuildResult(state: CampaignState, entry: Extract<CampaignLogEntry, { kind: 'posting' }>): Promise<PostingResult> {
  const ctx = contextFor(state);
  if (entry.index === 1 && !ctx.carry.placements.some((row) => row.as === 'recogniser')) {
    throw new Error('the replayed second posting carries no recogniser');
  }
  const steps = JSON.parse(entry.actions) as StepLog[];
  const records = parseRecords(entry.recording, `posting-${entry.index}`);
  return openPosting(ctx, new ReplayGateway(models, records), steps);
}

/**
 * Replay the checked-in log. Each posting is rebuilt through ReplayGateway
 * before `replayCampaign` folds it.
 */
export async function replayCampaignGolden(log: readonly CampaignLogEntry[]): Promise<CampaignState> {
  const results = new Map<number, PostingResult>();
  let state: CampaignState | undefined;
  for (const entry of log) {
    if (entry.kind === 'choice') {
      state = must(step(state, { kind: 'choice', choice: entry.choice }, content, config));
      continue;
    }
    if (state === undefined) {
      throw new Error('a posting was logged before the campaign existed');
    }
    const result = await rebuildResult(state, entry);
    if (postingResultHash(result) !== entry.resultHash) {
      throw new Error(`posting ${entry.index} result hash does not match the log`);
    }
    results.set(entry.index, result);
    state = must(
      step(state, { kind: 'posting-result', index: entry.index, result }, content, config),
    );
  }
  const manifest = log.find((entry) => entry.kind === 'posting');
  if (manifest === undefined || manifest.kind !== 'posting') {
    throw new Error('the campaign log has no posting');
  }
  return replayCampaign(SEED, log, () => content, (entry) => {
    const result = results.get(entry.index);
    if (result === undefined) {
      throw new Error(`posting ${entry.index} was not rebuilt`);
    }
    return result;
  }, { manifest: manifest.manifest, config });
}
