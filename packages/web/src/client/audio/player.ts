/**
 * Web Audio player. It executes decisions from the pure Director; it never
 * decides anything itself except which Take to play (pickTake, non-repeating).
 * Failure to load or decode a file degrades to silence (Requirement 15).
 */

import { pickTake } from '../../shared/cue/decide.js';
import type { CueDecision, CueDef, CueId, CueManifest, CueMap, Take } from '../../shared/cue/types.js';

interface Voice { src: AudioBufferSourceNode; gain: GainNode; cue: CueId }

const DUCK_LEVEL = 0.4;

export class AudioPlayer {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private readonly buffers = new Map<string, Promise<AudioBuffer | undefined>>();
  private music: Voice | undefined;
  private ambience: Voice | undefined;
  private readonly lastTake = new Map<CueId, Take>();
  private muted = false;
  private duckDepth = 0;

  constructor(
    private readonly map: CueMap,
    private readonly manifest: CueManifest,
    private readonly formats: readonly string[],
  ) {}

  /** Must be called from a user gesture. */
  resume(): void {
    if (this.ctx === undefined) {
      const Ctor = window.AudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master !== undefined && this.ctx !== undefined) {
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  apply(d: CueDecision): void {
    if (this.ctx === undefined) return; // not unlocked yet; the next decision will play
    if (d.music !== undefined) void this.playMusic(d.music, d);
    if (d.ambience !== undefined) void this.playAmbience(d.ambience);
    if (d.stinger !== undefined) void this.playStinger(d.stinger);
    this.setDuck(d.duck);
  }

  private setDuck(on: boolean): void {
    if (this.music === undefined || this.ctx === undefined) return;
    const target = (on ? DUCK_LEVEL : 1) * this.baseGain(this.music.cue);
    this.music.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
  }

  private def(cue: CueId): CueDef | undefined { return this.map.cues[cue]; }
  private baseGain(cue: CueId): number { return this.def(cue)?.gain ?? 1; }

  private resolve(cue: CueId, depth = 0): { take: Take; def: CueDef } | undefined {
    const def = this.def(cue);
    if (def === undefined || depth > 4) return undefined;
    if (def.from !== undefined) {
      const base = this.resolve(def.from, depth + 1);
      if (base === undefined) return undefined;
      const takes = this.manifest.takes[def.from] ?? [];
      const wanted = def.take !== undefined ? takes.find((t) => t.number === def.take) : undefined;
      return { take: wanted ?? base.take, def };
    }
    const takes = this.manifest.takes[cue] ?? [];
    const take = pickTake(takes, this.lastTake.get(cue));
    if (take === undefined) return undefined;
    this.lastTake.set(cue, take);
    return { take, def };
  }

  private url(take: Take): string | undefined {
    for (const f of this.formats) {
      const p = take.files[f as keyof Take['files']];
      if (p !== undefined) return '/audio/' + p.split('/').map(encodeURIComponent).join('/');
    }
    return undefined;
  }

  private load(take: Take): Promise<AudioBuffer | undefined> {
    const url = this.url(take);
    if (url === undefined || this.ctx === undefined) return Promise.resolve(undefined);
    let p = this.buffers.get(url);
    if (p === undefined) {
      const ctx = this.ctx;
      p = fetch(url, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => undefined);
      this.buffers.set(url, p);
    }
    return p;
  }

  /** Warm the cache for a cue without playing it. */
  prefetch(cue: CueId): void {
    if (this.ctx === undefined) return;
    const def = this.def(cue);
    const takes = this.manifest.takes[def?.from ?? cue] ?? [];
    for (const t of takes.slice(0, 2)) void this.load(t);
  }

  private sliceOf(take: Take, def: CueDef): { offset: number; end: number | undefined; loop: [number, number] | undefined } {
    const sec = def.slice?.section !== undefined ? take.meta?.sections?.[def.slice.section] : undefined;
    const offset = sec?.[0] ?? def.slice?.start ?? 0;
    const end = sec?.[1] ?? def.slice?.end;
    let loop: [number, number] | undefined;
    if (def.loop !== undefined && def.loop !== 'none') {
      const s = take.meta?.sections?.[def.loop.section];
      if (s !== undefined) loop = [s[0], s[1]];
    } else if (def.loop === undefined && def.kind !== 'stinger' && def.slice === undefined) {
      const m = take.meta;
      loop = m?.loopStart !== undefined && m.loopEnd !== undefined ? [m.loopStart, m.loopEnd] : undefined;
    }
    return { offset, end, loop };
  }

  private start(buf: AudioBuffer, take: Take, def: CueDef, cue: CueId, fadeIn: number, level: number): Voice | undefined {
    const ctx = this.ctx, master = this.master;
    if (ctx === undefined || master === undefined) return undefined;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(master);
    const { offset, end, loop } = this.sliceOf(take, def);
    const t0 = ctx.currentTime;
    const target = level * (def.gain ?? 1);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(target, t0 + Math.max(fadeIn, 0.01));
    if (loop !== undefined) {
      src.loop = true; src.loopStart = loop[0]; src.loopEnd = loop[1];
      src.start(t0, offset);
    } else if (end !== undefined) {
      const dur = Math.max(0.1, end - offset);
      src.start(t0, offset, dur);
      const fo = def.fadeOut ?? 3;
      gain.gain.setValueAtTime(target, t0 + Math.max(fadeIn, dur - fo));
      gain.gain.linearRampToValueAtTime(0, t0 + dur);
    } else {
      src.start(t0, offset);
    }
    return { src, gain, cue };
  }

  private stop(v: Voice | undefined, fade: number): void {
    if (v === undefined || this.ctx === undefined) return;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + Math.max(fade, 0.01));
    try { v.src.stop(t + fade + 0.05); } catch { /* already stopped */ }
  }

  private async playMusic(cue: CueId | 'silence', d: CueDecision): Promise<void> {
    const fade = d.transition.type === 'cut' ? 0.01 : d.transition.type === 'crossfade' ? d.transition.seconds : 2;
    if (cue === 'silence') {
      this.stop(this.music, fade);
      this.music = undefined;
      return;
    }
    const r = this.resolve(cue);
    const buf = r === undefined ? undefined : await this.load(r.take);
    if (r === undefined || buf === undefined) {
      this.stop(this.music, fade); // missing audio degrades to silence
      this.music = undefined;
      return;
    }
    this.stop(this.music, fade);
    this.music = this.start(buf, r.take, r.def, cue, fade, d.duck ? DUCK_LEVEL : 1);
  }

  private async playAmbience(cue: CueId | 'off'): Promise<void> {
    if (cue === 'off') { this.stop(this.ambience, 2); this.ambience = undefined; return; }
    const r = this.resolve(cue);
    const buf = r === undefined ? undefined : await this.load(r.take);
    this.stop(this.ambience, 2);
    this.ambience = r === undefined || buf === undefined ? undefined : this.start(buf, r.take, r.def, cue, 2, 1);
  }

  private async playStinger(cue: CueId): Promise<void> {
    const r = this.resolve(cue);
    const buf = r === undefined ? undefined : await this.load(r.take);
    if (r === undefined || buf === undefined) return;
    this.duckDepth += 1;
    this.setDuck(true);
    const v = this.start(buf, r.take, r.def, cue, 0.05, 1);
    if (v === undefined) return;
    v.src.onended = () => {
      this.duckDepth -= 1;
      if (this.duckDepth <= 0) this.setDuck(false);
    };
  }
}
