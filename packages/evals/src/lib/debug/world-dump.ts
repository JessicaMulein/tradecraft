/**
 * The `world` debug CLI's logic (checkpoint 12; design, "Engine inspection").
 *
 * `renderWorldDump(world, truth, { reveal })` turns a generated {@link
 * WorldState} and its seeded {@link TruthStore} into a human-readable, sectioned
 * text dump — the operator tool a developer reads to see what a seed produced.
 *
 * Two modes, keyed by `reveal`:
 *
 *   - **Player-safe (default)** — only what the player could see: the seed, the
 *     clock, the city, the Starting Brief (cover, chief, known entities, leads),
 *     the public documents and the player's own known channels/drops. Nothing
 *     Truth-branded is unwrapped.
 *   - **`--reveal`** — the full ground truth on top: every NPC's TRUE allegiance
 *     and apparent allegiance, the internal mole and its MICE profile, the Plot
 *     ground truth (leader, target, materiel, stage DAG), the Side-Thread ground
 *     truth, and the noise (background NPCs, side threads, noise-traffic
 *     channels). The Truth-branded fields are unwrapped with {@link revealTruth}
 *     — the one place that is legitimate, because this is an operator dump that
 *     deliberately shows the hidden state, not a Player-View projection.
 *
 * The logic lives here (built, typechecked, tested) so the `scripts/world.ts`
 * wrapper stays a thin arg-parse + stdout shell. The function is pure: it reads
 * the world and truth and returns a string, making no draws and touching no fs.
 */

import {
  phaseName,
  revealTruth,
  type Channel,
  type DocId,
  type GameTime,
  type Literal,
  type NpcId,
  type OrgId,
  type PlotState,
  type Proposition,
  type SideThreadState,
  type TruthStore,
  type WorldState,
} from '@tradecraft/engine';

/** Options for {@link renderWorldDump}. */
export interface WorldDumpOptions {
  /**
   * Reveal the Truth-branded ground truth (true allegiances, the mole + MICE,
   * Plot/Side-Thread ground truth, noise). Default `false` — a player-safe dump.
   */
  readonly reveal?: boolean;
}

/** Format a {@link GameTime} as `day D, <phase>`. */
function formatTime(t: GameTime): string {
  return `day ${t.day}, ${phaseName(t.phase)}`;
}

/** Format a Proposition's object (an entity id or a {@link Literal}). */
function formatObject(object: Proposition['object']): string {
  if (typeof object === 'string') return object;
  const lit = object as Literal;
  if (lit.kind === 'time') return `time(${formatTime(lit.value)})`;
  return `${lit.kind}(${String(lit.value)})`;
}

/** Format a Proposition as `subject --predicate--> object [@place] [window]`. */
function formatProposition(p: Proposition): string {
  const place = p.place === undefined ? '' : ` @${p.place}`;
  const window =
    p.window === undefined
      ? ''
      : ` [${formatTime(p.window.from)}${
          p.window.to === undefined ? '' : ` → ${formatTime(p.window.to)}`
        }]`;
  return `${p.subject} --${p.predicate}--> ${formatObject(p.object)}${place}${window}`;
}

/** A `== Heading ==` section banner. */
function heading(title: string): string {
  return `== ${title} ==`;
}

/** Join a set of lines under a heading, dropping empties at the edges. */
function section(title: string, lines: readonly string[]): string {
  return [heading(title), ...lines].join('\n');
}

/** The Document a given DocId resolves to, or `undefined`. */
function docTitle(world: WorldState, id: DocId): string {
  const doc = world.documents[id];
  return doc === undefined ? id : `${doc.title} (${id})`;
}

// ---------------------------------------------------------------------------
// Player-safe sections
// ---------------------------------------------------------------------------

/** The header: seed, generator version, clock, preset, mole flag. */
function headerSection(world: WorldState): string {
  return section('World', [
    `seed:              ${world.meta.seed}`,
    `generatorVersion:  ${world.meta.generatorVersion}`,
    `preset:            ${world.meta.preset.id}`,
    `time:              ${formatTime(world.time)}`,
    `mole enabled:      ${world.meta.scenario.mole ? 'yes' : 'no'}`,
    `ended:             ${world.ended === undefined ? 'no' : world.ended.outcome}`,
  ]);
}

