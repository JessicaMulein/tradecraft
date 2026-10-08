/**
 * A small dense network: linear layers, ReLU, softmax, and Adam.
 *
 * The player policy is built from these pieces so a game can train and run
 * without a native tensor library. Weights are plain arrays and round-trip
 * through JSON.
 */

/** Seeded uniform generator in `[0, 1)`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** y = max(0, pre), with the mask a backward pass needs. */
export function relu(pre: Float64Array): { y: Float64Array; mask: Uint8Array } {
  const y = new Float64Array(pre.length);
  const mask = new Uint8Array(pre.length);
  for (let i = 0; i < pre.length; i += 1) {
    if (pre[i] > 0) {
      y[i] = pre[i];
      mask[i] = 1;
    }
  }
  return { y, mask };
}

/** Gradient of {@link relu} given the upstream gradient. */
export function reluBackward(dy: Float64Array, mask: Uint8Array): Float64Array {
  const dx = new Float64Array(dy.length);
  for (let i = 0; i < dy.length; i += 1) {
    if (mask[i] === 1) dx[i] = dy[i];
  }
  return dx;
}

/** Stable softmax. The entries sum to 1. */
export function softmax(logits: ArrayLike<number>): Float64Array {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i += 1) {
    if (logits[i] > max) max = logits[i];
  }
  const out = new Float64Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i += 1) {
    const e = Math.exp(logits[i] - max);
    out[i] = e;
    sum += e;
  }
  const scale = sum === 0 ? 1 : sum;
  for (let i = 0; i < out.length; i += 1) out[i] /= scale;
  return out;
}

/** Index of the largest entry. Ties keep the earlier index. */
export function argmax(values: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

/** Sample an index from a distribution that sums to 1. */
export function sampleIndex(
  probs: ArrayLike<number>,
  rng: () => number,
): number {
  const r = rng();
  let acc = 0;
  for (let i = 0; i < probs.length; i += 1) {
    acc += probs[i];
    if (r <= acc) return i;
  }
  return Math.max(0, probs.length - 1);
}

/**
 * One dense layer, `y = Wx + b`, with accumulated gradients and Adam moments.
 * `w` is row-major, `rows * cols`.
 */
export class Dense {
  readonly rows: number;
  readonly cols: number;
  readonly w: Float64Array;
  readonly b: Float64Array;
  readonly dw: Float64Array;
  readonly db: Float64Array;
  private readonly mw: Float64Array;
  private readonly vw: Float64Array;
  private readonly mb: Float64Array;
  private readonly vb: Float64Array;
  private t = 0;

  constructor(rows: number, cols: number, rng: () => number) {
    this.rows = rows;
    this.cols = cols;
    const n = rows * cols;
    this.w = new Float64Array(n);
    this.dw = new Float64Array(n);
    this.mw = new Float64Array(n);
    this.vw = new Float64Array(n);
    this.b = new Float64Array(rows);
    this.db = new Float64Array(rows);
    this.mb = new Float64Array(rows);
    this.vb = new Float64Array(rows);
    const scale = Math.sqrt(2 / cols);
    for (let i = 0; i < n; i += 1) this.w[i] = (rng() * 2 - 1) * scale;
  }

  forward(x: Float64Array): Float64Array {
    const y = new Float64Array(this.rows);
    for (let r = 0; r < this.rows; r += 1) {
      let s = this.b[r];
      const off = r * this.cols;
      for (let c = 0; c < this.cols; c += 1) s += this.w[off + c] * x[c];
      y[r] = s;
    }
    return y;
  }

  /** Accumulate `dL/dW` and `dL/db` and return `dL/dx`. */
  backward(x: Float64Array, dy: Float64Array): Float64Array {
    const dx = new Float64Array(this.cols);
    for (let r = 0; r < this.rows; r += 1) {
      const g = dy[r];
      this.db[r] += g;
      const off = r * this.cols;
      for (let c = 0; c < this.cols; c += 1) {
        this.dw[off + c] += g * x[c];
        dx[c] += g * this.w[off + c];
      }
    }
    return dx;
  }

  zeroGrad(): void {
    this.dw.fill(0);
    this.db.fill(0);
  }

  gradNormSq(): number {
    let s = 0;
    for (let i = 0; i < this.dw.length; i += 1) s += this.dw[i] * this.dw[i];
    for (let i = 0; i < this.db.length; i += 1) s += this.db[i] * this.db[i];
    return s;
  }

  scaleGrad(scale: number): void {
    for (let i = 0; i < this.dw.length; i += 1) this.dw[i] *= scale;
    for (let i = 0; i < this.db.length; i += 1) this.db[i] *= scale;
  }

  adam(lr: number, beta1 = 0.9, beta2 = 0.999, eps = 1e-8): void {
    this.t += 1;
    const bc1 = 1 - beta1 ** this.t;
    const bc2 = 1 - beta2 ** this.t;
    for (let i = 0; i < this.w.length; i += 1) {
      this.mw[i] = beta1 * this.mw[i] + (1 - beta1) * this.dw[i];
      this.vw[i] = beta2 * this.vw[i] + (1 - beta2) * this.dw[i] * this.dw[i];
      this.w[i] -=
        (lr * (this.mw[i] / bc1)) / (Math.sqrt(this.vw[i] / bc2) + eps);
    }
    for (let i = 0; i < this.b.length; i += 1) {
      this.mb[i] = beta1 * this.mb[i] + (1 - beta1) * this.db[i];
      this.vb[i] = beta2 * this.vb[i] + (1 - beta2) * this.db[i] * this.db[i];
      this.b[i] -=
        (lr * (this.mb[i] / bc1)) / (Math.sqrt(this.vb[i] / bc2) + eps);
    }
  }

  load(w: ArrayLike<number>, b: ArrayLike<number>): void {
    if (w.length !== this.w.length || b.length !== this.b.length) {
      throw new Error(
        `dense shape mismatch: got ${w.length}+${b.length}, expected ${this.w.length}+${this.b.length}`,
      );
    }
    this.w.set(w);
    this.b.set(b);
    this.mw.fill(0);
    this.vw.fill(0);
    this.mb.fill(0);
    this.vb.fill(0);
    this.t = 0;
    this.zeroGrad();
  }
}

/** Scale every layer's gradient so the global norm is at most `maxNorm`. */
export function clipGlobal(layers: readonly Dense[], maxNorm: number): void {
  let sum = 0;
  for (const layer of layers) sum += layer.gradNormSq();
  const norm = Math.sqrt(sum);
  if (norm > maxNorm && norm > 0) {
    const scale = maxNorm / norm;
    for (const layer of layers) layer.scaleGrad(scale);
  }
}
