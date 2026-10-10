/**
 * The teacher the network clones.
 *
 * It ranks legal actions from the same {@link StateContext} and
 * {@link ActionContext} the network sees. It never reads the Plot, the Cell
 * leader, or anyone's true allegiance. Training labels are this ranking, so a
 * network that fits it plays the same way.
 */

import type { ActionContext, StateContext } from './features.js';

function needsStation(state: StateContext): boolean {
  return (
    state.phasesSinceIntercept >= 8 ||
    (state.maxEvidence > 0 && !state.topSuspectTraced) ||
    state.recruitTrace
  );
}

function travelScore(state: StateContext, action: ActionContext): number {
  const claim = action.destClaimWeight > 0 && !action.destSurveilledRecently;
  const station = action.destStation && needsStation(state);
  if (!claim && !station) return action.riskyDirectTravel ? 1 : 4;
  const base = station ? 64 : 48 + 10 * action.destClaimWeight;
  if (action.riskyDirectTravel) return base - 25;
  const safeDirect = !action.countersurveillance && action.destRisk < 0.45;
  const safeCs = action.countersurveillance && action.destRisk >= 0.45;
  return safeDirect || safeCs ? base + 1 : base;
}

/**
 * How strongly the teacher wants this action. Higher wins. Equal scores keep
 * the earlier action in the list.
 */
export function teacherPriority(
  state: StateContext,
  action: ActionContext,
): number {
  if (state.sceneOpen) {
    if (state.linesInScene >= 3 && action.kind === 'end-scene') return 90;
    if (
      action.kind === 'say-reassure' &&
      !state.pitchApproved &&
      state.linesInScene < 3
    ) {
      return 80;
    }
    if (
      state.pitchApproved &&
      (action.kind === 'say-pitch-money' || action.kind === 'say-pitch-ideology') &&
      state.linesInScene >= 1 &&
      state.linesInScene < 3
    ) {
      return action.kind === 'say-pitch-money' && state.budget >= 5 ? 84 : 82;
    }
    if (action.kind === 'say-ask' && state.linesInScene === 0) return 70;
    if (action.kind === 'end-scene') return 30;
    return 0;
  }

  if (
    action.kind === 'arrest' &&
    action.targetIsBest &&
    state.maxEvidence >= state.arrestThreshold
  ) {
    return 100;
  }
  if (action.kind === 'talk' && action.breakOff) {
    return state.followed ? 92 : 1;
  }
  if (action.kind === 'read' && action.unreadRead) return 90;
  if (action.kind === 'decrypt' && action.breakableDecrypt) return 86;
  if (action.kind === 'attend-duty') return 75;
  if (
    action.kind === 'cable' &&
    action.cableTraceRecruit &&
    state.atStation &&
    state.recruitTrace
  ) {
    return 78;
  }
  if (
    action.kind === 'cable' &&
    action.cableTraceBest &&
    state.atStation &&
    !state.topSuspectTraced &&
    state.maxEvidence > 0
  ) {
    return 72;
  }
  if (
    action.kind === 'intercept' &&
    state.atStation &&
    state.phasesSinceIntercept >= 8
  ) {
    return 70;
  }
  if (
    action.kind === 'surveil' &&
    state.hereInClaims &&
    !state.hereSurveilledRecently
  ) {
    return 67;
  }
  if (
    action.kind === 'follow' &&
    action.targetVisible &&
    action.targetClaims > 0
  )
    return 60;
  if (action.kind === 'travel') return travelScore(state, action);
  if (action.kind === 'depart') {
    if (action.destClaimWeight <= 0) return 8;
    return 48 + 10 * action.destClaimWeight;
  }
  if (action.kind === 'request-papers') return 42;
  if (action.kind === 'apply-visa') return 40;
  if (
    action.kind === 'liaison-request' &&
    state.maxEvidence > 0 &&
    state.maxEvidence < state.arrestThreshold
  ) {
    return 36;
  }
  if (
    action.kind === 'cable' &&
    action.cableFunds &&
    state.atStation &&
    state.budget < 8
  ) {
    return 50;
  }
  if (
    (action.kind === 'talk' || action.kind === 'approach') &&
    action.targetVisible &&
    !action.targetAsset &&
    !action.targetHostile &&
    state.approachesToday < 2
  ) {
    return 28;
  }
  if (action.kind === 'wait' && action.waitPhases === 1) return 12;
  if (action.kind === 'street-ops.drive' && !state.atStation && !state.hereInClaims) return 20;
  if (action.kind === 'street-ops.park') return 19;
  if (action.kind === 'street-ops.turn') return 16;
  if (action.kind.startsWith('street-ops.')) return 8;
  return 1;
}

/** The teacher's choice: the highest {@link teacherPriority}, earlier on a tie. */
export function teacherChoice(
  state: StateContext,
  actions: readonly ActionContext[],
): number {
  let best = 0;
  let score = -Infinity;
  for (let i = 0; i < actions.length; i += 1) {
    const next = teacherPriority(state, actions[i]);
    if (next > score) {
      score = next;
      best = i;
    }
  }
  return best;
}
