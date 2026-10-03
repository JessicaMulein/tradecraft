/**
 * The transport-neutral request types shared across the gateway layer: a chat
 * message, the structured `response_format`, and the `CallInput` a call path
 * accepts. They live here rather than in {@link OpenAIGateway} so the record
 * and replay modules can reference them without importing the live gateway —
 * which keeps the import graph acyclic (dep-cruise `no-circular`). The live
 * gateway re-exports them, so existing imports from `openai-gateway.js` keep
 * working.
 */

/**
 * One chat message, as the OpenAI chat-completions API accepts it. The design's
 * `ChatMessage`: a role tag and its text content.
 */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** A JSON-Schema `response_format`, as structured output sends it. */
export interface JsonSchemaResponseFormat {
  readonly type: 'json_schema';
  readonly json_schema: {
    readonly name: string;
    readonly schema: Record<string, unknown>;
    readonly strict: true;
  };
}

/** The input a call accepts: a bare prompt string or an explicit message list. */
export type CallInput = string | readonly ChatMessage[];
