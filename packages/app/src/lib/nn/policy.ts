/**
 * The player network: a state encoder and an action encoder whose concatenation
 * is scored with one linear unit. A value head estimates the return for the
 * policy-gradient update.
 *
 * Choosing an action is a softmax over the legal actions this turn. The same
 * weights play every Difficulty Preset; the preset is a feature of the state.
 */

import { ACTION_DIM, STATE_DIM } from './features.js';
import {
  clipGlobal,
  Dense,
  mulberry32,
  relu,
  reluBackward,
  softmax,
} from './mlp.js';

export const DEFAULT_HIDDEN = 64;

export interface LayerDump {
  readonly w: number[];
  readonly b: number[];
}

export interface PolicyFile {
  readonly version: 1;
  readonly preset: string;
  readonly stateDim: number;
  readonly actionDim: number;
  readonly hidden: number;
  readonly state: LayerDump;
  readonly action: LayerDump;
  readonly out: LayerDump;
  readonly valueHidden: LayerDump;
  readonly valueOut: LayerDump;
}

interface PolicyCache {
  readonly state: Float64Array;
  readonly actions: readonly Float64Array[];
  readonly probs: Float64Array;
  readonly sMask: Uint8Array;
  readonly sH: Float64Array;
  readonly aMasks: readonly Uint8Array[];
  readonly aHs: readonly Float64Array[];
}

function dumpLayer(layer: Dense): LayerDump {
  return { w: [...layer.w], b: [...layer.b] };
}

/** Score legal actions and train that ranking. */
export class Policy {
  readonly hidden: number;
  private readonly stateNet: Dense;
  private readonly actionNet: Dense;
  private readonly out: Dense;
  private cache?: PolicyCache;
  private chosen = -1;

  constructor(hidden: number, rng: () => number) {
    this.hidden = hidden;
    this.stateNet = new Dense(hidden, STATE_DIM, rng);
    this.actionNet = new Dense(hidden, ACTION_DIM, rng);
    this.out = new Dense(1, hidden * 2, rng);
  }

  layers(): Dense[] {
    return [this.stateNet, this.actionNet, this.out];
  }

  /** Softmax over `actions` given `state`. Call {@link setChosen} before backward. */
  probs(state: Float64Array, actions: readonly Float64Array[]): Float64Array {
    if (actions.length === 0)
      throw new Error('the policy was given no legal actions');
    const sPre = this.stateNet.forward(state);
    const sAct = relu(sPre);
    const logits = new Float64Array(actions.length);
    const aMasks: Uint8Array[] = [];
    const aHs: Float64Array[] = [];
    for (let i = 0; i < actions.length; i += 1) {
      const aPre = this.actionNet.forward(actions[i]);
      const aAct = relu(aPre);
      aMasks.push(aAct.mask);
      aHs.push(aAct.y);
      const concat = new Float64Array(this.hidden * 2);
      concat.set(sAct.y, 0);
      concat.set(aAct.y, this.hidden);
      logits[i] = this.out.forward(concat)[0];
    }
    const probs = softmax(logits);
    this.cache = {
      state,
      actions,
      probs,
      sMask: sAct.mask,
      sH: sAct.y,
      aMasks,
      aHs,
    };
    this.chosen = -1;
    return probs;
  }

  setChosen(index: number): void {
    if (
      this.cache === undefined ||
      index < 0 ||
      index >= this.cache.probs.length
    ) {
      throw new Error(
        `chosen action ${index} is outside the last forward pass`,
      );
    }
    this.chosen = index;
  }

  /**
   * Accumulate the gradient of `-advantage * log pi(chosen) - entropyCoef * H`.
   * `advantage` is 1 for behavioural cloning (cross-entropy).
   */
  backwardDecision(advantage: number, entropyCoef: number): void {
    if (this.cache === undefined || this.chosen < 0) {
      throw new Error('probs and setChosen must run before backwardDecision');
    }
    const { state, actions, probs, sMask, sH, aMasks, aHs } = this.cache;
    let entropy = 0;
    for (let i = 0; i < probs.length; i += 1) {
      const p = Math.max(probs[i], 1e-8);
      entropy -= p * Math.log(p);
    }
    const dStateH = new Float64Array(this.hidden);
    for (let i = 0; i < probs.length; i += 1) {
      const p = probs[i];
      const safe = Math.max(p, 1e-8);
      const one = i === this.chosen ? 1 : 0;
      let dLogit = advantage * (p - one);
      dLogit += entropyCoef * safe * (Math.log(safe) + entropy);
      const concat = new Float64Array(this.hidden * 2);
      concat.set(sH, 0);
      concat.set(aHs[i], this.hidden);
      const dConcat = this.out.backward(concat, Float64Array.of(dLogit));
      for (let k = 0; k < this.hidden; k += 1) dStateH[k] += dConcat[k];
      const dAPre = reluBackward(dConcat.subarray(this.hidden), aMasks[i]);
      this.actionNet.backward(actions[i], dAPre);
    }
    this.stateNet.backward(state, reluBackward(dStateH, sMask));
  }

