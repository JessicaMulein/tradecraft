/**
 * The minimal LM Studio SDK surface the Model Manager depends on
 * (Requirements 43.1, 43.2; design "Model Manager").
 *
 * The Model Manager owns model *management* — connecting, listing what is
 * downloaded, and (in later tasks) estimating memory and loading/unloading
 * models — through LM Studio's official SDK. Inference is a separate concern
 * that stays on the OpenAI-compatible endpoint via the Gateway and MUST NEVER
 * be routed through this client (Requirement 43.7). That boundary is enforced
 * structurally here: {@link LmStudioClient} declares no chat/completion/inference
 * method at all, so there is nothing on this surface to call for inference.
 *
 * Depending on this interface rather than the concrete `@lmstudio/sdk` class
 * keeps the Model Manager's pure logic (connection-retry policy, download
 * diffing, `lms get` formatting) testable offline against a fake. The one place
 * the real SDK class is referenced is the adapter in `./sdk-adapter.ts`, which
 * constructs an `LMStudioClient` and satisfies this interface.
 */

/**
 * One model LM Studio reports as downloaded (locally available on disk). The
 * `modelKey` is the stable identifier the SDK echoes — the same string
 * `config/models.yaml` stores and the Gateway sends to the endpoint — which is
 * what the download check matches a role's configured model against.
 *
 * Only `modelKey` is required by task 25.1; the rest of the SDK's `ModelInfo`
 * (format, size, architecture, …) is deliberately not modelled so the fake and
 * the real adapter agree on the smallest surface that works.
 */
export interface DownloadedModel {
  /** The stable model identifier, e.g. `qwen2.5-7b-instruct`. */
  readonly modelKey: string;
}

/**
 * The SDK's estimate of what making a set of models resident would cost, and
 * whether it fits — produced WITHOUT loading anything (Requirement 43.3). This
 * is the raw material the pure estimate check (`./estimate-check.ts`) compares;
 * the figures are bytes.
 *
 * `requiredBytes` is the memory the whole resident set needs at the given
 * context length (the sum of each distinct model's estimated total, weights
 * plus KV cache — a larger context length means a larger `requiredBytes`).
 * `availableBytes` is the budget the set is measured against (the machine's
 * usable memory for models). `fits` is the SDK's own verdict: true only when
 * every model in the set can be made resident under the current guardrails. It
 * is carried alongside the raw figures rather than derived from them because
 * the SDK applies guardrails the two byte totals alone do not capture, so a
 * caller never has to re-implement the fit rule.
 *
 * This is a report, not a commitment: obtaining an estimate loads nothing.
 */
export interface ResidentSetEstimate {
  /** True iff the whole set can be made resident under current guardrails. */
  readonly fits: boolean;
  /** Estimated memory the resident set needs at the context length, in bytes. */
  readonly requiredBytes: number;
  /** Memory available to make models resident, in bytes. */
  readonly availableBytes: number;
}

/**
 * One model LM Studio reports as currently loaded (resident), as seen through
 * the SDK's loaded-model listing (Requirement 43.5; design "Model Manager",
 * step 5). The Model Manager loads every model under a stable `identifier` —
 * the `models.yaml` model string — so the listing is keyed by that identifier,
 * and the post-load residency check reads `gpuResident` off each entry.
 *
 * `gpuResident` is true only when the model is *fully* on the GPU. macOS can
 * silently push layers off the GPU to RAM, leaving a model that still runs but
 * far slower; such a model is reported with `gpuResident: false` so the load
 * path can warn by identifier (Requirement 43.5). Only the two fields the
 * residency check needs are modelled, keeping the fake and the real adapter
 * agreed on the smallest surface that works.
 */
export interface LoadedModel {
  /** The identifier the model was loaded under (its `models.yaml` model id). */
  readonly identifier: string;
  /** True iff the model is *fully* GPU-resident (no layers spilled to RAM). */
  readonly gpuResident: boolean;
}

