import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { SITE, isServiceDeskRoutePending } from '@itsm/contracts/areas';
import { demoPersona, type DemoPersona } from '@itsm/contracts/demo';
import { SignInLayout } from '@itsm/ui/shell';
import { DemoNotes } from '../../../components/DemoNotes.js';
import { LegalLinks } from '../../../components/LegalPage.js';
import { ROLE_PAGE, UNAVAILABLE } from '../../../landing/roles-content.js';
import { siteConfig } from '../../../server/config.js';
import { demoHref, safeDeepLink } from '../../../server/links.js';
import '../../sign-in/chooser.css';

/**
 * The shareable role page `/try/<persona>` (SPEC v3 §6.3; A5 §6.8).
 *
 * A page rather than a redirect: a link pasted into an email or a chat
 * arrives with a foreign Referer, and the app would only show its own button
 * page. From here one click carries the site as Referer, so the app signs the
 * visitor straight in; and the page gives the link a proper preview (Open
 * Graph) and the fictional-data and reset notes.
 *
 * `?to=` is a deep link into the persona's area. It is checked with
 * `safeDeepLink` and dropped, not refused, when invalid. A Service Desk route
 * whose page has not shipped yet (`isServiceDeskRoutePending`, RV6) is
 * dropped too, so a role page never offers a route that would 404 (R12).
 *
 * `DEMO_MODE` off, or a persona outside the table: a 404, so a stale shared
 * link never offers a demo the deployment does not run.
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ persona: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface RolePage {
  readonly persona: DemoPersona;
  readonly to: string | null;
}

/** The persona and the deep link this request may use, or a 404. */
function resolveRolePage(personaKey: string, to: unknown): RolePage {
  const config = siteConfig();
  const persona = demoPersona(personaKey);
  if (!config.demo || !persona) notFound();
  let target = safeDeepLink(to);
  if (target && persona.area === 'workbench' && isServiceDeskRoutePending(target)) target = null;
  return { persona, to: target };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const persona = demoPersona((await params).persona);
  if (!siteConfig().demo || !persona) return {};
  const title = ROLE_PAGE.title(persona);
  return {
    title,
    description: ROLE_PAGE.description,
    robots: { index: false, follow: true },
    openGraph: { title, description: ROLE_PAGE.description, type: 'website' },
  };
}

export default async function TryPage({ params, searchParams }: { params: Params; searchParams: SearchParams }): Promise<ReactNode> {
  const { persona, to } = resolveRolePage((await params).persona, (await searchParams).to);
  const href = demoHref(siteConfig(), persona.key, to ?? undefined);
  return (
    <SignInLayout width="form" productHref="/" back={{ href: '/', label: SITE.homeLabel }} footer={<LegalLinks />}>
      <h1 className="app-Chooser__title">{ROLE_PAGE.heading(persona)}</h1>
      <p className="app-Chooser__intro">
        {ROLE_PAGE.bodyBefore}
        <strong>{persona.name}</strong>
        {ROLE_PAGE.bodyAfter(persona)}
        {to ? ` ${ROLE_PAGE.deepLink(persona)}` : null}
      </p>
      <div className="app-RolePage__actions">
        {href ? (
          // The design system's button classes on a plain anchor: no client code, and never `next/link` (A5 §3.8).
          <a className="itsm-Button itsm-Button--primary itsm-Button--lg" href={href} rel="nofollow" data-persona={persona.key}>
            <span className="itsm-Button__label">{ROLE_PAGE.primary}</span>
          </a>
        ) : (
          <p className="app-RolePage__unavailable">{UNAVAILABLE}</p>
        )}
        <a className="itsm-Button itsm-Button--secondary itsm-Button--lg" href="/sign-in?start=demo">
          <span className="itsm-Button__label">{ROLE_PAGE.secondary}</span>
        </a>
      </div>
      <DemoNotes />
    </SignInLayout>
  );
}
