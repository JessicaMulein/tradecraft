/**
 * The Narrator prompt builder — assembles the Narrator's prompt from a
 * {@link SceneDescriptor}, ordered from most static to most dynamic, exactly as
 * the dialogue Prompt Builder does for NPC prompts (Requirement 15.1).
 *
 * The design lays the blocks out most-static to most-dynamic so the server's
 * prefix cache survives across calls — only the tail changes as the scene moves:
 *
 * | # | Block                                             | Changes when      |
 * |---|---------------------------------------------------|-------------------|
 * | 1 | Narrator frame (second person, present tense, …)  | Never             |
 * | 2 | City style sheet (from content)                   | Never             |
 * | 3 | Location block: name, description, atmosphere     | On Location change|
 * | 4 | Time, weather, crowd, visible persons, Fact Lines | Every call        |
 *
 * Keeping blocks 1–2 byte-identical for a whole session, and block 3 identical
 * while the player stays put, is the whole point: the leading prompt text is a
 * stable prefix the model server can cache (Requirement 15.1). The builder is
 * therefore **pure and deterministic** — it reads only its arguments, performs
 * no I/O and makes no model calls, so the same inputs always produce the same
 * prompt, byte for byte.
 *
 * The scene descriptor the builder reads is the view-safe projection from the
 * Player View (see {@link sceneDescriptorFromView}); the builder never touches
 * the Truth Store, so everything it renders is already safe for the model to see
 * (Requirements 2.2, 20.2). The builder does not itself run the Leak Guard or
 * the Specifics Guard — those gate the model's *output*, sentence by sentence,
 * in the streaming step (task 15.3). The builder's job is only the prompt.
 */

import { phaseName, type CrowdLevel, type GameTime } from '@tradecraft/engine';

import type {
  NarratorSceneKind,
  SceneDescriptor,
} from './scene-descriptor.js';

/**
 * The city style sheet — the "voice" the Narrator writes the city in. It comes
 * from content (the design's block 2, "City style sheet (from content)"), so
 * the builder takes it as a string the caller sourced from the loaded pack. It
 * changes never during a session, which is what keeps it in the cached prefix.
 */
export interface NarratorStyle {
  /** Free-text style guidance from the pack, e.g. the city's tone and register. */
  readonly styleSheet: string;
}

/** Everything {@link buildNarratorPrompt} assembles a Narrator prompt from. */
export interface NarratorPromptInput {
  /** The view-safe scene descriptor projected from the Player View (block 3–4). */
  readonly scene: SceneDescriptor;
  /** The deterministic Fact Lines the Sim produced for this scene (block 4). */
  readonly factLines: readonly string[];
  /** The city style sheet from content (block 2). Optional; omitted when empty. */
  readonly style?: NarratorStyle;
}

/** One assembled block, kept apart so a caller can reason about the prefix. */
interface Block {
  readonly kind: 'frame' | 'style' | 'location' | 'dynamic';
  readonly text: string;
}

/** The builder's output: the assembled prompt and the stable-prefix boundary. */
export interface BuiltNarratorPrompt {
  /** The full prompt text, blocks joined by a blank line, in block order. */
  readonly text: string;
  /**
   * The length, in characters, of the stable prefix — blocks 1–3 (frame, style
   * and Location), which do not change while the player stays at one Location.
   * Everything from this index on is the per-call tail (block 4). Callers that
   * verify prefix stability (and the server's cache) key on this boundary.
   */
  readonly prefixLength: number;
}

// ---------------------------------------------------------------------------
// Block 1: the Narrator frame (never changes)
// ---------------------------------------------------------------------------

/**
 * The Narrator frame (block 1). It states the whole contract the Narrator works
 * under: second person, present tense, at most three sentences, sensory texture
 * only, name nothing that is not listed, no numbers, days or clock times, and
 * never add events the Fact Lines did not state. This block never changes during
 * a session, so it is the head of the cached prefix (Requirement 15.1).
 *
 * The instructions mirror the guards that police the output downstream — the
 * Leak Guard ("name nothing not listed") and the Specifics Guard ("no numbers,
 * days or times") — so a well-behaved model rarely trips them, but the guards
 * remain the real enforcement; the frame only asks.
 */
const NARRATOR_FRAME = [
  '# Narration',
  'You are the narrator of a historical fiction. Describe the scene in the',
  'second person ("you"), in the present tense, in at most three sentences.',
  'Write sensory texture only — what the place looks, sounds and smells like.',
  'Do not add events, actions or outcomes beyond the facts you are given below.',
  'Name only the people, places and things that appear in the scene and facts',
  'below. Do not invent or name anyone or anywhere else.',
  'Do not state any number, count, day of the week, month, date or clock time',
  'unless it appears verbatim in the facts below.',
].join('\n');

// ---------------------------------------------------------------------------
// Block 2: the city style sheet (never changes)
// ---------------------------------------------------------------------------

