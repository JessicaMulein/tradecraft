export {
  ambientCouplingCaps,
  applyCouplings,
  emptyCouplingDraft,
  type CouplingCaps,
  type CouplingDraft,
} from './apply.js';
export { AmbientContractError, runAmbientContract, type AmbientContract } from './contract.js';
export { referenceCity, referenceSimulator, referenceSpine, type RefCity } from './reference.js';
export { sliceAmbient, sliceCity, sliceSpine, type SliceCity } from './slice-ambient.js';
export {
  advanceRegion,
  arrivalFactLines,
  arrive,
  assignTiers,
  initialRegionClock,
  serviceTickOrder,
  spineProjection,
  spineTick,
  type RegionClockOptions,
  type RegionClockState,
} from './clock.js';
export {
  AMBIENT_COUPLING_KINDS,
  exampleCouplings,
  type AmbientCoupling,
  type AmbientCouplingKind,
  type AmbientOriginEvent,
  type AmbientSimulator,
  type AmbientStep,
  type CityId,
  type GossipRef,
  type IRouteId,
  type ServiceId,
  type SpineView,
  type StageId,
  type Window,
} from './types.js';
