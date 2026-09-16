/**
 * The URLs the provider is configured with.
 *
 * Derived from the app's configured origin rather than from the incoming
 * request's `Host` header: a redirect URI taken from a header is a redirect
 * URI an attacker can choose, and Keycloak's own allow-list is the only thing
 * that would stop it.
 */
export function redirectUriFor(appOrigin: string): string {
  return `${appOrigin}/api/session/callback`;
}

export function postLogoutUriFor(appOrigin: string, signedOutPath: string): string {
  return `${appOrigin}${signedOutPath}`;
}
