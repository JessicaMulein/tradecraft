/**
 * The network, the feature layout, and the teacher it clones. These tests stay
 * off the game so they run without generating a world.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTION_DIM,
  baseAction,
  baseState,
  encodeAction,
  encodeState,
  MOVE_KINDS,
  STATE_DIM,
} from './features.js';
import { Dense, softmax } from './mlp.js';
import { createPlayer, playerFromFile, policyFile } from './policy.js';
import { teacherChoice, teacherPriority } from './teacher.js';

describe('player features', () => {
  it('encodes a fixed state and action width', () => {
    expect(encodeState(baseState()).length).toBe(STATE_DIM);
    expect(encodeAction(baseAction('wait')).length).toBe(ACTION_DIM);
    expect(encodeAction(baseAction('say-ask')).length).toBe(ACTION_DIM);
    const drive = encodeAction(baseAction('street-ops.drive'));
    expect(drive[MOVE_KINDS.indexOf('street-ops.drive')]).toBe(1);
    expect(drive[MOVE_KINDS.indexOf('wait')]).toBe(0);
  });
});

describe('teacher ranking', () => {
  it('arrests the strongest case once it clears the threshold, ahead of unread paper', () => {
    const state = baseState({ maxEvidence: 8, arrestThreshold: 7 });
    const arrest = teacherPriority(
      state,
      baseAction('arrest', { targetIsBest: true, targetEvidence: 8 }),
    );
    const read = teacherPriority(
      state,
      baseAction('read', { unreadRead: true }),
    );
    expect(arrest).toBeGreaterThan(read);
  });

  it('takes the car when nothing in the case is here, and parks before another turn', () => {
    const state = baseState({ atStation: false, hereInClaims: false });
    const drive = teacherPriority(state, baseAction('street-ops.drive'));
    const wait = teacherPriority(state, baseAction('wait'));
    const park = teacherPriority(state, baseAction('street-ops.park'));
    const turn = teacherPriority(state, baseAction('street-ops.turn'));
    expect(drive).toBeGreaterThan(wait);
    expect(park).toBeGreaterThan(turn);
  });

  it('rides toward a city that holds a lead, and gets papers before it wanders', () => {
    const state = baseState();
    const depart = teacherPriority(
      state,
      baseAction('depart', { destClaimWeight: 1 }),
    );
    const papers = teacherPriority(state, baseAction('request-papers'));
    const idle = teacherPriority(state, baseAction('travel'));
    expect(depart).toBeGreaterThan(papers);
    expect(papers).toBeGreaterThan(idle);
  });

  it('breaks off a meeting when the last arrival may have been followed', () => {
    const state = baseState({ followed: true, unread: 1 });
    const stop = teacherPriority(
      state,
      baseAction('talk', { breakOff: true }),
    );
    const read = teacherPriority(
      state,
      baseAction('read', { unreadRead: true }),
    );
    const go = teacherPriority(baseState(), baseAction('talk', { breakOff: true }));
    expect(stop).toBeGreaterThan(read);
    expect(go).toBeLessThan(read);
  });

  it('reads unread documents before it waits', () => {
    const state = baseState({ unread: 2 });
    expect(
      teacherPriority(state, baseAction('read', { unreadRead: true })),
    ).toBeGreaterThan(teacherPriority(state, baseAction('wait')));
  });

  it('takes a countersurveillance route into a risky station', () => {
    const state = baseState({
      phasesSinceIntercept: 20,
      maxEvidence: 2,
      topSuspectTraced: false,
    });
    const shared = { destStation: true, destRisk: 0.8 };
    const direct = teacherPriority(
      state,
      baseAction('travel', { ...shared, riskyDirectTravel: true }),
    );
    const safe = teacherPriority(
      state,
      baseAction('travel', { ...shared, countersurveillance: true }),
    );
    expect(safe).toBeGreaterThan(direct);
  });

  it('prefers the claim location mentioned most often', () => {
    const state = baseState({
      phasesSinceIntercept: 0,
      topSuspectTraced: true,
      maxEvidence: 1,
    });
    const high = teacherPriority(
      state,
      baseAction('travel', { destClaimWeight: 1, destRisk: 0.1 }),
    );
    const low = teacherPriority(
      state,
      baseAction('travel', { destClaimWeight: 0.2, destRisk: 0.1 }),
    );
    expect(high).toBeGreaterThan(low);
  });

  it('keeps meeting a contact until headquarters approves a pitch', () => {
    const early = baseState({
      sceneOpen: true,
      linesInScene: 1,
      budget: 20,
      pitchApproved: false,
    });
    const reassure = teacherPriority(early, baseAction('say-reassure'));
    const pitch = teacherPriority(early, baseAction('say-pitch-money'));
    expect(reassure).toBeGreaterThan(pitch);

    const ready = baseState({
      sceneOpen: true,
      linesInScene: 1,
      budget: 20,
      pitchApproved: true,
    });
    const approved = teacherPriority(
      ready,
      baseAction('say-pitch-money', { targetRapport: 0.6 }),
    );
    const ask = teacherPriority(ready, baseAction('say-ask'));
    expect(approved).toBeGreaterThan(ask);
  });

  it('cables for a trace once the meetings are done', () => {
    const state = baseState({ atStation: true, recruitTrace: true });
    const trace = teacherPriority(
      state,
      baseAction('cable', { cableTraceRecruit: true }),
    );
    const wait = teacherPriority(state, baseAction('wait'));
    expect(trace).toBeGreaterThan(wait);
  });

  it('ends a conversation after three lines', () => {
    const state = baseState({ sceneOpen: true, linesInScene: 3 });
    const actions = [baseAction('say-ask'), baseAction('end-scene')];
    expect(teacherChoice(state, actions)).toBe(1);
  });
});

describe('dense net', () => {
  it('backpropagates a linear layer', () => {
    const layer = new Dense(1, 1, () => 0);
    layer.w[0] = 0.5;
    layer.b[0] = -0.25;
    const y = layer.forward(Float64Array.from([2]));
    expect(y[0]).toBeCloseTo(0.75);
    const dx = layer.backward(Float64Array.from([2]), Float64Array.from([4]));
    expect(layer.dw[0]).toBeCloseTo(8);
    expect(layer.db[0]).toBeCloseTo(4);
    expect(dx[0]).toBeCloseTo(2);
  });

  it('softmax sums to one', () => {
    const p = softmax(Float64Array.from([1, 2, 3]));
    expect(p[0] + p[1] + p[2]).toBeCloseTo(1);
    expect(p[2]).toBeGreaterThan(p[0]);
  });

  it('clones a preferred action and reloads the same preference', () => {
    const { policy, value } = createPlayer(7, 16);
    const state = new Float64Array(STATE_DIM);
    state[0] = 1;
    const chosen = new Float64Array(ACTION_DIM);
    const other = new Float64Array(ACTION_DIM);
    chosen[0] = 1;
    other[3] = 1;
    for (let step = 0; step < 60; step += 1) {
      policy.zeroGrad();
      policy.probs(state, [chosen, other]);
      policy.setChosen(0);
      policy.backwardDecision(1, 0);
      policy.step(0.08);
    }
    const probs = policy.probs(state, [chosen, other]);
    expect(probs[0]).toBeGreaterThan(0.8);

    const restored = playerFromFile(policyFile('easy', policy, value)).policy;
    const again = restored.probs(state, [chosen, other]);
    expect(again[0]).toBeCloseTo(probs[0]);
  });
});
