import type { ReactNode } from 'react';
import type { DemoEntryDecision, DemoEntryForm } from '@itsm/bff';
import { AREAS } from '@itsm/contracts/areas';
import { DEMO_COMPANY, DEMO_COPY, demoEtaPhrase, type DemoPersona } from '@itsm/contracts/demo';
import { AutoSubmitForm, StatusScreen } from '@itsm/ui';
import { SignInLayout, type DemoBarPublicState } from '@itsm/ui/shell';
import { demoClock } from '../../server/session.js';
import { LazyPublicDemoBar } from './bars.js';
import './entry.css';

/**
 * The pieces of the pages outside the frame — `/demo`, `/sign-in` and
 * `/signed-out` (SPEC v3 §4.6) — and the words of every `/demo` decision
 * (§4.6.2), drawn on the design system's `SignInLayout` with the public demo
 * bar above it, or, for an area switch, on the `hop` card.
 *
 * Server components, and no script of their own: the only client code on
 * these pages is `AutoSubmitForm` where a decision submits itself, and the
 * public bar's islands where the demo is on. "Taking a while? Open the demo"
 * is CSS (`entry.css`).
 *
 * Names come from `AREAS` and the decision's persona (`DEMO_PERSONAS`), never
 * retyped (§6.6).
 */

/** This area's name as a sentence uses it: "Administration", where the others read "the Service Desk". */
export const AREA_IN_SENTENCE = AREAS.admin.name;

/** The site's home, as `siteHome()` gives it. */
export interface Home {
  readonly href: string;
  readonly label: string;
}

/** The public demo bar (§3.8 "Public variant"), with its clock from the server; `state` from what the page knows. */
export function PublicBar({ state, home }: { readonly state?: DemoBarPublicState; readonly home: Home | null }): ReactNode {
  return <LazyPublicDemoBar variant="public" clock={demoClock()} {...(state ? { state } : {})} {...(home ? { links: { home: home.href } } : {})} />;
}

/** `SignInLayout` as these pages use it: the lockup links to the site when there is one (D18). */
export function EntryFrame({ bar, home, children }: { readonly bar?: ReactNode; readonly home: Home | null; readonly children: ReactNode }): ReactNode {
  return (
    <SignInLayout {...(home ? { productHref: home.href } : {})} {...(bar ? { systemBar: bar } : {})}>
      <div className="app-Entry">{children}</div>
    </SignInLayout>
  );
}

/** The column's one heading; while the page submits itself it is the status line too. */
export function EntryTitle({ status = false, children }: { readonly status?: boolean; readonly children: ReactNode }): ReactNode {
  return <h1 className="app-Entry__title">{status ? <span role="status">{children}</span> : children}</h1>;
}

/** A plain link styled as a button: a full page load, never a prefetched client navigation. */
export function EntryLink({ href, primary = false, children }: { readonly href: string; readonly primary?: boolean; readonly children: ReactNode }): ReactNode {
  return (
    <a href={href} className={`itsm-Button itsm-Button--${primary ? 'primary' : 'secondary'} itsm-Button--lg`}>
      <span className="itsm-Button__label">{children}</span>
    </a>
  );
}

/**
 * The decision's form: hidden fields only, posted to this app's
 * `/api/session/demo` (M rows). Same-origin, so `form-action 'self'` and the
 * BFF's origin check both pass.
 */
export function EntryForm({ form, children }: { readonly form: DemoEntryForm; readonly children: ReactNode }): ReactNode {
  return (
    <form id={form.id} method={form.method} action={form.action}>
      <input type="hidden" name="persona" value={form.fields.persona} />
      <input type="hidden" name="redirectTo" value={form.fields.redirectTo} />
      {form.fields.confirm ? <input type="hidden" name="confirm" value={form.fields.confirm} /> : null}
      {children}
    </form>
  );
}

/**
 * The form's button. While the form submits itself it reads "Open the demo"
 * and, after 3 s, "Taking a while? Open the demo" (§4.6.2) — the swap is CSS.
 */
export function OpenButton({ label = 'Open the demo', auto = false, secondary = false }: { readonly label?: string; readonly auto?: boolean; readonly secondary?: boolean }): ReactNode {
  return (
    <button type="submit" className={`itsm-Button itsm-Button--${secondary ? 'secondary' : 'primary'} itsm-Button--lg`}>
      {auto ? (
        <span className="itsm-Button__label app-Entry__swap">
          <span className="app-Entry__now">{label}</span>
          <span className="app-Entry__later">Taking a while? {label}</span>
        </span>
      ) : (
        <span className="itsm-Button__label">{label}</span>
      )}
    </button>
  );
}

/** "Jordan Lee, IT Service Manager", in bold where a sentence carries it. */
function PersonaName({ persona }: { readonly persona: DemoPersona }): ReactNode {
  return (
    <strong>
      {persona.name}, {persona.title}
    </strong>
  );
}

type Shown = Exclude<DemoEntryDecision, { readonly kind: 'not-found' } | { readonly kind: 'redirect' }>;

const REASON_COPY = {
  busy: { title: 'The demo is busy', body: 'Please try again in a moment.', action: 'Try again' },
  capacity: { title: 'The demo is very busy right now', body: 'Lots of people are exploring at once. Please try again in a few minutes.', action: 'Try again' },
  invalid: { title: 'That link didn’t work', body: 'Open the demo from the start.', action: 'Open the demo' },
  ended: { title: DEMO_COPY.sessionEnded, body: 'Pick up where you left off — the demo data may have been reset since.', action: DEMO_COPY.continueDemo },
} as const;

