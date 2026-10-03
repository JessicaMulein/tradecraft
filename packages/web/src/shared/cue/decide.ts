/**
 * The Cue Director's decision function (design, "Cue Director"; Requirement
 * 15.2, 15.3). Pure: no DOM, no Web Audio, no clock, no randomness. Its only
 * inputs are the Cue Map and Manifest (static), the previous Director state and
 * a {@link CueInputs}. Take choice happens in the player, never here.
 */

import { evaluate, type Context } from './predicate.js';
import type {
  CueDecision,
  CueInputs,
  CueManifest,
  CueMap,
  DirectorState,
  Rule,
  Transition,
} from './types.js';

export const DEFAULT_TRANSITION: Transition = { type: 'crossfade', seconds: 2 };

/** Whether a cue can actually play: it has a Take, or it is a Derived Cue of one that does. */
export function hasAudio(map: CueMap, manifest: CueManifest, cue: string, depth = 0): boolean {
  const takes = manifest.takes[cue];
  if (takes !== undefined && takes.length > 0) {
    return true;
  }
  const def = map.cues[cue];
  if (def?.from !== undefined && depth < 4) {
    return hasAudio(map, manifest, def.from, depth + 1);
  }
  return false;
}

export interface Decided {
  readonly decision: CueDecision;
  readonly next: DirectorState;
}

export function decide(
  map: CueMap,
  manifest: CueManifest,
  prev: DirectorState,
  inputs: CueInputs,
): Decided {
  const ctx: Context = { ...inputs, current: prev.cue };

  // Which hold rules are still true? A spent rule is released once it goes false.
  const matches = map.rules.map((r) => evaluate(r.when, ctx));
  const spent = prev.spent.filter((i) => matches[i] === true);

  // An active hold keeps its decision unless a more important rule now matches.
  if (prev.hold !== undefined && inputs.minutesInState < prev.hold.minutes) {
    const firstMatch = matches.indexOf(true);
    if (firstMatch === -1 || firstMatch >= prev.hold.rule) {
      return {
        decision: { music: undefined, transition: DEFAULT_TRANSITION, duck: false },
        next: { cue: prev.cue, hold: prev.hold, spent },
      };
    }
  }

  let chosen: { rule: Rule; index: number } | undefined;
  for (let i = 0; i < map.rules.length; i += 1) {
    const rule = map.rules[i] as Rule;
    if (matches[i] !== true) {
      continue;
    }
    const heldNow = prev.hold?.rule === i && inputs.minutesInState < prev.hold.minutes;
    if (rule.holdSeconds !== undefined && spent.includes(i) && !heldNow) {
      continue; // already held once for this run of the predicate
    }
    chosen = { rule, index: i };
    break;
  }

  if (chosen === undefined) {
    return {
      decision: { music: undefined, transition: DEFAULT_TRANSITION, duck: false },
      next: { cue: prev.cue, spent },
    };
  }

  const { rule, index } = chosen;
  let music: CueDecision['music'] = rule.music;
  if (music !== undefined && music !== 'silence' && !hasAudio(map, manifest, music)) {
    music = 'silence'; // a cue with no recording degrades to silence (Req 15.15)
  }
  const unchanged = music !== undefined && music === prev.cue;
  const decision: CueDecision = {
    music: unchanged ? undefined : music,
    ...(rule.stinger !== undefined && hasAudio(map, manifest, rule.stinger) ? { stinger: rule.stinger } : {}),
    ...(rule.ambience !== undefined
      ? rule.ambience === 'off' || hasAudio(map, manifest, rule.ambience)
        ? { ambience: rule.ambience }
        : {}
      : {}),
    transition: rule.transition ?? DEFAULT_TRANSITION,
    duck: rule.duck ?? false,
  };

  const nextCue = music === undefined ? prev.cue : music;
  const holding = rule.holdSeconds !== undefined && prev.hold?.rule !== index;
  return {
    decision,
    next: {
      cue: nextCue,
      ...(holding
        ? { hold: { rule: index, minutes: (rule.holdSeconds as number) / 60 } }
        : prev.hold !== undefined && prev.hold.rule === index && inputs.minutesInState < prev.hold.minutes
          ? { hold: prev.hold }
          : {}),
      spent: holding ? [...new Set([...spent, index])] : spent,
    },
  };
}

/**
 * Choose a Take: a random one other than the last when two or more exist.
 * Called by the player when a cue starts, never by {@link decide}. It takes no
 * argument derived from the game (Requirement 15.12; Property 10).
 */
export function pickTake<T>(takes: readonly T[], last: T | undefined, rand: () => number = Math.random): T | undefined {
  if (takes.length === 0) {
    return undefined;
  }
  const pool = takes.length > 1 && last !== undefined ? takes.filter((t) => t !== last) : takes;
  const i = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
  return pool[i];
}
