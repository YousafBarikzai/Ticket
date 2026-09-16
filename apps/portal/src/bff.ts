import { createBff } from '@itsm/bff';

/**
 * This application's BFF.
 *
 * Everything it does lives in `@itsm/bff`; what is here is the four facts that
 * distinguish the portal from the workbench — its name, its origin, where a
 * sign-in lands, and the two pages that are reachable without one.
 *
 * The session namespace matters as much as the origin. A person may be signed
 * in to both applications on the same machine, and a session identifier minted
 * by one must not resolve in the other: the two have different audiences and
 * an agent's session appearing in the portal would be a privilege boundary
 * crossed by a cookie name.
 */
export const bff = createBff({
  appName: 'portal',
  originEnvVar: 'PORTAL_ORIGIN',
  defaultOrigin: 'http://localhost:3200',
  defaultLanding: '/',
  signInPath: '/sign-in',
  signedOutPath: '/signed-out',
});
