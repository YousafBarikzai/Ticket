import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AREA_ORDER, AREAS, SITE } from '@itsm/contracts/areas';
import { DEMO_PERSONAS } from '@itsm/contracts/demo';
import { Banner } from '@itsm/ui';
import { DemoBar, SignInLayout } from '@itsm/ui/shell';
import { HINT_READ } from '../../client/continue-read.js';
import { AreaRow } from '../../components/AreaRow.js';
import { ContinueCard } from '../../components/ContinueCard.js';
import { DemoNotes } from '../../components/DemoNotes.js';
import { PersonaCard } from '../../components/PersonaCard.js';
import { LegalLinks } from '../../components/LegalPage.js';
import { CHOOSER } from '../../landing/roles-content.js';
import { siteConfig, type SiteConfig } from '../../server/config.js';
import { demoStatusNote, getDemoStatus } from '../../server/demo-status.js';
import { demoHref, workAccountHref } from '../../server/links.js';
import './chooser.css';

/**
 * The sign-in chooser (SPEC v3 §6.3; A5 §6.1–§6.7): the demo's personas and a
 * work-account sign-in for each area, on one page.
 *
 * `?start=demo` (every "Try the demo" call to action) puts the demo first and
 * says so in the `h1`; without it the work account comes first. Both stay on
 * the page so either kind of visitor finds the other path — unless
 * `DEMO_MODE` is off, when only the work-account rows render and nothing on
 * the page mentions a demo.
 *
 * Per request, because every link is runtime configuration (`siteConfig`)
 * and the demo's state is read live (`getDemoStatus`, memoised for 10 s).
 * Nothing here is client code: the links are plain anchors and the one
 * script is the inline `HINT_READ` that unhides a "Continue" card.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function startsWithDemo(params: Record<string, string | string[] | undefined>, config: SiteConfig): boolean {
  return config.demo && params.start === 'demo';
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const demoFirst = startsWithDemo(await searchParams, siteConfig());
  return {
    title: demoFirst ? CHOOSER.demo.title : CHOOSER.account.title,
    robots: { index: false, follow: true },
  };
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }): Promise<ReactNode> {
  const config = siteConfig();
  const params = await searchParams;
  const status = await getDemoStatus(config);
  const demoOn = status.mode === 'on';
  const demoFirst = startsWithDemo(params, config);
  const note = demoStatusNote(status);
  const copy = demoFirst ? CHOOSER.demo : CHOOSER.account;

  const account = (
    <section className="app-Chooser__section" aria-labelledby={demoFirst ? 'account-title' : undefined} aria-label={demoFirst ? undefined : CHOOSER.accountHeading}>
      {demoFirst ? (
        <h2 id="account-title" className="app-Chooser__heading">
          {CHOOSER.accountHeading}
        </h2>
      ) : null}
      <p className="app-Chooser__lead">{CHOOSER.accountLead}</p>
      <ul className="app-Chooser__list">
        {AREA_ORDER.map((id) => (
          <li key={id}>
            <AreaRow area={AREAS[id]} href={workAccountHref(config, id)} />
          </li>
        ))}
      </ul>
      <p className="app-Chooser__help">{CHOOSER.accountHelp}</p>
    </section>
  );

  const demo = demoOn ? (
    <section className="app-Chooser__section" aria-labelledby={demoFirst ? undefined : 'demo-title'} aria-label={demoFirst ? CHOOSER.demo.heading : undefined}>
      {demoFirst ? null : (
        <h2 id="demo-title" className="app-Chooser__heading">
          {CHOOSER.demo.heading}
        </h2>
      )}
      {note ? (
        <Banner tone="warning" className="app-Chooser__status">
          {note}
        </Banner>
      ) : null}
      <div className="app-Chooser__continue">
        {DEMO_PERSONAS.map((persona) => (
          <ContinueCard key={persona.key} persona={persona} href={demoHref(config, persona.key, '/resume')} />
        ))}
        {/* Straight after the hidden cards, so the matching one is shown before first paint (A5 §3.9). */}
        <script dangerouslySetInnerHTML={{ __html: HINT_READ }} />
      </div>
      <ul className="app-Chooser__list">
        {DEMO_PERSONAS.map((persona) => (
          <li key={persona.key}>
            <PersonaCard persona={persona} href={demoHref(config, persona.key)} />
          </li>
        ))}
      </ul>
      <DemoNotes />
    </section>
  ) : null;

  const divider = (
    <p className="app-Chooser__divider" aria-hidden="true">
      <span>{CHOOSER.divider}</span>
    </p>
  );

  return (
    <SignInLayout
      width="chooser"
      productHref="/"
      back={{ href: '/', label: SITE.homeLabel }}
      systemBar={demoOn ? <DemoBar variant="public" clock={status.clock} state={status.state === 'unknown' ? 'ready' : status.state} /> : undefined}
      footer={<LegalLinks />}
    >
      <h1 className="app-Chooser__title">{copy.heading}</h1>
      <p className="app-Chooser__intro">{copy.intro}</p>
      {demoFirst ? (
        <>
          {demo}
          {divider}
          {account}
        </>
      ) : (
        <>
          {account}
          {demo ? divider : null}
          {demo}
        </>
      )}
    </SignInLayout>
  );
}
