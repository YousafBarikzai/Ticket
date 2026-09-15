import { createBff } from '@itsm/bff';

/**
 * This application's BFF.
 *
 * Everything it does lives in `@itsm/bff`; what is here is the four facts that
 * distinguish the workbench from the portal — its name, its origin, where a
 * sign-in lands, and the two pages that are reachable without one.
 */
export const bff = createBff({
  appName: 'workbench',
  originEnvVar: 'WORKBENCH_ORIGIN',
  defaultOrigin: 'http://localhost:3100',
  defaultLanding: '/queue',
  signInPath: '/sign-in',
  signedOutPath: '/signed-out',
});