  zeroGrad(): void {
    for (const layer of this.layers()) layer.zeroGrad();
  }

  step(lr: number): void {
    for (const layer of this.layers()) layer.adam(lr);
  }

  dump(): { state: LayerDump; action: LayerDump; out: LayerDump } {
    return {
      state: dumpLayer(this.stateNet),
      action: dumpLayer(this.actionNet),
      out: dumpLayer(this.out),
    };
  }

  loadDump(dump: {
    state: LayerDump;
    action: LayerDump;
    out: LayerDump;
  }): void {
    this.stateNet.load(dump.state.w, dump.state.b);
    this.actionNet.load(dump.action.w, dump.action.b);
    this.out.load(dump.out.w, dump.out.b);
  }
}

/** A scalar estimate of return from a state, trained by squared error. */
export class ValueNet {
  private readonly hiddenLayer: Dense;
  private readonly out: Dense;
  private cache?: {
    state: Float64Array;
    mask: Uint8Array;
    h: Float64Array;
    value: number;
  };

  constructor(hidden: number, rng: () => number) {
    this.hiddenLayer = new Dense(hidden, STATE_DIM, rng);
    this.out = new Dense(1, hidden, rng);
  }

  layers(): Dense[] {
    return [this.hiddenLayer, this.out];
  }

  predict(state: Float64Array): number {
    const pre = this.hiddenLayer.forward(state);
    const activated = relu(pre);
    const value = this.out.forward(activated.y)[0];
    this.cache = { state, mask: activated.mask, h: activated.y, value };
    return value;
  }

  /** Accumulate the gradient of `(predict - target)`. */
  backward(target: number): void {
    if (this.cache === undefined)
      throw new Error('predict must run before backward');
    const { state, mask, h, value } = this.cache;
    const dH = this.out.backward(h, Float64Array.of(value - target));
    this.hiddenLayer.backward(state, reluBackward(dH, mask));
  }

  zeroGrad(): void {
    for (const layer of this.layers()) layer.zeroGrad();
  }

  step(lr: number): void {
    for (const layer of this.layers()) layer.adam(lr);
  }

  dump(): { hidden: LayerDump; out: LayerDump } {
    return { hidden: dumpLayer(this.hiddenLayer), out: dumpLayer(this.out) };
  }

  loadDump(dump: { hidden: LayerDump; out: LayerDump }): void {
    this.hiddenLayer.load(dump.hidden.w, dump.hidden.b);
    this.out.load(dump.out.w, dump.out.b);
  }
}

/** A policy and a value head that share one initialisation stream. */
export function createPlayer(
  seed: number,
  hidden = DEFAULT_HIDDEN,
): { policy: Policy; value: ValueNet } {
  const rng = mulberry32(seed);
  return {
    policy: new Policy(hidden, rng),
    value: new ValueNet(hidden, rng),
  };
}

export function policyFile(
  preset: string,
  policy: Policy,
  value: ValueNet,
): PolicyFile {
  const weights = policy.dump();
  const valueDump = value.dump();
  return {
    version: 1,
    preset,
    stateDim: STATE_DIM,
    actionDim: ACTION_DIM,
    hidden: policy.hidden,
    state: weights.state,
    action: weights.action,
    out: weights.out,
    valueHidden: valueDump.hidden,
    valueOut: valueDump.out,
  };
}

/** Rebuild a player from {@link policyFile}. The hidden width comes from the file. */
export function playerFromFile(file: PolicyFile): {
  policy: Policy;
  value: ValueNet;
} {
  if (file.version !== 1)
    throw new Error(`unknown policy file version ${file.version}`);
  if (file.stateDim !== STATE_DIM || file.actionDim !== ACTION_DIM) {
    throw new Error(
      `policy file features are ${file.stateDim}×${file.actionDim}, this build is ${STATE_DIM}×${ACTION_DIM}`,
    );
  }
  const { policy, value } = createPlayer(1, file.hidden);
  policy.loadDump({ state: file.state, action: file.action, out: file.out });
  value.loadDump({ hidden: file.valueHidden, out: file.valueOut });
  return { policy, value };
}

/** Clip `policy` and `value` together, then step both. */
export function clipAndStep(
  policy: Policy,
  value: ValueNet,
  maxNorm: number,
  policyLr: number,
  valueLr: number,
): void {
  clipGlobal([...policy.layers(), ...value.layers()], maxNorm);
  policy.step(policyLr);
  value.step(valueLr);
}
