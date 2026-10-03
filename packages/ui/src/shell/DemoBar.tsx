import type { AreaModel } from '@itsm/contracts/areas';
import { DEMO_COPY } from '@itsm/contracts/demo';
import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';
import { DemoBarControls } from './DemoBarControls.js';
import { DemoCountdown, type DemoClock } from './DemoCountdown.js';
import { SystemBar, type SystemBarState } from './SystemBar.js';

/** What the site's status read (or a layout) knows about the demo when it renders (X9). */
export type DemoBarPublicState = 'ready' | 'building' | 'preparing' | 'paused';

export interface DemoBarProps {
  /**
   * `session`: inside a demo session (the three group layouts, only when
   * `areas.demo`). `public`: the site, `/demo` and the signed-out pages —
   * badge, countdown, the one sentence and Demo details, centred, no polling.
   */
  readonly variant: 'session' | 'public';
  /** The pure UK reset clock, computed on the server (`nextResetAt(now)`, `periodMs(now)`, `DEMO_RESET`). */
  readonly clock: DemoClock;
  /** Session: who the visitor is (`DEMO_PERSONAS`), "You're **Alex Morgan** · Service Desk team lead". */
  readonly persona?: { readonly name: string; readonly title: string };
  /** Session: the generation the page was rendered with (`bff.latestSession(session).demoGeneration`, X3). */
  readonly generation?: number;
  /** Session: the areas, for the details' "Explore as" rows and the site's home. */
  readonly areas?: AreaModel;
  readonly endpoints?: { readonly status: '/api/demo/status'; readonly reset: '/api/demo/reset' };
  /** The site's home and its "How the demo works" section; derived from `areas.home` when absent. */
  readonly links?: { readonly home?: string; readonly howItWorks?: string };
  /** The frame's one sign-out form, which End demo submits. Default `itsm-signout`. */
  readonly signOutFormId?: string;
  /**
   * Public variant: the state the server's status read found — "Preparing the
   * demo…", "Resetting now…" or "Paused" in place of the countdown (X9). A
   * session learns the state from its first poll instead.
   */
  readonly state?: DemoBarPublicState;
  readonly className?: string;
}

/** The bar's landmark name (A2 §9.2). */
export const DEMO_BAR_LABEL = 'Demo environment';
/** The frame's sign-out form (`SIGN_OUT_FORM_ID` in `frame.tsx`, a client module this server component must not import). */
export const DEMO_BAR_SIGN_OUT_FORM_ID = 'itsm-signout';
/** The busy line's words; a session adds the estimate after them ("Resetting now… about 2 minutes", `DEMO_COPY.resettingNow`). */
export const DEMO_BAR_RESETTING = 'Resetting now…';
/** The public bar while the first generation is built (X9). */
export const DEMO_BAR_PREPARING = 'Preparing the demo…';
/** The public bar while the operator has paused the demo (X9). */
export const DEMO_BAR_PAUSED = 'Paused';

const DEFAULT_ENDPOINTS = { status: '/api/demo/status', reset: '/api/demo/reset' } as const;

/** `https://itsm.example/` → `https://itsm.example/#how-it-works` (A2 §9.3). */
function howItWorksFrom(home: string | undefined): string | undefined {
  if (!home) return undefined;
  const base = home.split('#')[0]!;
  return `${base.endsWith('/') ? base : `${base}/`}#how-it-works`;
}

/**
 * The demo bar (v3 §3.8, R11): the navy strip that says this is the shared
 * demo, when it resets and who the visitor is, with Demo details, Reset demo
 * data and End demo.
 *
 * It **composes `SystemBar`** — one surface, one stylesheet, the one rule
 * that publishes the frame offset — and is server-safe: the markup, the
 * sentences, the persona and End demo are rendered with the page, and only
 * two small islands come to the browser: `DemoCountdown` (the clock) and
 * `DemoBarControls` (the two buttons, which load the details popover and the
 * reset flow on intent, and in a session start the status watch when idle).
 *
 * **End demo** is a plain submit button for the frame's sign-out form
 * (`form="itsm-signout"`), so it works before any script has run; with
 * script, the form's own listener clears the visit's local data first
 * (A2 §8, §9.5). No confirmation: nothing is lost.
 *
 * Nothing here reads a store: the clock is computed on the server from the
 * pure UK clock, and the cooldown and building state arrive with the first
 * poll (A2 §9.6).
 */
export function DemoBar({
  variant,
  clock,
  persona,
  generation,
  areas,
  endpoints = DEFAULT_ENDPOINTS,
  links,
  signOutFormId = DEMO_BAR_SIGN_OUT_FORM_ID,
  state,
  className,
}: DemoBarProps): ReactNode {
  const session = variant === 'session';
  // A session's state comes from its polls; the seeded state is the public bar's (X9).
  const seeded: DemoBarPublicState = session ? 'ready' : (state ?? 'ready');
  const barState: SystemBarState = seeded === 'building' || seeded === 'preparing' ? 'busy' : 'default';
  const home = links?.home ?? areas?.home?.href;
  const howItWorks = links?.howItWorks ?? howItWorksFrom(home);
  const resolvedLinks = { ...(home ? { home } : {}), ...(howItWorks ? { howItWorks } : {}) };

  const status =
    seeded === 'ready' ? (
      <DemoCountdown clock={clock} />
    ) : seeded === 'paused' ? (
      <span className="itsm-DemoBar__paused">
        <Icon name="pause" size={15} />
        {DEMO_BAR_PAUSED}
      </span>
    ) : undefined;

  return (
    <SystemBar
      label={DEMO_BAR_LABEL}
      badge={{ label: 'Demo', live: true }}
      status={status}
      message={DEMO_COPY.resetsDaily}
      persona={
        session && persona ? (
          <>
            {"You're "}<strong>{persona.name}</strong> · {persona.title}
          </>
        ) : undefined
      }
      note={session ? DEMO_COPY.sharedData : undefined}
      actions={
        <>
          <DemoBarControls
            variant={variant}
            clock={clock}
            {...(session && persona ? { persona } : {})}
            {...(session && generation !== undefined ? { generation } : {})}
            {...(session && areas ? { areas } : {})}
            endpoints={endpoints}
            links={resolvedLinks}
          />
          {session ? (
            <button type="submit" form={signOutFormId} className="itsm-SystemBar__action itsm-DemoBar__end">
              <Icon name="log-out" size={15} />
              <span className="itsm-SystemBar__actionLabel">End demo</span>
            </button>
          ) : null}
        </>
      }
      state={barState}
      align={session ? 'start' : 'center'}
      busyLabel={seeded === 'preparing' ? DEMO_BAR_PREPARING : DEMO_BAR_RESETTING}
      className={cx('itsm-DemoBar', className)}
      data-variant={variant}
    />
  );
}
