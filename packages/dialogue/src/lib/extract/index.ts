/**
 * The Claim Extractor (`dialogue/extract`), task 14.10.
 *
 * Re-exports the three parts of the extractor:
 *
 * - {@link ./schema.js} — the predicate-derived extraction schema;
 * - {@link ./extractor.js} — the pure evaluation core (truth, Told List,
 *   chance leaks, consistency violations);
 * - {@link ./extract.js} — the asynchronous orchestrator (the structured call,
 *   the schema retry and the unparsed-note fallback).
 */

export {
  buildExtractionSchema,
  MAX_EXTRACTED_CLAIMS,
  UNKNOWN_ENTITY,
  type ExtractedClaim,
  type ExtractionResult,
} from './schema.js';

export {
  evaluateExtraction,
  type ChanceLeak,
  type ConsistencyViolation,
  type EvaluateExtractionInputs,
  type ExtractedCaseClaim,
  type ExtractionOutcome,
  type SpeakerKnowledge,
} from './extractor.js';

export {
  extractClaims,
  EXTRACTION_RETRY_LIMIT,
  EXTRACTION_ROLE,
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractDeps,
  type ExtractionJob,
  type ExtractResult,
  type UnparsedNote,
} from './extract.js';

export { transcribeBluff } from './bluff-transcript.js';
