/**
 * `@itsm/bff` — the backend-for-frontend every web application is built on.
 *
 * The browser holds an opaque `__Host-session` cookie and never an access
 * token; the token, the refresh token and the tenant live in Redis. One
 * package rather than one copy per application, because the rules that make
 * that safe — the `__Host-` attributes, the proxy's four allow-lists, the
 * single-use pending login — are exactly the things that go wrong quietly
 * when they are written twice (ADR-0041).
 */
export { createBff, type Bff } from './bff.js';
export { type BffIdentity } from './bff.js';
export {
  developmentSignInAvailable,
  readConfig,
  ConfigurationError,
  type AppIdentity,
  type BffConfig,
  type Environment,
  type OidcSettings,
} from './config.js';
export {
  clearedAttributes,
  clearedDemoCookie,
  cookieAttributes,
  demoCookie,
  demoCookieMaxAge,
  demoCookieValue,
  demoReentryFromValue,
  readCookie,
  readDemoReentry,
  serialiseCookie,
  violatesHostPrefix,
  SESSION_COOKIE,
  type CookieAttributes,
  DEMO_COOKIE,
  DEMO_COOKIE_MAX_SECONDS,
} from './cookies.js';
export { safeRedirectTarget } from './redirects.js';
export {
  decodeSession,
  encodeSession,
  isDemoSession,
  isRealSession,
  memorySessionStore,
  needsRefresh,
  newCorrelationId,
  newSessionId,
  newState,
  SESSION_KINDS,
  type DemoSession,
  type PendingLogin,
  type RealSession,
  type Session,
  type SessionStore,
  type SessionKind,
} from './session.js';
export { setSessionStore } from './store.js';
export * from './demo/index.js';
export {
  assertMethodAllowed,
  assertSameOrigin,
  codedProblemBody,
  FORWARDED_REQUEST_HEADERS,
  forwardRequestHeaders,
  forwardResponseHeaders,
  problemCodeOf,
  PROBLEM_TYPE_BASE,
  refusalBody,
  targetPathFor,
  ProxyRefused,
  FORWARDED_METHODS,
} from './proxy.js';
export {
  authorisationUrl,
  challengeFor,
  createVerifier,
  discover,
  endSessionUrl,
  exchangeCode,
  readClaims,
  refreshTokens,
  SignInFailed,
  type Discovery,
  type TokenClaims,
  type TokenSet,
} from './oidc.js';
export { devSignIn, DevSignInFailed, type DevTokenSet } from './dev-sign-in.js';
export { createSession, SessionRefused, type TokensToStore } from './create-session.js';
export { type SessionMeta } from './create-session.js';
export { recordSession, type RecordDeps, type RecordedSession } from './record-session.js';
export { postLogoutUriFor, redirectUriFor } from './urls.js';
