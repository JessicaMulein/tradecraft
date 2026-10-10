/**
 * A stand-in for a player who never reads the answer key.
 *
 * The expert probe in the calibration harness breaks traffic with the true
 * cipher spec. This player uses only the catalogue, the case file and the
 * workbench: the ciphertext, the index of coincidence and the shift preview.
 * A wrong guess spends a phase, the same way it does at the workbench. The
 * word list is the one the traffic is drawn from; the player does not know
 * which word was picked.
 */

import { CIPHER_KEYWORDS, type CipherSpec } from '@tradecraft/engine';
import type { KeyCoincidence } from '@tradecraft/player-view';

import { type ScriptedGame } from './scripted-games.js';

const ENGLISH = 'ETAOINSHRDLUCMFWYGPBVKJXQZ';

interface GuessState {
  /** A monoalphabetic reading has already been submitted. */
  caesar: boolean;
  /** How many word guesses have been submitted for this message. */
  step: number;
}

/** How English a caesar preview looks. Higher is closer to ordinary letter use. */
function englishScore(text: string): number {
  const letters = text.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length === 0) {
    return 0;
  }
  let score = 0;
  for (const ch of letters) {
    const rank = ENGLISH.indexOf(ch);
    if (rank >= 0) {
      score += ENGLISH.length - rank;
    }
  }
  return score / letters.length;
}

/** Words of the most likely key length first, then the rest of the list. */
function wordsToTry(coincidence: KeyCoincidence): readonly string[] {
  const rows = [...coincidence.rows].sort((a, b) => b.coincidence - a.coincidence);
  const ordered: string[] = [];
  for (const row of rows) {
    for (const word of CIPHER_KEYWORDS) {
      if (word.length === row.length && !ordered.includes(word)) {
        ordered.push(word);
      }
    }
  }
  return ordered;
}

/**
 * Play until the game ends, the turn budget runs out, or nothing offered
 * moves the case. Arrests, reading, listening and watching come from the
 * catalogue. Cipher guesses come from the workbench.
 */
export async function playHonest(game: ScriptedGame, maxTurns = 100): Promise<void> {
  const guesses = new Map<string, GuessState>();
  const read = new Set<string>();
  const watched = new Set<string>();
  let idle = 0;

  const hello = game.offered((action) => action.kind === 'talk');
  if (hello !== undefined) {
    await game.play(hello);
  }

  while (!game.over && game.turns.length < maxTurns && idle < 4) {
    const moved = await step(game, guesses, read, watched);
    if (moved) {
      idle = 0;
    } else {
      const wait = game.offered((action) => action.kind === 'wait' && action.phases === 1);
      if (wait === undefined) {
        return;
      }
      await game.play(wait);
      idle += 1;
    }
  }
}

async function step(
  game: ScriptedGame,
  guesses: Map<string, GuessState>,
  read: Set<string>,
  watched: Set<string>,
): Promise<boolean> {
  const arrest = bestArrest(game);
  if (arrest !== undefined) {
    await game.play(arrest);
    return true;
  }

  const document = game.offered(
    (action) => action.kind === 'read' && !read.has(action.doc),
  );
  if (document !== undefined && document.action.kind === 'read') {
    read.add(document.action.doc);
    await game.play(document);
    return true;
  }

  if (await breakOne(game, guesses)) {
    return true;
  }

  const listen = game.offered((action) => action.kind === 'intercept');
  if (listen !== undefined) {
    await game.play(listen);
    return true;
  }

  const station = game.offered(
    (action) => action.kind === 'travel' && action.to.includes('station-hq') && !action.countersurveillance,
  );
  if (station !== undefined) {
    await game.play(station);
    return true;
  }

  const here = game.api.status().location.id;
  const watchKey = `${game.time.day}:${here}`;
  const watch = game.offered(
    (action) => action.kind === 'surveil' && action.phases === 1 && action.at === here,
  );
  if (watch !== undefined && !watched.has(watchKey)) {
    watched.add(watchKey);
    await game.play(watch);
    return true;
  }

  return false;
}

/** The allowed arrest with the strongest case the file will support. */
function bestArrest(game: ScriptedGame) {
  let chosen: ReturnType<ScriptedGame['offered']> = undefined;
  let best = 0;
  for (const option of game.api.actions()) {
    if (!option.quote.allowed || option.action.kind !== 'arrest') {
      continue;
    }
    const evidence = game.api.caseFile.evidence(option.action.npc);
    if (evidence > best) {
      best = evidence;
      chosen = option;
    }
  }
  return chosen;
}

/**
 * One guess at one unbroken message. A high whole-text coincidence is read as
 * a single alphabet and the best shift preview is submitted once. Otherwise
 * the likely key length is tried as a word, first as Vigenère, then columnar.
 */
async function breakOne(game: ScriptedGame, guesses: Map<string, GuessState>): Promise<boolean> {
  const option = game.api.actions().find((row) => {
    if (!row.quote.allowed || row.action.kind !== 'decrypt') {
      return false;
    }
    return nextSpec(game, row.action.intercept, guesses) !== undefined;
  });
  if (option === undefined || option.action.kind !== 'decrypt') {
    return false;
  }
  const spec = nextSpec(game, option.action.intercept, guesses);
  if (spec === undefined) {
    return false;
  }
  noteGuess(guesses, option.action.intercept, spec);
  await game.play(option, (template) => {
    if (template.kind !== 'decrypt') {
      return template;
    }
    return { ...template, submission: { kind: 'key', spec } };
  });
  return true;
}

function nextSpec(
  game: ScriptedGame,
  id: string,
  guesses: Map<string, GuessState>,
): CipherSpec | undefined {
  const view = game.api.views.workbench(id as Parameters<typeof game.api.views.workbench>[0]);
  const state = guesses.get(id) ?? { caesar: false, step: 0 };
  if (!state.caesar && view.coincidence.overall >= 0.06) {
    let bestShift = 0;
    let bestScore = -1;
    for (const row of view.shiftPreview) {
      const score = englishScore(row.text);
      if (score > bestScore) {
        bestScore = score;
        bestShift = row.shift;
      }
    }
    return { kind: 'caesar', shift: bestShift };
  }
  const words = wordsToTry(view.coincidence);
  const peak = view.coincidence.rows.reduce((best, row) =>
    row.coincidence > best.coincidence ? row : best,
  );
  const preferred = words.filter((word) => word.length === peak.length);
  const list = preferred.length > 0 ? preferred : words.slice(0, 8);
  if (state.step < list.length) {
    return { kind: 'vigenere', key: list[state.step] ?? '' };
  }
  const columnar = state.step - list.length;
  if (columnar < list.length) {
    return { kind: 'columnar', key: list[columnar] ?? '' };
  }
  return undefined;
}

function noteGuess(guesses: Map<string, GuessState>, id: string, spec: CipherSpec): void {
  const state = guesses.get(id) ?? { caesar: false, step: 0 };
  if (spec.kind === 'caesar') {
    guesses.set(id, { ...state, caesar: true });
    return;
  }
  guesses.set(id, { caesar: true, step: state.step + 1 });
}
