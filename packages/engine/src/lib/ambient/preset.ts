/**
 * Design-table defaults for the optional preset `ambient` block. Omitted
 * fields on a slice preset keep the pinned preset comparison intact.
 */

export interface AmbientPresetValues {
  readonly eventDensity: number;
  readonly policeBaseline: number;
  readonly informantDensity: number;
  readonly gossipDistortion: number;
  readonly informantBonus: number;
  readonly maxPlotDelayDays: number;
  readonly maxCoverSuspicionPerDay: number;
}

const TABLES: Readonly<Record<string, AmbientPresetValues>> = {
  easy: {
    eventDensity: 0.8,
    policeBaseline: 0.2,
    informantDensity: 0.03,
    gossipDistortion: 0.1,
    informantBonus: 0.02,
    maxPlotDelayDays: 3,
    maxCoverSuspicionPerDay: 0.05,
  },
  standard: {
    eventDensity: 1,
    policeBaseline: 0.3,
    informantDensity: 0.06,
    gossipDistortion: 0.2,
    informantBonus: 0.05,
    maxPlotDelayDays: 2,
    maxCoverSuspicionPerDay: 0.08,
  },
  hard: {
    eventDensity: 1.2,
    policeBaseline: 0.45,
    informantDensity: 0.1,
    gossipDistortion: 0.3,
    informantBonus: 0.08,
    maxPlotDelayDays: 1,
    maxCoverSuspicionPerDay: 0.12,
  },
};

export function ambientPreset(
  id: string,
  overrides?: Partial<AmbientPresetValues>,
): AmbientPresetValues {
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  const base = TABLES[bare] ?? TABLES.standard;
  return { ...(base as AmbientPresetValues), ...overrides };
}
