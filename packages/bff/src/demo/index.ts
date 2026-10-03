/**
 * The demo's public surface in `@itsm/bff` (SPEC §4.3–§4.8): what the three
 * apps' `/demo` and `/sign-in` pages, their route handlers and their tests
 * use. `packages/bff/src/index.ts` re-exports it.
 *
 * Inside this package every module imports its neighbours directly; this
 * file exists for the apps, so one import line names the whole demo.
 */
export {
  decideDemoEntry,
  decideSignIn,
  demoEntryReason,
  queryValue,
  refererOrigin,
  workAccountHref,
  DEMO_ENTRY_FORM_ID,
  DEMO_PREPARING_REFRESH_SECONDS,
  DEMO_SIGN_IN_ACTION,
  type DemoEntryDecision,
  type DemoEntryForm,
  type DemoEntryInput,
  type DemoEntryOrigins,
  type DemoEntryReason,
  type HeaderSource,
  type QuerySource,
  type SignInDecision,
  type SignInInput,
} from './entry.js';
export {
  loginRateKey,
  memoryLoginCounter,
  setLoginCounter,
  DEMO_STATUS_CACHE_MS,
  LOGIN_LIMIT_PER_MINUTE,
  type CounterKeyspace,
  type DemoEntryRequest,
  type LoginCounter,
  type SignInPageRequest,
} from './handlers.js';
export { clientIp, ipBucket, requestIpBucket, UNKNOWN_IP_BUCKET } from './ip.js';
export { memoryDemoTokenStore, type MemoryDemoTokenStore } from './memory-store.js';
export { forgetRemints, latestSession, LATEST_SESSION_MS, PARKED_RESTORE_MAX_MS, type RemintCause } from './remint.js';
export { DEMO_SETTING_DEFAULTS, type DemoSettings } from './settings.js';
export { setDemoTokenStore, type DemoTokenStore } from './store.js';
