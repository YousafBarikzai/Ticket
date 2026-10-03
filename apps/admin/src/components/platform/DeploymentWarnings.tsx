import type { CSSProperties, ReactNode } from 'react';
import type { Admin } from '@itsm/sdk';
import { Banner } from '@itsm/ui';

/** One service's warnings, as `admin.platform.deploymentWarnings()` answers them. */
export type DeploymentWarningRow = Awaited<ReturnType<Admin['platform']['deploymentWarnings']>>[number];

/** The five services that sign links, and so must share one secret (A5 §10.1). */
const SIGNING_SERVICES = 'api, worker-events, worker-engine, worker-comms and worker-data';
const CLEARS = 'This notice clears within a minute of the last service restarting.';

/** The banners' words, built once from the list so the page and its test read the same thing. */
export interface DeploymentWarningsView {
  /** Services still signing with the public development secret. */
  readonly defaultSecret: readonly string[];
  /** Services signing with a secret shorter than 32 characters. */
  readonly shortSecret: readonly string[];
  /** The demo build's failure, as the sentence after "Last failure:", or `''` when it did not say. Null when the build is fine. */
  readonly demoBuild: { readonly lastFailure: string } | null;
}

const services = (rows: readonly DeploymentWarningRow[], code: string): string[] =>
  [...new Set(rows.filter((row) => row.codes.includes(code)).map((row) => row.service))].sort();

/**
 * What the banners say, or null when there is nothing to say. Codes this
 * release does not know (a newer API) are left out rather than guessed at.
 */
export function deploymentWarningsView(rows: readonly DeploymentWarningRow[]): DeploymentWarningsView | null {
  const failing = rows.find((row) => row.codes.includes('demo_build_failing'));
  const view: DeploymentWarningsView = {
    defaultSecret: services(rows, 'dev_token_secret_default'),
    shortSecret: services(rows, 'dev_token_secret_short'),
    demoBuild: failing ? { lastFailure: [failing.failure?.step, failing.failure?.check].filter(Boolean).join(' · ') } : null,
  };
  return view.defaultSecret.length > 0 || view.shortSecret.length > 0 || view.demoBuild ? view : null;
}

/*
 * The banners share the page column (`app-Page`: centred, 90rem) and keep the
 * page's own gap from the header below them. The spacing is a token, set here
 * because this stack exists only while something is wrong.
 */
const STACK: CSSProperties = { marginBlockEnd: 'var(--itsm-space-lg)' };

/**
 * The platform operator's deployment warnings (D24, Y-M7; SPEC v3 §6.5), at
 * the top of every platform page: a deployment signing links with the public
 * development secret, or a short one, and a nightly demo build that has
 * failed three times running.
 *
 * A server component: the list is read on the server with the operator's own
 * client, and nothing about it reaches the browser except the words. It sits
 * behind the platform layout's gate, so only an operator ever renders it, and
 * it renders nothing at all when the list is empty — or when the call fails,
 * because a page that cannot say whether something is wrong must not claim
 * that something is, and the pages below have their own error states.
 *
 * Danger for the default secret and the failing build: each is a live problem
 * the operator has to act on. Warning for a short secret, which is a weakness
 * rather than an open door. Announced politely: the banners were on the page
 * when it loaded, and nothing the operator did caused them.
 */
export async function DeploymentWarnings({ load }: { readonly load: () => Promise<readonly DeploymentWarningRow[]> }): Promise<ReactNode> {
  let rows: readonly DeploymentWarningRow[];
  try {
    rows = await load();
  } catch {
    return null;
  }
  const view = deploymentWarningsView(rows);
  if (!view) return null;

  return (
    <div className="app-Page" style={STACK} data-deployment-warnings="">
      {view.defaultSecret.length > 0 ? (
        <Banner tone="danger" title="This deployment signs links with the public development secret">
          <p>
            Anyone who has read this repository can forge survey and status-page links, and file upload and download links, on this
            deployment. Set DEV_TOKEN_SECRET to one long random value on {SIGNING_SERVICES}, then apply the changes.
          </p>
          <p>Still using it: {view.defaultSecret.join(', ')}</p>
          <p>{CLEARS}</p>
        </Banner>
      ) : null}
      {view.demoBuild ? (
        <Banner tone="danger" title="The nightly demo build is failing">
          <p>
            The demo keeps yesterday’s data.
            {view.demoBuild.lastFailure ? ` Last failure: ${view.demoBuild.lastFailure}.` : ''} See docs/runbooks/demo-operations.md.
          </p>
        </Banner>
      ) : null}
      {view.shortSecret.length > 0 ? (
        <Banner tone="warning" title="This deployment signs links with a short secret">
          <p>
            A signing secret shorter than 32 characters can be guessed, and with it survey, status-page, upload and download links
            forged. Set DEV_TOKEN_SECRET to one long random value on {SIGNING_SERVICES}, then apply the changes.
          </p>
          <p>Still using one: {view.shortSecret.join(', ')}</p>
          <p>{CLEARS}</p>
        </Banner>
      ) : null}
    </div>
  );
}
