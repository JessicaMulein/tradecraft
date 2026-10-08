/**
 * Campaign screens: creation, headquarters, and the career record.
 */

export {
  CAMPAIGN_START_YEARS,
  CreationScreen,
  initialCreationState,
  toCreateChoice,
  type CampaignBackground,
  type CreationScreenProps,
  type CreationState,
} from './creation.js';

export { HqScreen, type HqScreenProps } from './hq-screen.js';

export {
  ArchiveScreen,
  CampaignEndScreen,
  CampaignLoadErrorScreen,
  KnownEnemiesScreen,
  OfficerScreen,
  loadErrorText,
  type CampaignEndSummary,
  type CampaignScreenError,
} from './career-screens.js';
