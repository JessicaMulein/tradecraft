import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MODEL_ROLES,
  ModelEntrySchema,
  ModelsConfigSchema,
  RoleConfigSchema,
} from './models-config.js';
import {
  formatConfigIssues,
  loadModelsConfig,
  parseModelsConfig,
} from './load-models-config.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/llm/src/lib/config -> repo root is five levels up.
const repoRoot = resolve(here, '../../../../..');
const defaultConfigPath = resolve(repoRoot, 'config/models.yaml');

const validRole = {
  model: 'gemma-31b',
  temperature: 0.8,
  maxTokens: 320,
  timeoutMs: 20000,
  reasoning: 'off' as const,
};

function validEntry() {
  return {
    family: 'gemma4',
    sources: [
      { format: 'mlx', get: 'org/gemma-mlx', key: 'org/gemma-mlx' },
      { format: 'gguf', get: 'org/gemma-gguf@Q4_K_M', key: 'org/gemma-gguf' },
    ],
  };
}

function validModels() {
  return {
    'gemma-31b': validEntry(),
    'qwen-moe': {
      family: 'qwen3',
      sources: [
        { format: 'mlx', get: 'org/qwen-mlx', key: 'org/qwen-mlx' },
        { format: 'gguf', get: 'org/qwen-gguf@Q4_K_M', key: 'org/qwen-gguf' },
      ],
    },
  };
}

function validProfile() {
  return {
    voice: { ...validRole },
    fast: { ...validRole, model: 'qwen-moe' },
    narrator: { ...validRole, model: 'qwen-moe' },
    bookkeeping: { ...validRole, model: 'qwen-moe' },
    judge: { ...validRole, model: 'qwen-moe' },
  };
}

function validConfig() {
  return {
    endpoint: 'http://localhost:1234/v1',
    contextLength: 8192,
    models: validModels(),
    profiles: { 'gemma-voice': validProfile() },
    active: 'gemma-voice',
  };
}

// --- RoleConfigSchema ------------------------------------------------------

describe('RoleConfigSchema', () => {
  it('accepts a well-formed role', () => {
    expect(RoleConfigSchema.parse(validRole)).toEqual(validRole);
  });

  it('rejects an empty model id', () => {
    expect(RoleConfigSchema.safeParse({ ...validRole, model: '' }).success).toBe(
      false,
    );
  });

  it('rejects a temperature above 2', () => {
    expect(
      RoleConfigSchema.safeParse({ ...validRole, temperature: 2.5 }).success,
    ).toBe(false);
  });

  it('rejects a non-integer maxTokens', () => {
    expect(
      RoleConfigSchema.safeParse({ ...validRole, maxTokens: 10.5 }).success,
    ).toBe(false);
  });

  it('rejects a non-positive timeout', () => {
    expect(
      RoleConfigSchema.safeParse({ ...validRole, timeoutMs: 0 }).success,
    ).toBe(false);
  });

  it('rejects an unknown reasoning mode', () => {
    expect(
      RoleConfigSchema.safeParse({ ...validRole, reasoning: 'deep' }).success,
    ).toBe(false);
  });

  it('rejects an unknown field', () => {
    expect(
      RoleConfigSchema.safeParse({ ...validRole, extra: true }).success,
    ).toBe(false);
  });
});

// --- ModelEntrySchema ------------------------------------------------------

