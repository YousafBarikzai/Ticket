import type { ReactNode } from 'react';
import type { DemoEntryDecision, DemoEntryForm } from '@itsm/bff';
import { AREAS, SITE } from '@itsm/contracts/areas';
import { DEMO_COMPANY, DEMO_COPY, demoEtaPhrase } from '@itsm/contracts/demo';
import { AutoSubmitForm, Button, StatusScreen } from '@itsm/ui';
import { SignInLayout, type DemoBarProps } from '@itsm/ui/shell';
import { areaInSentence } from './copy.js';
import { DemoBarSlot } from './DemoBarSlot.js';
import { OpenDemoButton } from './OpenDemoButton.js';

/**
 * What `/demo` shows for each of the BFF's decisions (v3 §4.5 P rows, §4.6.2;
 * A3 §6.2), for the Service Desk: the copy, the one form and whether it
 * submits itself. The decision is the BFF's and pure (`decideDemoEntry`);
 * this only words it, so the three areas cannot drift in what they do, only
 * in their names.
 *
 * Two looks. An area switch from a sibling app (P7h) is the hop card in the
 * demo bar's look, which submits itself, so moving between areas never
 * flashes the navy sign-in panel (X-M11). Everything else sits on
 * `SignInLayout` under the public demo bar, as the site's chooser does.
 *
 * **No GET ever mints.** Every way in is the form's POST to
 * `/api/session/demo`; `AutoSubmitForm` presses it only for P7 and P7h,
 * which the BFF grants only to a request from this app or one of the
 * product's own origins (D22). A reason page (P6) and a typed URL (P8) get a
 * button and wait for the visitor.
 */

type RenderedDecision = Exclude<DemoEntryDecision, { readonly kind: 'not-found' } | { readonly kind: 'redirect' }>;

export interface DemoEntryScreenProps {
  readonly decision: RenderedDecision;
  /** The public site's origin, for "IT Service Management home" and the lockup (D18); null when not configured. */
  readonly site: string | null;
  /** The demo bar's clock, computed on the server (`demoBarClock()`). */
  readonly clock: DemoBarProps['clock'];
}

/** The entry form: hidden fields only, posted same-origin (CSP `form-action 'self'`). */
function EntryForm({ form, auto, children }: { readonly form: DemoEntryForm; readonly auto: boolean; readonly children: ReactNode }): ReactNode {
  return (
    <form id={form.id} method={form.method} action={form.action} className="app-Entry__form">
      <input type="hidden" name="persona" value={form.fields.persona} />
      <input type="hidden" name="redirectTo" value={form.fields.redirectTo} />
      {form.fields.confirm ? <input type="hidden" name="confirm" value={form.fields.confirm} /> : null}
      {children}
      {auto ? <AutoSubmitForm formId={form.id} /> : null}
    </form>
  );
}

function SubmitButton({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <Button type="submit" variant="primary" size="lg" fullWidth>
      {children}
    </Button>
  );
}

/** "IT Service Management home", as a quiet link, when the site is known. */
function HomeLink({ site }: { readonly site: string | null }): ReactNode {
  if (!site) return null;
  return (
    <Button href={site} variant="ghost" size="lg" fullWidth>
      {SITE.homeLabel}
    </Button>
  );
}

