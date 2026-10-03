/**
 * The Player-View Notifications surface (task 16.6; Requirements 39.2, 39.3,
 * 39.5, 39.6, 39.7): the {@link Notification} union, the pure {@link notify}
 * over player-visible events with its content templates and player-perspective
 * namer, the {@link raiseDerivedEvents} that surfaces hidden-event consequences
 * from player-side expectations, and the view-side {@link NotificationStore}.
 */

export {
  type Notification,
  type NotificationBase,
  type NotificationKind,
} from './notification.js';

export {
  notify,
  notificationIdFor,
} from './notify.js';

export {
  notifyNamer,
  type NotifyView,
} from './view.js';

export {
  notifyDate,
  type NotifyNamer,
} from './templates.js';

export {
  raiseDerivedEvents,
  type DerivedExpectations,
  type MeetingExpectation,
  type DropExpectation,
  type SilenceExpectation,
  type RetainerExpectation,
} from './derived.js';

export {
  NotificationStore,
  type NotificationListener,
} from './store.js';
