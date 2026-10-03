import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE, type DemoEntryDecision } from '@itsm/bff';
import { DEMO_COMPANY, DEMO_COPY, demoEtaPhrase } from '@itsm/contracts/demo';
import { StatusScreen } from '@itsm/ui';
import { bff } from '../../bff.js';
import { AREA_IN_SENTENCE, EntryActions, EntryBody, EntryLayout, EntryLink, EntryTitle, HOME_LABEL, PERSONA, siteHome } from './entry.js';
import { DEMO_ENDED_BODY } from './server.js';
import { EntryForm } from './EntryForm.js';

/**
 * `/demo` — the only way into the shared demo (SPEC v3 §4.5 rows P1–P8 and
 * P7h, §4.6.2; A3 §6.2).
 *
 * What it shows is decided by the BFF (`decideDemoEntry`), from this
 * browser's session, the demo's state and where the request came from; the
 * page only words the decision. No GET mints: at most it renders a form that
 * posts to `/api/session/demo`, and the form submits itself only when the
 * request came from this product (a link on the public site, another area,
 * this app) — a third-party page gets a button, and a person signed in to
 * their own account is asked first and comes back to it when the demo ends.
 *
 * Every name is from the tables (`AREAS`, `DEMO_PERSONAS`, `DEMO_COMPANY`).
 * Outside `SignInLayout` only for an area switch (`hop`), which keeps the
 * session bar's look so moving between areas never flashes the navy panel.
 */

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Explore the demo', robots: { index: false, follow: false } };

const PERSONA_PHRASE = `${PERSONA.name}, ${PERSONA.title}`;

function Home(): ReactNode {
  const home = siteHome();
  return home ? <EntryLink href={home}>{HOME_LABEL}</EntryLink> : null;
}

type Shown = Exclude<DemoEntryDecision, { readonly kind: 'not-found' } | { readonly kind: 'redirect' }>;

/** The hop (P7h, X-M11): "Opening the Help Portal as Emma Clarke…" on the hop card, the session bar's look without a countdown. */
function Hop({ decision }: { readonly decision: Extract<Shown, { kind: 'hop' }> }): ReactNode {
  return (
    <StatusScreen
      variant="hop"
      brand="portal"
      title={`Opening ${AREA_IN_SENTENCE} as ${PERSONA.name}…`}
      session={{
        badge: 'Demo',
        persona: (
          <>
            {"You're "}
            <strong>{PERSONA.name}</strong> · {PERSONA.title}
          </>
        ),
      }}
    >
      <EntryForm form={decision.form} label="Open the demo" auto lateOnly />
    </StatusScreen>
  );
}

/** Every other decision, in the sign-in layout (§4.6.2's table, in its order). */
function Entry({ decision }: { readonly decision: Shown }): ReactNode {
  switch (decision.kind) {
    case 'hop':
      return null;
    case 'form':
      return decision.autoSubmit ? (
        <>
          <EntryTitle status>{decision.resumed ? 'Welcome back — reopening the demo…' : `Opening ${AREA_IN_SENTENCE}…`}</EntryTitle>
          <EntryBody>
            {"You're exploring as "}
            <strong>{PERSONA_PHRASE}</strong> at {DEMO_COMPANY.name}, a fictional company. {DEMO_COPY.resetsDaily}
          </EntryBody>
          <EntryActions>
            <EntryForm form={decision.form} label="Open the demo" auto />
          </EntryActions>
        </>
      ) : (
        <>
          <EntryTitle>{`Explore ${AREA_IN_SENTENCE}`}</EntryTitle>
          <EntryBody>
            {"You'll be signed in to a shared demo as "}
            <strong>{PERSONA_PHRASE}</strong>. {DEMO_COMPANY.name} and its people are fictional. Changes are shared with other visitors until the
            nightly reset — please don't enter real personal data.
          </EntryBody>
          <EntryActions>
            <EntryForm form={decision.form} label="Open the demo" />
            <Home />
          </EntryActions>
        </>
      );
    case 'confirm':
      return (
        <>
          <EntryTitle>{decision.signedInAs ? `You're signed in as ${decision.signedInAs}` : "You're signed in to your own account"}</EntryTitle>
          <EntryBody>
            Open the demo instead? You'll explore as {PERSONA.name} in a shared demo. Your account stays signed in on this device and comes back
            when you end the demo.
          </EntryBody>
          <EntryActions>
            <EntryForm form={decision.form} label="Open the demo" />
            <EntryLink href={decision.redirectTo}>Stay in my account</EntryLink>
          </EntryActions>
        </>
      );
    case 'preparing':
      return (
        <>
          {/* P3 checks again by itself: React puts the tag in the document's head. */}
          <meta httpEquiv="refresh" content={String(decision.refreshSeconds)} />
          <EntryTitle status>The demo is being prepared…</EntryTitle>
          <EntryBody>
            It's being built with fresh data and is usually ready in {demoEtaPhrase(decision.etaSec)}. This page checks again by itself.
          </EntryBody>
          <EntryActions>
            <Home />
          </EntryActions>
        </>
      );
    case 'paused':
      return (
        <>
          <EntryTitle>The demo is paused</EntryTitle>
          <EntryBody>It's back shortly. Please try again in a few minutes.</EntryBody>
          <EntryActions>
            <Home />
          </EntryActions>
        </>
      );
    case 'reason':
      return <Reason decision={decision} />;
  }
}

/** P6: an earlier attempt came back with a reason — a button, never an automatic submit (the loop guard). */
function Reason({ decision }: { readonly decision: Extract<Shown, { kind: 'reason' }> }): ReactNode {
  const copy = {
    busy: { title: 'The demo is busy', body: 'Please try again in a moment.', action: 'Try again', home: false },
    capacity: {
      title: 'The demo is very busy right now',
      body: 'Lots of people are exploring at once. Please try again in a few minutes.',
      action: 'Try again',
      home: false,
    },
    invalid: { title: "That link didn't work", body: 'Open the demo from the start.', action: 'Open the demo', home: true },
    ended: { title: DEMO_COPY.sessionEnded, body: DEMO_ENDED_BODY, action: DEMO_COPY.continueDemo, home: false },
  }[decision.reason];
  return (
    <>
      <EntryTitle>{copy.title}</EntryTitle>
      <EntryBody>{copy.body}</EntryBody>
      <EntryActions>
        <EntryForm form={decision.form} label={copy.action} />
        {copy.home ? <Home /> : null}
      </EntryActions>
    </>
  );
}

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const jar = await cookies();
  const decision = await bff.demoEntry({ cookie: jar.get(SESSION_COOKIE)?.value, query: await searchParams, headers: await headers() });

  if (decision.kind === 'not-found') notFound();
  // P4: this browser is already in today's demo here. `redirect()` from a page is a 307.
  if (decision.kind === 'redirect') redirect(decision.location);
  if (decision.kind === 'hop') return <Hop decision={decision} />;

  const state = decision.kind === 'preparing' ? 'preparing' : decision.kind === 'paused' ? 'paused' : undefined;
  return (
    <EntryLayout {...(state ? { demoState: state } : {})}>
      <Entry decision={decision} />
    </EntryLayout>
  );
}
