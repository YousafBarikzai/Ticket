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
  cookieAttributes,
  readCookie,
  serialiseCookie,
  violatesHostPrefix,
  SESSION_COOKIE,
  type CookieAttributes,
} from './cookies.js';
export { safeRedirectTarget } from './redirects.js';
export {
  decodeSession,
  encodeSession,
  memorySessionStore,
  needsRefresh,
  newCorrelationId,
  newSessionId,
  newState,
  type PendingLogin,
  type Session,
  type SessionStore,
} from './session.js';
export { setSessionStore } from './store.js';
export {
  assertMethodAllowed,
  assertSameOrigin,
  forwardRequestHeaders,
  forwardResponseHeaders,
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
export { recordSession, type RecordDeps, type RecordedSession } from './record-session.js';
export { postLogoutUriFor, redirectUriFor } from './urls.js';
