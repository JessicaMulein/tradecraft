/**
 * The Feed composer slice of the TUI (task 22.14): the Ink Feed composer that
 * lets the player pick Case File Claims or compose a Proposition from known
 * entities to feed a turned agent, showing `validateFeed` errors inline
 * (Requirements 13.1, 37.1, 37.2), and the pure reducer behind it that owns the
 * mode, the Claim selection and the compose-form state.
 */

export {
  FeedComposer,
  type FeedComposerProps,
  type ValidateFeed,
} from './feed-composer.js';

export {
  assembleFeed,
  currentComposed,
  fieldLabel,
  initialFeedState,
  reduceFeed,
  COMPOSE_FIELDS,
  FEED_MODES,
  type ComposeField,
  type ComposeOptions,
  type ComposeSelection,
  type FeedAction,
  type FeedInit,
  type FeedMode,
  type FeedState,
  type FieldOption,
  type PlaceId,
  type PredicateId,
  type PropObject,
} from './feed.js';
