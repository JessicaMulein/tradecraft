export { startShellServer, type ShellDeps, type ShellServer, type LogEntry } from './lib/server.js';
export {
  parseShellConfig,
  ShellConfigError,
  ShellConfigSchema,
  type ShellConfig,
  DEFAULT_ART_DIRECTION,
} from './lib/config.js';
export { parseCueMap, parseTakeMeta, CueMapError } from './lib/audio/cue-map.js';
export { buildManifest } from './lib/audio/manifest.js';
export {
  NullFrameProvider,
  type Frame,
  type FrameKind,
  type FrameRequest,
  type SceneFrameProvider,
} from './lib/frames/types.js';
export { buildFrameRequest } from './lib/frames/request.js';
export { decide, pickTake, hasAudio } from './shared/cue/decide.js';
export type * from './shared/cue/types.js';