/** The `h1` of a decision, also the document's title. */
export function entryTitle(decision: Shown): string {
  switch (decision.kind) {
    case 'paused':
      return 'The demo is paused';
    case 'preparing':
      return 'The demo is being prepared…';
    case 'confirm':
      return decision.signedInAs ? `You’re signed in as ${decision.signedInAs}` : 'You’re signed in to your own account';
    case 'reason':
      return REASON_COPY[decision.reason].title;
    case 'hop':
      return `Opening ${AREA_IN_SENTENCE} as ${decision.persona.name}…`;
    case 'form':
      if (!decision.autoSubmit) return `Explore ${AREA_IN_SENTENCE}`;
      return decision.resumed ? 'Welcome back — reopening the demo…' : `Opening ${AREA_IN_SENTENCE}…`;
  }
}

/** What the public bar says over a decision: paused and preparing are known here; anything else is the countdown. */
export function entryBarState(decision: Shown): DemoBarPublicState | undefined {
  return decision.kind === 'paused' ? 'paused' : decision.kind === 'preparing' ? 'preparing' : undefined;
}

/**
 * Everything `/demo` shows for a decision other than a 404 or a redirect
 * (§4.6.2): the hop card for an area switch (X-M11), else the column's
 * content on `SignInLayout` under the public bar.
 */
export function DemoEntryView({ decision, home }: { readonly decision: Shown; readonly home: Home | null }): ReactNode {
  const title = entryTitle(decision);
  const persona = decision.persona;

  if (decision.kind === 'hop') {
    // The session bar's look without a countdown, so moving between areas never flashes the sign-in panel.
    return (
      <StatusScreen
        variant="hop"
        brand="admin"
        title={title}
        session={{
          badge: 'Demo',
          persona: (
            <>
              You’re <strong>{persona.name}</strong> · {persona.title}
            </>
          ),
        }}
      >
        <EntryForm form={decision.form}>
          <button type="submit" className="itsm-Button itsm-Button--secondary itsm-Button--lg app-Entry__hopAction">
            <span className="itsm-Button__label">Taking a while? Open the demo</span>
          </button>
        </EntryForm>
        <AutoSubmitForm formId={decision.form.id} />
      </StatusScreen>
    );
  }

  const homeLink = home ? (
    <a href={home.href} className="app-Entry__link">
      {home.label}
    </a>
  ) : null;

  let content: ReactNode;
  switch (decision.kind) {
    case 'paused':
      content = (
        <>
          <EntryTitle>{title}</EntryTitle>
          <div className="app-Entry__body">
            <p>It’s back shortly. Please try again in a few minutes.</p>
          </div>
          {homeLink}
        </>
      );
      break;
    case 'preparing':
      content = (
        <>
          {/* React hoists it into the head: "This page checks again by itself." */}
          <meta httpEquiv="refresh" content={String(decision.refreshSeconds)} />
          <EntryTitle status>{title}</EntryTitle>
          <div className="app-Entry__body">
            <p>It’s being built with fresh data and is usually ready in {demoEtaPhrase(decision.etaSec)}. This page checks again by itself.</p>
          </div>
          {homeLink}
        </>
      );
      break;
    case 'confirm':
      content = (
        <>
          <EntryTitle>{title}</EntryTitle>
          <div className="app-Entry__body">
            <p>
              Open the demo instead? You’ll explore as {persona.name} in a shared demo. Your account stays signed in on this device and comes back when
              you end the demo.
            </p>
          </div>
          <div className="app-Entry__actions">
            <EntryForm form={decision.form}>
              <OpenButton />
            </EntryForm>
            <EntryLink href={decision.redirectTo}>Stay in my account</EntryLink>
          </div>
        </>
      );
      break;
    case 'reason': {
      const copy = REASON_COPY[decision.reason];
      content = (
        <>
          <EntryTitle>{title}</EntryTitle>
          <div className="app-Entry__body">
            <p>{copy.body}</p>
          </div>
          <div className="app-Entry__actions">
            <EntryForm form={decision.form}>
              <OpenButton label={copy.action} />
            </EntryForm>
          </div>
          {decision.reason === 'invalid' ? homeLink : null}
        </>
      );
      break;
    }
    case 'form':
      content = decision.autoSubmit ? (
        <>
          <EntryTitle status>{title}</EntryTitle>
          <div className="app-Entry__body">
            <p>
              You’re exploring as <PersonaName persona={persona} /> at {DEMO_COMPANY.name}, a fictional company. {DEMO_COPY.resetsDaily}
            </p>
          </div>
          <div className="app-Entry__actions">
            <EntryForm form={decision.form}>
              <OpenButton auto />
            </EntryForm>
          </div>
          <AutoSubmitForm formId={decision.form.id} />
        </>
      ) : (
        <>
          <EntryTitle>{title}</EntryTitle>
          <div className="app-Entry__body">
            <p>
              You’ll be signed in to a shared demo as <PersonaName persona={persona} />. {DEMO_COMPANY.name} and its people are fictional. Changes are
              shared with other visitors until the nightly reset — please don’t enter real personal data.
            </p>
          </div>
          <div className="app-Entry__actions">
            <EntryForm form={decision.form}>
              <OpenButton />
            </EntryForm>
          </div>
          {homeLink}
        </>
      );
      break;
  }

  const state = entryBarState(decision);
  return (
    <EntryFrame bar={<PublicBar home={home} {...(state ? { state } : {})} />} home={home}>
      {content}
    </EntryFrame>
  );
}
