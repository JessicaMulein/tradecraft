/**
 * The honest player never reads the true cipher spec. One easy game is enough
 * to show that the workbench, the word list and the catalogue can break a
 * message. It is not a calibration band: the expert, idle and reckless bands
 * stay where they are.
 */

import { describe, expect, it } from 'vitest';

import { playHonest } from './playability-honest.js';
import { claimsOf, ScriptedGame } from './scripted-games.js';

describe('honest player', () => {
  it(
    'breaks a collected message from the workbench alone',
    async () => {
      const game = await ScriptedGame.start({ seed: 'calibration-0', preset: 'easy' });
      const before = claimsOf(game).filter((claim) => claim.source.kind === 'intercept').length;
      await playHonest(game, 100);
      const broken = claimsOf(game).filter((claim) => claim.source.kind === 'intercept');
      const decrypts = game.turns.filter((turn) => turn.action.kind === 'decrypt');
      expect(decrypts.length).toBeGreaterThan(0);
      expect(broken.length).toBeGreaterThan(before);
    },
    180_000,
  );
});
