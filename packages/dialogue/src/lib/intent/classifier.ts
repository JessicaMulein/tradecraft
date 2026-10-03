/**
 * The Intent Classifier — the `fast`-role step that labels a player's dialogue
 * line with exactly one {@link Intent} from the fixed set (Requirement 4.2).
 *
 * This is the one place a language model touches a dialogue turn's control
 * flow, and it is deliberately narrow: the model is asked only to pick a label
 * from a closed enum, never to produce prose or facts. The call goes through
 * the LLM Gateway's `structured` path (task 13.2), which sends a JSON Schema
 * built from the Zod schema here as `response_format` and re-validates the
 * response with that same schema (design "LLM Gateway" → structured output;
 * Requirement 14.4). So the classifier can only ever return a value the Sim
 * recognises; anything else is a schema failure the Gateway surfaces, not a
 * stray string the Sim has to defend against.
 *
 * The returned {@link Intent} is the single model-derived input {@link
 * applyIntent} acts on. The parse path — "a structured call constrained to the
 * Intent enum yields one of the twelve values" — is what this module owns and
 * what its tests pin down; the Intent vocabulary and the trust/suspicion maths
 * ({@link applyIntent}) live in the engine (`recruit/intent.ts`), and routing
 * by scene stakes (Requirement 4.4) lives in task 14.6.
 */

import { INTENTS, type Intent } from '@tradecraft/engine';
import type { CallInput, Gateway, StructuredOptions } from '@tradecraft/llm';
import { z } from 'zod';

/**
 * The structured-output schema the classifier constrains the `fast` role to: an
 * object with one `intent` field whose value is one of the fixed {@link
 * INTENTS}. An object (rather than a bare enum) is used because the Gateway's
 * `structured` path sends a JSON-Schema `response_format`, and an object with a
 * named enum field is the shape every OpenAI-compatible endpoint renders
 * cleanly. The Gateway re-validates the model's reply against this schema, so
 * {@link classifyIntent} always resolves to a legal Intent or the Gateway
 * rejects the call.
 */
export const IntentClassificationSchema = z.object({
  intent: z.enum(INTENTS),
});

/** The validated structured result of a classification call. */
export type IntentClassification = z.infer<typeof IntentClassificationSchema>;

/**
 * The system prompt that frames the classification task. It states the job
 * (label the player's line), lists the closed set of allowed labels with a
 * one-line gloss each, and forbids any output but the structured value. It
 * names no world facts and carries no per-NPC state, so it is a stable prefix
 * the Gateway can cache across turns (design "Prompt Builder", block 1 is the
 * static frame).
 */
export const INTENT_SYSTEM_PROMPT = [
  'You classify a single line of a player\'s dialogue in a Cold War spy game',
  'into exactly one intent category. Respond only with the structured value.',
  '',
  'Categories:',
  '- ask: a plain question or request for information.',
  '- pitch-money: an offer of money to recruit the character.',
  '- pitch-ideology: an appeal to belief or cause to recruit the character.',
  '- pitch-coercion: a threat or blackmail used to recruit the character.',
  '- pitch-ego: flattery or an appeal to vanity used to recruit the character.',
  '- reassure: calming, building rapport or trust.',
  '- threaten: intimidation not tied to a recruitment offer.',
  '- probe: a pointed, searching or testing question.',
  '- confront: presenting an accusation or evidence against the character.',
  '- task: directing an asset to carry out an action.',
  '- small-talk: light, incidental conversation.',
  '- end: closing or leaving the conversation.',
].join('\n');

/** How a player line is wrapped as the user message for the classifier. */
function buildMessages(line: string): CallInput {
  return [
    { role: 'system', content: INTENT_SYSTEM_PROMPT },
    { role: 'user', content: line },
  ];
}

/**
 * Classify a player's dialogue `line` into one {@link Intent} using the `fast`
 * role (Requirement 4.2). The call runs through the Gateway's `structured`
 * path, constrained to {@link IntentClassificationSchema}; the Gateway sends
 * the derived JSON Schema and re-validates the reply, so this resolves to a
 * legal Intent or rejects.
 *
 * @param gateway the LLM Gateway (live, recording or replay — all interchange-
 *   able behind the {@link Gateway} interface).
 * @param line the player's dialogue line.
 * @param options optional structured-call options passed through to the
 *   Gateway (e.g. an {@link CallHandle} receiver).
 * @returns the classified {@link Intent}.
 */
export async function classifyIntent(
  gateway: Gateway,
  line: string,
  options?: StructuredOptions,
): Promise<Intent> {
  const result = await gateway.structured(
    'fast',
    buildMessages(line),
    IntentClassificationSchema,
    options,
  );
  return result.intent;
}