describe('ModelEntrySchema', () => {
  it('accepts a well-formed entry with an MLX-then-GGUF pair', () => {
    expect(ModelEntrySchema.parse(validEntry())).toEqual(validEntry());
  });

  it('rejects an empty family', () => {
    expect(
      ModelEntrySchema.safeParse({ ...validEntry(), family: '' }).success,
    ).toBe(false);
  });

  it('rejects a one-element sources tuple', () => {
    const entry = validEntry();
    expect(
      ModelEntrySchema.safeParse({ ...entry, sources: [entry.sources[0]] })
        .success,
    ).toBe(false);
  });

  it('rejects a three-element sources tuple', () => {
    const entry = validEntry();
    expect(
      ModelEntrySchema.safeParse({
        ...entry,
        sources: [...entry.sources, entry.sources[0]],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown source format', () => {
    const entry = validEntry();
    expect(
      ModelEntrySchema.safeParse({
        ...entry,
        sources: [{ ...entry.sources[0], format: 'onnx' }, entry.sources[1]],
      }).success,
    ).toBe(false);
  });

  it('rejects a source missing its key', () => {
    const entry = validEntry();
    expect(
      ModelEntrySchema.safeParse({
        ...entry,
        sources: [{ format: 'mlx', get: 'org/x' }, entry.sources[1]],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown field on an entry', () => {
    expect(
      ModelEntrySchema.safeParse({ ...validEntry(), extra: true }).success,
    ).toBe(false);
  });
});

// --- ModelsConfigSchema ----------------------------------------------------

describe('ModelsConfigSchema', () => {
  it('accepts a valid config', () => {
    expect(ModelsConfigSchema.parse(validConfig())).toMatchObject({
      active: 'gemma-voice',
      contextLength: 8192,
    });
  });

  it('requires a positive integer contextLength', () => {
    for (const bad of [0, -1, 8192.5]) {
      expect(
        ModelsConfigSchema.safeParse({ ...validConfig(), contextLength: bad })
          .success,
        `contextLength ${bad} should fail`,
      ).toBe(false);
    }
  });

  it('requires contextLength to be present', () => {
    const config = validConfig() as Record<string, unknown>;
    delete config.contextLength;
    expect(ModelsConfigSchema.safeParse(config).success).toBe(false);
  });

  it('requires at least one model entry', () => {
    expect(
      ModelsConfigSchema.safeParse({ ...validConfig(), models: {} }).success,
    ).toBe(false);
  });

  it('rejects a Load Identifier that breaks the id pattern', () => {
    const models = validModels() as Record<string, unknown>;
    models['Gemma_31B'] = models['gemma-31b'];
    delete models['gemma-31b'];
    const profiles = {
      'gemma-voice': { ...validProfile(), voice: { ...validRole, model: 'Gemma_31B' } },
    };
    expect(
      ModelsConfigSchema.safeParse({ ...validConfig(), models, profiles })
        .success,
    ).toBe(false);
  });

  it('reports a role whose model is not a key of models at profiles.<p>.<role>.model', () => {
    const profiles = {
      'gemma-voice': {
        ...validProfile(),
        voice: { ...validRole, model: 'ghost-model' },
      },
    };
    const result = ModelsConfigSchema.safeParse({ ...validConfig(), profiles });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (i) =>
          i.path.join('.') === 'profiles.gemma-voice.voice.model',
      ),
    ).toBe(true);
  });

  it('requires every one of the five roles', () => {
    for (const role of MODEL_ROLES) {
      const profile = validProfile() as Record<string, unknown>;
      delete profile[role];
      const result = ModelsConfigSchema.safeParse({
        ...validConfig(),
        profiles: { 'gemma-voice': profile },
      });
      expect(result.success, `missing ${role} should fail`).toBe(false);
    }
  });

  it('rejects an active profile that does not exist', () => {
    const result = ModelsConfigSchema.safeParse({
      ...validConfig(),
      active: 'nope',
    });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0].path).toEqual([
      'active',
    ]);
  });

  it('rejects a non-URL endpoint', () => {
    expect(
      ModelsConfigSchema.safeParse({ ...validConfig(), endpoint: 'nope' })
        .success,
    ).toBe(false);
  });
});

// --- parseModelsConfig: field paths ---------------------------------------

describe('parseModelsConfig', () => {
  // A `contextLength` and a `models` map are now required. The YAML cases below
  // share this preamble so each exercises exactly one path. The Load
  // Identifiers (`gemma-31b`, `qwen-moe`) match `^[a-z0-9][a-z0-9-]*$`.
  const preamble = `
endpoint: http://localhost:1234/v1
contextLength: 8192
models:
  gemma-31b:
    family: gemma4
    sources:
      - { format: mlx,  get: org/gemma-mlx,          key: org/gemma-mlx }
      - { format: gguf, get: org/gemma-gguf@Q4_K_M,  key: org/gemma-gguf }
  qwen-moe:
    family: qwen3
    sources:
      - { format: mlx,  get: org/qwen-mlx,           key: org/qwen-mlx }
      - { format: gguf, get: org/qwen-gguf@Q4_K_M,   key: org/qwen-gguf }
`;

  it('loads a valid document', () => {
    const yaml = `${preamble}
profiles:
  gemma-voice:
    voice: { model: gemma-31b, temperature: 0.8, maxTokens: 320, timeoutMs: 20000, reasoning: off }
    fast: { model: qwen-moe, temperature: 0.7, maxTokens: 220, timeoutMs: 8000, reasoning: off }
    narrator: { model: qwen-moe, temperature: 0.9, maxTokens: 160, timeoutMs: 6000, reasoning: off }
    bookkeeping: { model: qwen-moe, temperature: 0.0, maxTokens: 400, timeoutMs: 15000, reasoning: off }
    judge: { model: qwen-moe, temperature: 0.0, maxTokens: 300, timeoutMs: 30000, reasoning: on }
active: gemma-voice
`;
    const result = parseModelsConfig(yaml, 'models.yaml');
    expect(result.ok, result.ok ? '' : formatConfigIssues(result.issues)).toBe(
      true,
    );
  });

  it('reports a bad nested field with its dotted path and file', () => {
    const yaml = `${preamble}
profiles:
  gemma-voice:
    voice: { model: gemma-31b, temperature: 9, maxTokens: 320, timeoutMs: 20000, reasoning: off }
    fast: { model: qwen-moe, temperature: 0.7, maxTokens: 220, timeoutMs: 8000, reasoning: off }
    narrator: { model: qwen-moe, temperature: 0.9, maxTokens: 160, timeoutMs: 6000, reasoning: off }
    bookkeeping: { model: qwen-moe, temperature: 0.0, maxTokens: 400, timeoutMs: 15000, reasoning: off }
    judge: { model: qwen-moe, temperature: 0.0, maxTokens: 300, timeoutMs: 30000, reasoning: on }
active: gemma-voice
`;
    const result = parseModelsConfig(yaml, 'models.yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].file).toBe('models.yaml');
    expect(result.issues[0].path).toBe('profiles.gemma-voice.voice.temperature');
    expect(formatConfigIssues(result.issues)).toContain(
      'models.yaml: profiles.gemma-voice.voice.temperature:',
    );
  });

  it('reports an unknown active profile on the active path', () => {
    const yaml = `${preamble}
profiles:
  gemma-voice:
    voice: { model: gemma-31b, temperature: 0.8, maxTokens: 320, timeoutMs: 20000, reasoning: off }
    fast: { model: qwen-moe, temperature: 0.7, maxTokens: 220, timeoutMs: 8000, reasoning: off }
    narrator: { model: qwen-moe, temperature: 0.9, maxTokens: 160, timeoutMs: 6000, reasoning: off }
    bookkeeping: { model: qwen-moe, temperature: 0.0, maxTokens: 400, timeoutMs: 15000, reasoning: off }
    judge: { model: qwen-moe, temperature: 0.0, maxTokens: 300, timeoutMs: 30000, reasoning: on }
active: missing-profile
`;
    const result = parseModelsConfig(yaml, 'models.yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === 'active')).toBe(true);
  });

  it('reports a role that names an undefined model at its model path', () => {
    const yaml = `${preamble}
profiles:
  gemma-voice:
    voice: { model: ghost-model, temperature: 0.8, maxTokens: 320, timeoutMs: 20000, reasoning: off }
    fast: { model: qwen-moe, temperature: 0.7, maxTokens: 220, timeoutMs: 8000, reasoning: off }
    narrator: { model: qwen-moe, temperature: 0.9, maxTokens: 160, timeoutMs: 6000, reasoning: off }
    bookkeeping: { model: qwen-moe, temperature: 0.0, maxTokens: 400, timeoutMs: 15000, reasoning: off }
    judge: { model: qwen-moe, temperature: 0.0, maxTokens: 300, timeoutMs: 30000, reasoning: on }
active: gemma-voice
`;
    const result = parseModelsConfig(yaml, 'models.yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some(
        (i) => i.path === 'profiles.gemma-voice.voice.model',
      ),
    ).toBe(true);
  });

  it('reports a YAML syntax error as a document-level issue', () => {
    const result = parseModelsConfig('endpoint: [unterminated', 'models.yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].path).toBe('');
    expect(formatConfigIssues(result.issues)).toMatch(/^models\.yaml: /);
  });
});

// --- the shipped default file ---------------------------------------------

// The schema requires `contextLength` and a `models` map, and each role's
// `model` must be a Load Identifier defined in that map. These assertions pin
// the shipped `config/models.yaml` to the v16.1 schema and the design's
// "Models config and Model Manager" shape: it loads and validates, ships the
// two named profiles, loads every role through a defined Load Identifier, keeps
// the judge on the profile's MoE model (never the voice model, so the
// judge-equals-voice harness warning never fires), and loads at a Context
// Length of 8192.
describe('default config/models.yaml (pinned by task 16.2)', () => {
  it('loads and validates', () => {
    const result = loadModelsConfig(defaultConfigPath);
    expect(result.ok, result.ok ? '' : formatConfigIssues(result.issues)).toBe(
      true,
    );
  });

  it('loads at a context length of 8192', () => {
    const result = loadModelsConfig(defaultConfigPath);
    if (!result.ok) throw new Error(formatConfigIssues(result.issues));
    expect(result.value.contextLength).toBe(8192);
  });

  it('ships the gemma-voice, qwen-voice and installed profiles with installed active', () => {
    const result = loadModelsConfig(defaultConfigPath);
    if (!result.ok) throw new Error(formatConfigIssues(result.issues));
    expect(Object.keys(result.value.profiles)).toEqual([
      'gemma-voice',
      'qwen-voice',
      'installed',
    ]);
    // `installed`: Qwen 3.8 27B voice + Qwen 3.6 35B-A3B MoE, the pair on the
    // developer's machine.
    expect(result.value.active).toBe('installed');
  });

  it('names a defined Load Identifier for every role in every profile', () => {
    const result = loadModelsConfig(defaultConfigPath);
    if (!result.ok) throw new Error(formatConfigIssues(result.issues));
    const loadIds = new Set(Object.keys(result.value.models));
    for (const profile of Object.values(result.value.profiles)) {
      for (const role of MODEL_ROLES) {
        expect(loadIds.has(profile[role].model)).toBe(true);
      }
    }
  });

  it('pins each entry to an MLX-then-GGUF source pair', () => {
    const result = loadModelsConfig(defaultConfigPath);
    if (!result.ok) throw new Error(formatConfigIssues(result.issues));
    expect(Object.keys(result.value.models)).toEqual([
      'gemma-31b',
      'qwen-moe',
      'qwen-27b',
      'gemma-moe',
      'qwen-27b-local',
    ]);
    for (const entry of Object.values(result.value.models)) {
      const [mlx, gguf] = entry.sources;
      expect(mlx.format).toBe('mlx');
      expect(gguf.format).toBe('gguf');
    }
  });

  it('keeps the judge on the profile MoE model, never the voice model', () => {
    const result = loadModelsConfig(defaultConfigPath);
    if (!result.ok) throw new Error(formatConfigIssues(result.issues));
    const expectedJudge: Record<string, string> = {
      'gemma-voice': 'qwen-moe',
      'qwen-voice': 'gemma-moe',
      installed: 'qwen-moe',
    };
    for (const [name, profile] of Object.entries(result.value.profiles)) {
      // The judge is the MoE model so the judge-equals-voice warning never fires.
      expect(profile.judge.model).toBe(expectedJudge[name]);
      expect(profile.judge.model).not.toBe(profile.voice.model);
    }
  });

  it('shares the MoE model across the fast, narrator, bookkeeping and judge roles', () => {
    const result = loadModelsConfig(defaultConfigPath);
    if (!result.ok) throw new Error(formatConfigIssues(result.issues));
    for (const profile of Object.values(result.value.profiles)) {
      const moe = profile.fast.model;
      expect(profile.narrator.model).toBe(moe);
      expect(profile.bookkeeping.model).toBe(moe);
      expect(profile.judge.model).toBe(moe);
      expect(profile.voice.model).not.toBe(moe);
    }
  });

  it('keeps at most two distinct resident models in the active profile', () => {
    const result = loadModelsConfig(defaultConfigPath);
    if (!result.ok) throw new Error(formatConfigIssues(result.issues));
    const active = result.value.profiles[result.value.active];
    const residents = new Set([
      active.voice.model,
      active.fast.model,
      active.narrator.model,
    ]);
    expect(residents.size).toBeLessThanOrEqual(2);
  });
});