/** The city: districts and locations. */
function citySection(world: WorldState): string {
  const districts = Object.values(world.city.districts);
  const locations = Object.values(world.city.locations);
  const lines = [
    `districts: ${districts.length}`,
    `locations: ${locations.length}`,
    ...locations.map((loc) => `  ${loc.id} — ${loc.name} [${loc.type}]`),
  ];
  return section('City', lines);
}

/**
 * The Starting Brief, reconstructed from the player-visible world: the Cover
 * Identity, the Chief of Station, the brief Cable, the known entities, the
 * player's known channels/drops, the starting Budget and the Dossiers. This is
 * exactly the opening HQ package (design, "Starting Brief"); it carries no truth.
 */
function startingBriefSection(world: WorldState): string {
  const cover = world.player.cover;
  const dossiers = Object.values(world.documents)
    .filter((d) => d.kind === 'dossier')
    .map((d) => `  ${d.title} (${d.id})`);
  const briefCable = Object.values(world.documents).find((d) => d.kind === 'cable');
  return section('Starting Brief', [
    `cover:          ${cover.title} @ ${cover.employerOrg} [${cover.id}]`,
    `cover fits:     ${cover.fitLocationTypes.join(', ')}`,
    `chief:          ${world.station.chief}`,
    `brief cable:    ${briefCable === undefined ? '(none)' : docTitle(world, briefCable.id)}`,
    `start location: ${world.player.loc}`,
    `known entities: ${world.player.known.entities.length}`,
    `  ${world.player.known.entities.join(', ') || '(none)'}`,
    `known channels: ${world.player.known.channels.join(', ') || '(none)'}`,
    `known drops:    ${world.player.known.drops.join(', ') || '(none)'}`,
    `starting contacts: ${world.player.contacts.join(', ') || '(none)'}`,
    `dossiers:       ${dossiers.length}`,
    ...dossiers,
  ]);
}

/** Public documents the player can read, by kind. */
function documentsSection(world: WorldState): string {
  const docs = Object.values(world.documents);
  const lines = docs.map(
    (d) => `  [${d.kind}] ${d.title} (${d.id})${d.obtainableAt ? ` @ ${d.obtainableAt.join(', ')}` : ''}`,
  );
  return section('Documents', [`count: ${docs.length}`, ...lines]);
}

// ---------------------------------------------------------------------------
// Reveal-only sections (ground truth)
// ---------------------------------------------------------------------------

/**
 * The apparent-allegiance category an org projects, used to tell a true
 * allegiance apart from the category the NPC presents. An org the world does not
 * carry (should not happen) maps to the raw org id.
 */
function orgCategory(world: WorldState, org: OrgId): string {
  const record = world.orgs[org];
  if (record !== undefined) return record.allegiance;
  // The Background-NPC neutral sentinel (`org:none`) is not a generated org; it
  // reads as "no organisation", i.e. the `neutral` apparent category.
  return org === 'org:none' ? 'neutral' : org;
}

/** Every NPC's TRUE vs apparent allegiance. */
function allegiancesSection(world: WorldState): string {
  const npcs = Object.values(world.npcs);
  const lines = npcs.map((npc) => {
    const trueOrg = revealTruth(npc.trueAllegiance).org;
    const trueCategory = orgCategory(world, trueOrg);
    // A cover/double is an NPC whose true org projects a different category than
    // the one they present to the player.
    const flag = trueCategory === npc.apparentAllegiance ? '' : '  <-- COVER / DOUBLE';
    return `  ${npc.id} (${npc.persona.name}) — true=${trueOrg} apparent=${npc.apparentAllegiance}${flag}`;
  });
  return section('TRUTH · Allegiances', [`npcs: ${npcs.length}`, ...lines]);
}

