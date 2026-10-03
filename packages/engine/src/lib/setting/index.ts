/**
 * The setting module (content-expansion tasks 3.2–3.5): the setting stream and
 * the pure setting-step functions the world generator runs before any Plot
 * selection (content-expansion Req 9.11).
 *
 * This barrel re-exports the setting stream registry (`SETTING_STREAM_BASE`,
 * `settingStreamSeed`), the content-expansion Content Set shape
 * (`ContentSetV2`, `CityBundle`, `EraBundle`) and the setting-step functions
 * (`drawSetting`, `yearFilter`), `instantiateCity` (3.3), `nameNpc` (3.4),
 * `describeNpc` (3.5), the `CityView` projection (`cityView`, task 3.8) and the
 * write-only `UsageSink` (task 3.8).
 */

export {
  SETTING_STREAM_BASE,
  SETTING_STREAM_LIMIT,
  SETTING_STREAM_SPAN,
  settingStreamSeed,
} from './stream.js';

export {
  isContentSetV2,
  type CityBundle,
  type CityId,
  type CultureGroupId,
  type CitySelector,
  type ContentSetV2,
  type EraBundle,
  type ServiceId,
} from './content-set-v2.js';

export {
  CORE_CITY_DEFAULT_START_DATE,
  SettingError,
  drawSetting,
  yearFilter,
  type IsoDate,
  type SettingConfig,
  type SettingSelection,
} from './setting.js';

export {
  DEFAULT_DISTRICT_BOUND,
  DEFAULT_LOCATION_BOUND,
  MAX_INSTANTIATION_ATTEMPTS,
  districtEntityId,
  instantiateCity,
  locationEntityId,
  type InstantiatedCity,
} from './instantiate-city.js';

export {
  EMPTY_BLOCKLIST,
  MAX_NAME_REJECTIONS,
  nameNpc,
  normaliseBlocklist,
  normaliseName,
  type BlocklistEntryLike,
  type CultureWeight,
  type CultureWeights,
  type NameGender,
  type NamedNpc,
  type NormalisedBlocklist,
} from './names.js';

export {
  MAX_DESCRIPTOR_REJECTIONS,
  describeNpc,
  type DescriptorGender,
} from './descriptors.js';

export {
  CORE_CITY_CURRENCY,
  buildLocaleContext,
  formatAddressParts,
  formatAmount,
  formatWhen,
  honorific,
  localeNamer,
  resolveVariant,
  type LocaleContext,
} from './locale-render.js';

export {
  glossaryWithLocalTerms,
  specificsAllowedNames,
} from './locale-terms.js';

export {
  scaleMoney,
  scaleMoneyPolicy,
  scalePreset,
  type MoneyPolicy,
} from './currency.js';

export {
  cityView,
  type BindableKind,
  type CityView,
  type TaggedEntity,
} from './city-view.js';

export {
  CountingUsageSink,
  NO_USAGE_SINK,
  type UsageSink,
} from './usage-sink.js';