/** The column's words and controls for each decision that renders on `SignInLayout`. */
function EntryColumn({ decision, site }: { readonly decision: Exclude<RenderedDecision, { readonly kind: 'hop' }>; readonly site: string | null }): ReactNode {
  const area = AREAS[decision.area].name;
  const { name, title } = decision.persona;
  const who = (
    <strong>
      {name}, {title}
    </strong>
  );

  switch (decision.kind) {
    case 'form':
      if (decision.autoSubmit) {
        return (
          <div className="app-Entry">
            <h1 className="app-Entry__title">
              <span role="status">{decision.resumed ? 'Welcome back — reopening the demo…' : `Opening ${areaInSentence(area)}…`}</span>
            </h1>
            <p className="app-Entry__body">
              You’re exploring as {who} at {DEMO_COMPANY.name}, a fictional company. {DEMO_COPY.resetsDaily}
            </p>
            <EntryForm form={decision.form} auto>
              <OpenDemoButton />
            </EntryForm>
          </div>
        );
      }
      return (
        <div className="app-Entry">
          <h1 className="app-Entry__title">Explore {areaInSentence(area)}</h1>
          <p className="app-Entry__body">
            You’ll be signed in to a shared demo as {who}. {DEMO_COPY.fictional} Changes are shared with other visitors until the nightly
            reset — please don’t enter real personal data.
          </p>
          <div className="app-Entry__actions">
            <EntryForm form={decision.form} auto={false}>
              <SubmitButton>Open the demo</SubmitButton>
            </EntryForm>
            <HomeLink site={site} />
          </div>
        </div>
      );
    case 'confirm':
      return (
        <div className="app-Entry">
          <h1 className="app-Entry__title">{decision.signedInAs ? `You’re signed in as ${decision.signedInAs}` : 'You’re signed in to your own account'}</h1>
          <p className="app-Entry__body">
            Open the demo instead? You’ll explore as {name} in a shared demo. Your account stays signed in on this device and comes back when you
            end the demo.
          </p>
          <div className="app-Entry__actions">
            <EntryForm form={decision.form} auto={false}>
              <SubmitButton>Open the demo</SubmitButton>
            </EntryForm>
            <Button href={decision.redirectTo} variant="secondary" size="lg" fullWidth>
              Stay in my account
            </Button>
          </div>
        </div>
      );
    case 'preparing':
      return (
        <div className="app-Entry">
          {/* P3: no form; the page looks again by itself (React puts the tag in the head). */}
          <meta httpEquiv="refresh" content={String(decision.refreshSeconds)} />
          <h1 className="app-Entry__title">The demo is being prepared…</h1>
          <p className="app-Entry__body">
            It’s being built with fresh data and is usually ready in {demoEtaPhrase(decision.etaSec)}. This page checks again by itself.
          </p>
          <div className="app-Entry__actions">
            <HomeLink site={site} />
          </div>
        </div>
      );
    case 'paused':
      return (
        <div className="app-Entry">
          <h1 className="app-Entry__title">The demo is paused</h1>
          <p className="app-Entry__body">It’s back shortly. Please try again in a few minutes.</p>
          <div className="app-Entry__actions">
            <HomeLink site={site} />
          </div>
        </div>
      );
    case 'reason':
      return <ReasonColumn decision={decision} site={site} />;
  }
}

/** P6: why an earlier attempt came back. Always a button, never an auto-submit, so a refusal can never loop. */
function ReasonColumn({ decision, site }: { readonly decision: Extract<RenderedDecision, { readonly kind: 'reason' }>; readonly site: string | null }): ReactNode {
  const copy = {
    busy: { title: 'The demo is busy', body: 'Please try again in a moment.', action: 'Try again', home: false },
    capacity: {
      title: 'The demo is very busy right now',
      body: 'Lots of people are exploring at once. Please try again in a few minutes.',
      action: 'Try again',
      home: false,
    },
    invalid: { title: 'That link didn’t work', body: 'Open the demo from the start.', action: 'Open the demo', home: true },
    ended: { title: DEMO_COPY.sessionEnded, body: 'Pick up where you left off — the demo data may have been reset since.', action: DEMO_COPY.continueDemo, home: false },
  }[decision.reason];
  return (
    <div className="app-Entry">
      <h1 className="app-Entry__title">{copy.title}</h1>
      <p className="app-Entry__body">{copy.body}</p>
      <div className="app-Entry__actions">
        <EntryForm form={decision.form} auto={false}>
          <SubmitButton>{copy.action}</SubmitButton>
        </EntryForm>
        {copy.home ? <HomeLink site={site} /> : null}
      </div>
    </div>
  );
}

/** The public demo bar's state for a decision (X9): paused and preparing say so in place of the countdown. */
function barState(decision: RenderedDecision): DemoBarProps['state'] {
  return decision.kind === 'paused' ? 'paused' : decision.kind === 'preparing' ? 'preparing' : 'ready';
}

export function DemoEntryScreen({ decision, site, clock }: DemoEntryScreenProps): ReactNode {
  if (decision.kind === 'hop') {
    const { name, title } = decision.persona;
    return (
      <StatusScreen
        variant="hop"
        brand={decision.area}
        title={`Opening ${areaInSentence(AREAS[decision.area].name)} as ${name}…`}
        session={{
          badge: 'Demo',
          persona: (
            <>
              You’re <strong>{name}</strong> · {title}
            </>
          ),
        }}
      >
        <EntryForm form={decision.form} auto>
          <OpenDemoButton />
        </EntryForm>
      </StatusScreen>
    );
  }
  return (
    <SignInLayout
      {...(site ? { productHref: site } : {})}
      systemBar={<DemoBarSlot variant="public" clock={clock} state={barState(decision)} {...(site ? { links: { home: site } } : {})} />}
    >
      <EntryColumn decision={decision} site={site} />
    </SignInLayout>
  );
}
