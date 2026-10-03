/** Fills CueInputs only from API data the player already sees, then runs decide. */
import { decide } from '../shared/cue/decide.js';
import { INITIAL_DIRECTOR_STATE, type CueInputs, type CueManifest, type CueMap, type DirectorState } from '../shared/cue/types.js';
import type { AudioPlayer } from './audio/player.js';

export class Director {
  private state: DirectorState = INITIAL_DIRECTOR_STATE;
  private enteredAt = Date.now();
  private lastCue: string | undefined;
  constructor(private readonly map: CueMap, private readonly manifest: CueManifest, private readonly player: AudioPlayer) {}

  update(inputs: Omit<CueInputs, 'minutesInState'>): void {
    const minutesInState = (Date.now() - this.enteredAt) / 60_000;
    const { decision, next } = decide(this.map, this.manifest, this.state, { ...inputs, minutesInState });
    this.state = next;
    if (next.cue !== this.lastCue) {
      this.lastCue = next.cue;
      this.enteredAt = Date.now();
    }
    this.player.apply(decision);
  }
}