/** The city style-sheet block (block 2), or `undefined` when no style is given. */
function renderStyle(style: NarratorStyle | undefined): string | undefined {
  const sheet = style?.styleSheet.trim();
  if (sheet === undefined || sheet.length === 0) {
    return undefined;
  }
  return `# Style\n${sheet}`;
}

// ---------------------------------------------------------------------------
// Block 3: the Location (changes only on Location change)
// ---------------------------------------------------------------------------

/**
 * The Location block (block 3): the Location's name, description and atmosphere
 * tags. These are view-safe facts drawn from the Location Type pools at
 * generation; the Narrator elaborates them as Flavour. The block is identical
 * for as long as the player stays at one Location, so it is the tail of the
 * cached prefix.
 */
function renderLocation(scene: SceneDescriptor): string {
  const { location } = scene;
  const lines = [`You are at ${location.name}.`];
  const description = location.description.trim();
  if (description.length > 0) {
    lines.push(description);
  }
  if (location.atmosphere.length > 0) {
    lines.push(`Atmosphere: ${location.atmosphere.join(', ')}.`);
  }
  return `# Place\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Block 4: the dynamic per-call block (changes every call)
// ---------------------------------------------------------------------------

/**
 * A short, deterministic phrase for the scene kind, used to frame the dynamic
 * block so an arrival reads differently from, say, a surveillance beat. The map
 * is total over {@link NarratorSceneKind}, so there is no runtime fallback to
 * drift.
 */
const KIND_PHRASE: Record<NarratorSceneKind, string> = {
  arrival: 'You have just arrived.',
  surveillance: 'You are watching the scene.',
  follow: 'You are following someone through the scene.',
  'dead-drop': 'You are servicing a dead drop.',
  intercept: 'You are intercepting traffic.',
  wait: 'You are waiting, letting the scene move around you.',
  'scene-open': 'The scene opens.',
  arrest: 'An arrest is unfolding.',
};

/** How a crowd band reads in prose (the view-safe band from the scene). */
const CROWD_PHRASE: Record<CrowdLevel, string> = {
  empty: 'The place is deserted.',
  sparse: 'A few people are about.',
  busy: 'The place is busy.',
  packed: 'The place is packed.',
};

/** Describe the time of day from the phase ordinal, with the day for context. */
function renderTime(time: GameTime): string {
  return `It is ${phaseName(time.phase)} on day ${time.day}.`;
}

/**
 * The dynamic block (block 4): the scene kind, time, weather, crowd, the visible
 * persons by label, and the Fact Lines. This block changes every call, so it is
 * the per-call tail that follows the cached prefix.
 *
 * The Fact Lines are included verbatim: they are what the Narrator must stay
 * within, and echoing them into the prompt both grounds the model and feeds the
 * Specifics Guard's verbatim-token allowance downstream (a "3" or a name that
 * appears here is one the Sim itself supplied).
 */
function renderDynamic(
  scene: SceneDescriptor,
  factLines: readonly string[],
): string {
  const lines: string[] = [KIND_PHRASE[scene.kind]];
  lines.push(renderTime(scene.time));

  const weather = scene.weather.trim();
  if (weather.length > 0) {
    lines.push(`The weather is ${weather}.`);
  }

  lines.push(CROWD_PHRASE[scene.crowd]);

  if (scene.visible.length > 0) {
    const labels = scene.visible.map((p) => p.label);
    lines.push(`In view: ${labels.join(', ')}.`);
  } else {
    lines.push('No one else is in view.');
  }

  const facts =
    factLines.length === 0
      ? ['(No facts to narrate.)']
      : factLines.map((f) => `- ${f}`);

  return `# Scene\n${lines.join('\n')}\n\n# Facts\n${facts.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Join blocks in order with a blank line between them. */
function joinBlocks(blocks: readonly Block[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}

/**
 * Build the Narrator prompt from `input`, ordered static-to-dynamic.
 *
 * Pure and deterministic: it reads only `input`, renders every block the same
 * way every time, and returns both the full prompt and the length of its stable
 * prefix (blocks 1–3). The prefix is byte-identical for as long as the style and
 * Location hold, which is what lets the server reuse its prefix cache across
 * narration calls (Requirement 15.1).
 *
 * @param input the view-safe scene descriptor, the Fact Lines, and the optional
 *   city style sheet from content.
 */
export function buildNarratorPrompt(
  input: NarratorPromptInput,
): BuiltNarratorPrompt {
  const frame: Block = { kind: 'frame', text: NARRATOR_FRAME };

  const styleText = renderStyle(input.style);
  const style: Block[] =
    styleText === undefined ? [] : [{ kind: 'style', text: styleText }];

  const location: Block = {
    kind: 'location',
    text: renderLocation(input.scene),
  };

  const dynamic: Block = {
    kind: 'dynamic',
    text: renderDynamic(input.scene, input.factLines),
  };

  // Blocks 1–3 form the stable prefix; block 4 is the per-call tail.
  const prefixBlocks: Block[] = [frame, ...style, location];
  const prefixText = joinBlocks(prefixBlocks);
  const text = joinBlocks([...prefixBlocks, dynamic]);

  return { text, prefixLength: prefixText.length };
}
