/**
 * Campaign creation (campaign-career task 13.1; Requirement 1).
 *
 * The screen gathers a seed, a difficulty preset, an officer name, a background
 * and a start year, then signals a `create` choice. An empty seed is omitted so
 * the campaign engine generates one. The screen does not load content or start
 * the career itself.
 */

import { useReducer, useState, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CampaignChoice } from '@tradecraft/player-view';

import { DIFFICULTY_PRESETS, type DifficultyPresetId } from '../start/options.js';

export const CAMPAIGN_START_YEARS = [1948, 1949, 1950] as const;

export interface CampaignBackground {
  readonly id: string;
  readonly label: string;
}

const FIELDS = ['seed', 'preset', 'name', 'background', 'year'] as const;

type CreationField = (typeof FIELDS)[number];

export interface CreationState {
  readonly focus: CreationField;
  readonly seed: string;
  readonly preset: DifficultyPresetId;
  readonly name: string;
  readonly background: string;
  readonly year: (typeof CAMPAIGN_START_YEARS)[number];
}

type CreationAction =
  | { readonly type: 'focus-next' }
  | { readonly type: 'focus-prev' }
  | { readonly type: 'cycle-next' }
  | { readonly type: 'cycle-prev' }
  | { readonly type: 'type'; readonly char: string }
  | { readonly type: 'backspace' };

export interface CreationScreenProps {
  readonly backgrounds: readonly CampaignBackground[];
  readonly defaults?: Partial<Omit<CreationState, 'focus' | 'background' | 'year'>> & {
    readonly background?: string;
    readonly year?: CreationState['year'];
  };
  readonly onCreate: (choice: Extract<CampaignChoice, { kind: 'create' }>) => void;
}

const LABELS: Readonly<Record<CreationField, string>> = {
  seed: 'Seed',
  preset: 'Difficulty',
  name: 'Officer',
  background: 'Background',
  year: 'Start year',
};

function cycle<T>(items: readonly T[], current: T, step: number): T {
  if (items.length === 0) {
    return current;
  }
  const index = items.indexOf(current);
  const base = index === -1 ? 0 : index;
  const next = (base + step + items.length) % items.length;
  return items[next] as T;
}

export function initialCreationState(
  backgrounds: readonly CampaignBackground[],
  defaults: CreationScreenProps['defaults'],
): CreationState {
  const first = backgrounds[0]?.id ?? '';
  const background = defaults?.background ?? first;
  const year = defaults?.year ?? CAMPAIGN_START_YEARS[0];
  return {
    focus: 'seed',
    seed: defaults?.seed ?? '',
    preset: defaults?.preset ?? 'standard',
    name: defaults?.name ?? '',
    background: backgrounds.some((row) => row.id === background) ? background : first,
    year,
  };
}

export function toCreateChoice(
  state: CreationState,
): Extract<CampaignChoice, { kind: 'create' }> {
  return {
    kind: 'create',
    ...(state.seed === '' ? {} : { seed: state.seed }),
    preset: state.preset,
    officerName: state.name,
    background: state.background,
    startYear: state.year,
  };
}

function reduceCreation(
  state: CreationState,
  action: CreationAction,
  backgrounds: readonly CampaignBackground[],
): CreationState {
  switch (action.type) {
    case 'focus-next':
      return { ...state, focus: cycle(FIELDS, state.focus, 1) };
    case 'focus-prev':
      return { ...state, focus: cycle(FIELDS, state.focus, -1) };
    case 'cycle-next':
    case 'cycle-prev':
      return cycleField(state, action.type === 'cycle-next' ? 1 : -1, backgrounds);
    case 'type':
      return typeInto(state, action.char);
    case 'backspace':
      return erase(state);
    default:
      return state;
  }
}

function cycleField(
  state: CreationState,
  step: number,
  backgrounds: readonly CampaignBackground[],
): CreationState {
  if (state.focus === 'preset') {
    return { ...state, preset: cycle(DIFFICULTY_PRESETS, state.preset, step) };
  }
  if (state.focus === 'background') {
    const ids = backgrounds.map((row) => row.id);
    return { ...state, background: cycle(ids, state.background, step) };
  }
  if (state.focus === 'year') {
    return { ...state, year: cycle(CAMPAIGN_START_YEARS, state.year, step) };
  }
  return state;
}

function typeInto(state: CreationState, char: string): CreationState {
  if (state.focus === 'seed') {
    return { ...state, seed: state.seed + char };
  }
  if (state.focus === 'name') {
    return { ...state, name: state.name + char };
  }
  return state;
}

function erase(state: CreationState): CreationState {
  if (state.focus === 'seed') {
    return { ...state, seed: state.seed.slice(0, -1) };
  }
  if (state.focus === 'name') {
    return { ...state, name: state.name.slice(0, -1) };
  }
  return state;
}

function rowValue(
  field: CreationField,
  state: CreationState,
  backgrounds: readonly CampaignBackground[],
): string {
  if (field === 'seed') {
    return state.seed === '' ? '(generated on start)' : state.seed;
  }
  if (field === 'preset') {
    return state.preset;
  }
  if (field === 'name') {
    return state.name === '' ? '(enter a name)' : state.name;
  }
  if (field === 'background') {
    return backgrounds.find((row) => row.id === state.background)?.label ?? '(none)';
  }
  return String(state.year);
}

export function CreationScreen({
  backgrounds,
  defaults,
  onCreate,
}: CreationScreenProps): ReactElement {
  const [state, dispatch] = useReducer(
    (current: CreationState, action: CreationAction) => reduceCreation(current, action, backgrounds),
    initialCreationState(backgrounds, defaults),
  );
  const [notice, setNotice] = useState('');

  useInput((input, key) => {
    if (key.upArrow || (key.tab && key.shift)) {
      dispatch({ type: 'focus-prev' });
      return;
    }
    if (key.downArrow || (key.tab && !key.shift)) {
      dispatch({ type: 'focus-next' });
      return;
    }
    if (key.leftArrow) {
      dispatch({ type: 'cycle-prev' });
      return;
    }
    if (key.rightArrow) {
      dispatch({ type: 'cycle-next' });
      return;
    }
    if (key.return) {
      if (state.name.trim() === '') {
        setNotice('Enter an officer name.');
        return;
      }
      if (state.background === '') {
        setNotice('Choose a background.');
        return;
      }
      setNotice('');
      onCreate(toCreateChoice(state));
      return;
    }
    if (key.backspace || key.delete) {
      dispatch({ type: 'backspace' });
      return;
    }
    if (input !== '' && !key.ctrl && !key.meta) {
      dispatch({ type: 'type', char: input });
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>New Career</Text>
      <Box flexDirection="column" marginTop={1}>
        {FIELDS.map((field) => {
          const focused = state.focus === field;
          return (
            <Text key={field} color={focused ? 'cyan' : undefined}>
              {focused ? '> ' : '  '}
              {LABELS[field]}: {rowValue(field, state, backgrounds)}
            </Text>
          );
        })}
      </Box>
      {notice === '' ? null : (
        <Box marginTop={1}>
          <Text color="yellow">{notice}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · ←/→ change · type the seed and name · Enter to begin</Text>
      </Box>
    </Box>
  );
}
