/**
 * An offline fake of the Model Manager's {@link LmStudioClient}, shared by the
 * Model Manager tests (tasks 25.1, later 25.5).
 *
 * The fake answers `listDownloadedModels()` from a fixed set. It deliberately
 * carries NO inference method and NO download/pull method on its public surface:
 * the download check must fail-and-report rather than pull (Requirement 43.2),
 * and inference must never be routed through the SDK (Requirement 43.7).
 *
 * The fixture itself imports no test framework, so it stays an ordinary source
 * module (the whole repo keeps `vitest` imports to `.spec` files). A test that
 * wants call-count assertions wraps the fixture's functions in its own `vi.fn()`
 * spies, or passes spies in through {@link FakeClientHooks}.
 */

import type {
  DownloadedModel,
  LmStudioClient,
  LoadModelOptions,
  LoadedModel,
  ResidentSetEstimate,
} from './client-interface.js';

/** Optional injected implementations so a test can supply its own spies. */
export interface FakeClientHooks {
  /** Override the downloaded-models listing (e.g. a `vi.fn()` spy). */
  readonly listDownloadedModels?: () => Promise<readonly DownloadedModel[]>;
  /**
   * Override the resident-set estimate (e.g. a `vi.fn()` spy). Receives the
   * de-duplicated model keys and the context length so a test can model a
   * context-sensitive estimate (a bigger context length → a bigger
   * `requiredBytes`). When omitted, the fake returns a trivially-fitting
   * estimate so download-only tests need not supply one.
   */
  readonly estimateResidentSet?: (
    modelKeys: readonly string[],
    contextLength: number,
  ) => Promise<ResidentSetEstimate>;
  /**
   * Override the model load (e.g. a `vi.fn()` spy) so a test can assert the
   * identifier, context length and keep-resident flag passed, and how many
   * times a model was loaded. When omitted, the fake loads with a no-op.
   */
  readonly loadModel?: (
    modelKey: string,
    options: LoadModelOptions,
  ) => Promise<void>;
  /**
   * Override the model unload (e.g. a `vi.fn()` spy) so a test can assert each
   * distinct identifier is unloaded once. When omitted, the fake is a no-op.
   */
  readonly unloadModel?: (identifier: string) => Promise<void>;
  /**
   * Override the loaded-model listing (e.g. a `vi.fn()` spy) so a test can model
   * GPU residency — a fully-resident set, or a partially-resident model that
   * must warn by identifier (Requirement 43.5). When omitted, the fake reports
   * nothing loaded, so the load path loads the whole set and sees it as not yet
   * verified; residency tests supply their own listing.
   */
  readonly listLoaded?: () => Promise<readonly LoadedModel[]>;
  /**
   * A would-be download/pull the download check must NEVER call. Not part of
   * {@link LmStudioClient}; exposed only so a test can assert it was not
   * invoked, guarding against a regression that pulls silently.
   */
  readonly pull?: () => Promise<unknown>;
}

/** A fake client; `pull` is present only so a test can assert it is unused. */
export interface FakeClient extends LmStudioClient {
  /** A would-be pull method; never called by the download check. */
  readonly pull: () => Promise<unknown>;
}

/**
 * Build a fake client that reports `downloaded` as the locally available model
 * ids. Pass {@link FakeClientHooks} to inject spies for call-count assertions.
 */
export function makeFakeClient(
  downloaded: readonly string[],
  hooks: FakeClientHooks = {},
): FakeClient {
  const models: readonly DownloadedModel[] = downloaded.map((modelKey) => ({
    modelKey,
  }));
  const listDownloadedModels =
    hooks.listDownloadedModels ?? (async () => models);
  const estimateResidentSet =
    hooks.estimateResidentSet ??
    (async (): Promise<ResidentSetEstimate> => ({
      fits: true,
      requiredBytes: 0,
      availableBytes: 0,
    }));
  const loadModel = hooks.loadModel ?? (async () => undefined);
  const unloadModel = hooks.unloadModel ?? (async () => undefined);
  const listLoaded =
    hooks.listLoaded ?? (async (): Promise<readonly LoadedModel[]> => []);
  const pull =
    hooks.pull ??
    (async () => {
      throw new Error('the download check must never pull');
    });
  return {
    listDownloadedModels,
    estimateResidentSet,
    loadModel,
    unloadModel,
    listLoaded,
    pull,
  };
}