/**
 * How to load one model (Requirement 43.4; design "Model Manager", step 4).
 *
 * `identifier` is the stable handle the model is loaded under — exactly the
 * `models.yaml` model string the Gateway sends to the OpenAI endpoint — so a
 * build or quant swap never touches config and inference stays on the portable
 * endpoint (Requirement 43.7). `contextLength` is supplied by the caller rather
 * than read off the profile (the config carries no context-length field, so the
 * preflight and the load path both take it as an option) and sizes the KV cache.
 *
 * `keepResident` disables LM Studio's idle/auto-evict behaviour for this load:
 * a model loaded explicitly for a game session must stay resident for the whole
 * session rather than unload after an idle window the way first-request loads do
 * (Requirement 43.6). The adapter maps it to the SDK's keep-in-memory / no-TTL
 * knobs; the fake simply records it so a test can assert it was requested.
 */
export interface LoadModelOptions {
  /** The stable identifier to load under (the `models.yaml` model id). */
  readonly identifier: string;
  /** The context length to load at, in tokens (sizes the KV cache). */
  readonly contextLength: number;
  /**
   * Keep the model resident for the whole session: disable idle-unload and
   * auto-evict so an explicitly loaded model is not dropped mid-game
   * (Requirement 43.6).
   */
  readonly keepResident: boolean;
}

/**
 * The management-only client surface the Model Manager uses. A connected client
 * is one whose server is reachable; the connection path (starting the server
 * when it is down) lives in `./connect.ts` and produces a value of this type.
 *
 * Note the absence of any inference method: this is intentional. The Gateway,
 * not the Model Manager, performs inference, and it does so over the portable
 * OpenAI-compatible endpoint — never over the SDK (Requirement 43.7). The
 * methods added for the load path (task 25.3) are all *management* — load,
 * unload, and list — and still carry nothing to run a model with.
 */
export interface LmStudioClient {
  /**
   * List the models LM Studio reports as downloaded (locally available). Maps
   * to the SDK's `client.system.listDownloadedModels()` / `lms ls`. A missing
   * model is one whose id is not in this set.
   */
  listDownloadedModels(): Promise<readonly DownloadedModel[]>;

  /**
   * Estimate what making `modelKeys` resident would cost at `contextLength`,
   * WITHOUT loading any of them (Requirement 43.3). Maps to the SDK's
   * estimate-only path (`client.llm.estimateResourcesUsage`), summed over the
   * distinct keys. `contextLength` is threaded into the estimate because the KV
   * cache scales with it — a bigger context needs more memory — so the preflight
   * must size the set at the *configured* context length, not a default.
   *
   * `modelKeys` is expected to already be de-duplicated (a model that serves
   * two roles is sized once, matching how it will later be loaded once); passing
   * duplicates would over-count. Returns the raw figures and the SDK's fit
   * verdict as a {@link ResidentSetEstimate}; it never loads and never throws to
   * signal "won't fit" — a shortfall is reported as `fits: false`.
   *
   * This is still management, not inference: it sizes models, it does not run
   * them. Inference stays on the Gateway's OpenAI endpoint (Requirement 43.7).
   */
  estimateResidentSet(
    modelKeys: readonly string[],
    contextLength: number,
  ): Promise<ResidentSetEstimate>;

  /**
   * Make `modelKey` resident under the options' stable `identifier` and context
   * length, with idle-unload/auto-evict disabled when `keepResident` is set
   * (Requirements 43.4, 43.6). Maps to the SDK's `client.llm.load(modelKey, {
   * identifier, config: { contextLength }, … })`. This is management, not
   * inference: it makes a model resident, it does not run it — inference stays
   * on the Gateway's OpenAI endpoint (Requirement 43.7).
   *
   * Resolving means the model is loaded under `identifier`; the caller then uses
   * {@link listLoaded} to verify GPU residency. Idempotency across a model that
   * serves two roles is the *caller's* responsibility — the load path loads each
   * distinct model once (`requiredModels`) — so this method need not de-dupe.
   */
  loadModel(modelKey: string, options: LoadModelOptions): Promise<void>;

  /**
   * Unload the model loaded under `identifier` (Requirement 43.6). Maps to the
   * SDK's `client.llm.unload(identifier)`. Used to tear a profile's models down
   * so the eval harness can switch profiles between runs (Requirement 43.6).
   */
  unloadModel(identifier: string): Promise<void>;

  /**
   * List the models LM Studio reports as currently loaded, each with its
   * `identifier` and whether it is fully GPU-resident (Requirement 43.5). Maps
   * to the SDK's `client.llm.listLoaded()` plus the per-model offload read. The
   * post-load residency check reads this to warn, by identifier, on any model
   * only partially on the GPU.
   */
  listLoaded(): Promise<readonly LoadedModel[]>;
}
