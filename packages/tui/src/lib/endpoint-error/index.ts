/**
 * The endpoint-error slice of the TUI (task 22.13; design, "TUI": "Endpoint
 * error screen"; Requirements 13.10, 16.1): the Ink screen shown on a `paused`
 * {@link TurnChunk} that names the unreachable endpoint and offers Retry
 * (`retry()`) or Save and Quit, and the pure menu reducer behind it.
 */

export {
  EndpointErrorScreen,
  type EndpointErrorScreenProps,
  type PausedError,
} from './endpoint-error-screen.js';

export {
  ENDPOINT_CHOICES,
  initialEndpointMenuState,
  reduceEndpointMenu,
  selectedChoice,
  type EndpointChoice,
  type EndpointMenuState,
  type EndpointMenuAction,
} from './menu.js';
