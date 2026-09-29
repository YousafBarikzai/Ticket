/**
 * `@itsm/pwa/live` — one server-sent-events connection per tab (SPEC D16,
 * F18), for all three applications. Its own subpath because the admin console
 * uses it without the rest of this package: admin never registers a service
 * worker (ADR-0049), and importing the live layer registers nothing.
 */
export { LiveProvider, type LiveProviderProps } from './LiveProvider.js';
export { useLive, useLiveState, type LiveConnection, type UseLiveOptions } from './useLive.js';
export { useChangeStream, type ChangeStreamOptions } from './useChangeStream.js';
export {
  BACKOFF_MS,
  MAX_TOPICS,
  STREAM_PATH,
  browserEnvironment,
  createLiveHub,
  mergeTopics,
  reconnectDelay,
  streamUrl,
  type ChangeNotice,
  type EventSourceConstructor,
  type EventSourceLike,
  type LiveEnvironment,
  type LiveHub,
  type LiveHubOptions,
  type LiveState,
  type LiveSubscriber,
} from './hub.js';
