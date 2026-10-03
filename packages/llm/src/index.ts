/**
 * `@tradecraft/llm` — the LLM Gateway. It connects to an OpenAI-compatible
 * endpoint (LM Studio by default), loads and validates `models.yaml`, routes
 * calls by Model Role, and records and replays sessions. This entry point
 * re-exports the config schema and loader and the Gateway client (task 13.1).
 */

export {
  LOAD_IDENTIFIER_PATTERN,
  LoadIdentifierSchema,
  MODEL_ROLES,
  ModelEntrySchema,
  ModelFamilySchema,
  ModelSourceSchema,
  ModelsConfigSchema,
  ProfileSchema,
  REASONING_MODES,
  ReasoningModeSchema,
  RoleConfigSchema,
  SOURCE_FORMATS,
  SourceFormatSchema,
  type ModelEntry,
  type ModelSource,
  type ModelsConfig,
  type Profile,
  type ReasoningMode,
  type Role,
  type RoleConfig,
  type SourceFormat,
} from './lib/config/models-config.js';

export {
  formatConfigIssues,
  loadModelsConfig,
  parseModelsConfig,
  type ConfigIssue,
  type LoadResult,
} from './lib/config/load-models-config.js';

export {
  checkModels,
  formatMissingRoles,
  type MissingRole,
  type ModelCheckResult,
} from './lib/gateway/model-check.js';

export type {
  DownloadedModel,
  LmStudioClient,
  LoadModelOptions,
  LoadedModel,
  ResidentSetEstimate,
} from './lib/model-manager/client-interface.js';

export { requiredModels } from './lib/model-manager/required-models.js';

export {
  makeFakeClient,
  type FakeClient,
  type FakeClientHooks,
} from './lib/model-manager/fake-client.js';

export {
  loadProfile,
  unloadProfile,
  type LoadProfileOptions,
  type LoadProfileResult,
} from './lib/model-manager/load-profile.js';

export {
  checkDownloads,
  formatMissingDownloads,
  lmsGetCommand,
  preferredSource,
  resolveSource,
  type DownloadCheckResult,
  type MissingDownload,
  type ModelMap,
  type SourceResolution,
} from './lib/model-manager/download-check.js';

export {
  ConnectionError,
  connectWithRetry,
  type ConnectAction,
  type ConnectOptions,
  type SleepFn,
  type StartServerAction,
} from './lib/model-manager/connect.js';

export {
  checkEstimate,
  formatMemoryShortfall,
  type EstimateCheckResult,
  type MemoryShortfall,
} from './lib/model-manager/estimate-check.js';

export {
  preflight,
  type PreflightOptions,
  type PreflightResult,
} from './lib/model-manager/preflight.js';

export {
  adaptLmStudioClient,
  createLmsStartServerAction,
  createSdkConnectAction,
  type SdkAdapterOptions,
} from './lib/model-manager/sdk-adapter.js';

export {
  StartupError,
  activeProfile,
  startModelManager,
  type StartupOptions,
  type StartupResult,
} from './lib/model-manager/startup.js';

export {
  createLmsGetAction,
  pullMissingModels,
  pullMissingModelsForClient,
  type PullAction,
  type PullResult,
} from './lib/model-manager/models-pull.js';

export {
  REASONING_FAMILIES,
  familyForModel,
  gemmaAdapter,
  isReasoningFamily,
  noopAdapter,
  qwenAdapter,
  resolveReasoningAdapter,
  type ReasoningAdapter,
  type ReasoningFamily,
  type ReasoningMessage,
  type ReasoningMutation,
  type WarnFn,
} from './lib/gateway/reasoning/reasoning-adapter.js';

export {
  FileMetricsSink,
  InMemoryMetricsSink,
  METRICS_OUTCOMES,
  type MetricsOutcome,
  type MetricsRecord,
  type MetricsSink,
} from './lib/gateway/metrics/metrics-record.js';

export { systemClock, type Clock } from './lib/gateway/metrics/clock.js';

export {
  OpenAIGateway,
  type CallHandle,
  type ChatCallOptions,
  type ChatClient,
  type ChatCompletion,
  type ChatCompletionChunk,
  type ChatRequest,
  type GatewayClient,
  type ModelLister,
  type NarrateOptions,
  type OpenAIGatewayOptions,
  type StreamOptions,
  type StructuredOptions,
} from './lib/gateway/openai-gateway.js';

export {
  CallPriority,
  PRIORITY_ORDER,
  rolePriority,
} from './lib/gateway/resilience/priority.js';

export {
  PriorityScheduler,
  SchedulerAbortError,
  type SchedulerJob,
  type SchedulerOptions,
  type SubmitOptions,
} from './lib/gateway/resilience/scheduler.js';

export {
  FALLBACK_ROLE,
  runWithRetryAndFallback,
  type AttemptFn,
  type RetryPolicyOptions,
} from './lib/gateway/resilience/retry.js';

export {
  TimeoutError,
  withTimeout,
  type TimeoutOptions,
} from './lib/gateway/resilience/timeout.js';

export {
  cancellableNarration,
  type NarrationStream,
  type NarrationStreamOptions,
} from './lib/gateway/resilience/narration-stream.js';

export type {
  CallInput,
  ChatMessage,
  JsonSchemaResponseFormat,
} from './lib/gateway/call-types.js';

export type { Gateway, GatewayCallHandle } from './lib/gateway/gateway.js';

export {
  canonicalJson,
  hashRequest,
  type CallKind,
  type CallRequest,
} from './lib/gateway/record/request-hash.js';

export { describeCall } from './lib/gateway/record/describe-call.js';

export type {
  CallRecord,
  CallResponse,
  CallTimings,
  StreamResponse,
  StructuredResponse,
} from './lib/gateway/record/records.js';

export {
  FileRecordSink,
  FileRecordSource,
  parseRecords,
  type RecordSink,
  type RecordSource,
} from './lib/gateway/record/jsonl-store.js';

export {
  RecordingGateway,
  type RecordingGatewayOptions,
} from './lib/gateway/record/recording-gateway.js';

export {
  ReplayGateway,
  ReplayMismatchError,
  type ReplayGatewayOptions,
} from './lib/gateway/record/replay-gateway.js';
