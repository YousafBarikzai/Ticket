import { createBff } from '@itsm/bff';

/**
 * This application's BFF.
 *
 * Everything it does lives in `@itsm/bff`; what is here is the four facts that
 * distinguish the console from the workbench and the portal.
 *
 * The session namespace matters more here than anywhere else. A person may be
 * signed in to all three applications on one machine, and a session minted by
 * one must not resolve in another. An agent's session appearing in the console
 * would be a privilege boundary crossed by a cookie name.
 */
export const bff = createBff({
  appName: 'admin',
  originEnvVar: 'ADMIN_ORIGIN',
  defaultOrigin: 'http://localhost:3300',
  defaultLanding: '/',
  signInPath: '/sign-in',
  signedOutPath: '/signed-out',
});