/** The internal mole and its MICE profile (reveal only). */
function moleSection(world: WorldState, truth: TruthStore): string {
  const mole = world.station.mole;
  if (mole === undefined) {
    return section('TRUTH · Mole', ['no mole in this world']);
  }
  const moleId = revealTruth(mole) as NpcId;
  const npc = world.npcs[moleId];
  const allegiance = truth.allegiance(moleId);
  const lines = [
    `mole:        ${moleId}${npc ? ` (${npc.persona.name})` : ''}`,
    `reports to:  ${allegiance === undefined ? '(unrecorded)' : revealTruth(allegiance).org}`,
  ];
  if (npc !== undefined) {
    const mice = revealTruth(npc.mice);
    lines.push(
      `MICE:        money=${mice.money.toFixed(2)} ideology=${mice.ideology.toFixed(
        2,
      )} coercion=${mice.coercion.toFixed(2)} ego=${mice.ego.toFixed(2)}`,
    );
  }
  return section('TRUTH · Mole', lines);
}

/** The Plot ground truth: leader, target, materiel and the stage DAG. */
function plotSection(plot: PlotState): string {
  const stages = plot.stages.map(
    (s) => `  ${s.id} [${s.status}] deadline=${formatTime(s.deadline)}`,
  );
  return section('TRUTH · Plot', [
    `template:  ${plot.template}`,
    `status:    ${plot.status}`,
    `leader:    ${String(revealTruth(plot.leader))}`,
    `target:    ${String(revealTruth(plot.target))}`,
    `materiel:  ${String(revealTruth(plot.materiel))}`,
    `stages:    ${plot.stages.length}`,
    ...stages,
  ]);
}

/** The Side-Thread ground truth: participants, true Propositions and traces. */
function sideThreadsSection(threads: readonly SideThreadState[]): string {
  if (threads.length === 0) {
    return section('TRUTH · Side Threads', ['none']);
  }
  const lines: string[] = [];
  for (const thread of threads) {
    lines.push(`  ${thread.id} [${thread.template}] participants=${thread.participants.join(', ')}`);
    for (const prop of thread.propositions) {
      lines.push(`      fact: ${formatProposition(prop)}`);
    }
  }
  return section('TRUTH · Side Threads', [`threads: ${threads.length}`, ...lines]);
}

/** The ground-truth facts the Truth Store was seeded with. */
function truthFactsSection(truth: TruthStore): string {
  const facts = truth.facts();
  const lines = facts.map((f) => `  ${formatProposition(revealTruth(f))}`);
  return section('TRUTH · Seeded Facts', [`facts: ${facts.length}`, ...lines]);
}

/** The noise channels (background traffic): `chan:noise/…` and `chan:thread/…`. */
function noiseSection(world: WorldState): string {
  const channels = Object.values(world.channels) as Channel[];
  const noiseChannels = channels.filter(
    (c) => c.id.startsWith('chan:noise/') || c.id.startsWith('chan:thread/'),
  );
  const backgroundNpcs = Object.values(world.npcs).filter((n) =>
    n.id.startsWith('npc:bg-'),
  );
  return section('TRUTH · Noise', [
    `background NPCs:  ${backgroundNpcs.length}`,
    `side threads:     ${world.sideThreads.length}`,
    `noise channels:   ${noiseChannels.length}`,
    ...noiseChannels.map((c) => `  ${c.id} [${c.kind}]`),
  ]);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Render the full sectioned dump of a generated world. In player-safe mode the
 * output covers the seed/clock, the city, the Starting Brief and the documents;
 * with `reveal` it appends the ground-truth sections (allegiances, the mole +
 * MICE, the Plot, the Side Threads, the seeded facts and the noise).
 */
export function renderWorldDump(
  world: WorldState,
  truth: TruthStore,
  options: WorldDumpOptions = {},
): string {
  const sections: string[] = [
    headerSection(world),
    citySection(world),
    startingBriefSection(world),
    documentsSection(world),
  ];

  if (options.reveal === true) {
    sections.push(
      allegiancesSection(world),
      moleSection(world, truth),
      plotSection(world.plot),
      sideThreadsSection(world.sideThreads),
      noiseSection(world),
      truthFactsSection(truth),
    );
  }

  return `${sections.join('\n\n')}\n`;
}
