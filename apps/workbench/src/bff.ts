import { appOrigins, type Origins } from '@itsm/contracts/areas';
import { createBff } from '@itsm/bff';

/**
 * This application's BFF.
 *
 * Everything it does lives in `@itsm/bff`; what is here is the four facts that
 * distinguish the Service Desk from the other areas — its name, its origin,
 * where a sign-in lands (the Overview, v3 §3.5), and the two pages that are
 * reachable without one.
 */
export const bff = createBff({
  appName: 'workbench',
  originEnvVar: 'WORKBENCH_ORIGIN',
  defaultOrigin: 'http://localhost:3100',
  defaultLanding: '/overview',
  signInPath: '/sign-in',
  signedOutPath: '/signed-out',
});

let origins: Origins | undefined;

/**
 * The deployment's public origins, for the pages outside the frame — `/demo`,
 * `/sign-in` and `/signed-out` — which link to the site (D18) and to the
 * other areas' demo entries without a session to build an area model from.
 * Read once per process, like `areasFor`; this file is the one place in the
 * app, besides `areasFor`, allowed to read them (`no-raw-origins.test.ts`).
 */
export function deploymentOrigins(): Origins {
  origins ??= appOrigins(process.env);
  return origins;
}
