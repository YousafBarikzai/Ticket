import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { BrandMark } from '../icons/BrandMark.js';
import { Icon } from '../icons/Icon.js';
import type { AppName } from '../theme/prefs.js';
import type { ActionSpec, Illustration } from '../types.js';
import { cx } from '../web/cx.js';
import { StateIllustration } from './Illustration.js';

/** The persona strip of the `hop` card, drawn in the demo bar's look (no countdown). */
export interface StatusScreenSession {
  /** The pill's word: "Demo". */
  readonly badge?: string;
  /** "You're **Emma Clarke** · Finance Manager". */
  readonly persona: ReactNode;
}

export interface StatusScreenProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
  readonly illustration?: Illustration;
  /**
   * The page's `h1`. In the `hop` variant it is also the status line —
   * "Opening the Help Portal as Emma Clarke…" — inside a `role="status"`.
   */
  readonly title: string;
  /** A sentence, or the page's own content — the sign-in form, the "Available offline" list. */
  readonly body?: ReactNode;
  /**
   * Links, as data, so a server-rendered page can offer them. The first is
   * the primary action unless its spec says otherwise. Specs without `href`,
   * and disabled ones, are not rendered — a server page has no handler to
   * give them; put a form (a POST sign-out) in `children` instead.
   */
  readonly actions?: readonly ActionSpec[];
  /** Which area's mark and name head the card, under the product name. */
  readonly brand?: AppName;
  /** The area name under the product name; the area's own (`productNames`) by default. */
  readonly brandName?: string;
  /** Controls that are not links, after the actions: a sign-out form, the `/demo` entry form. */
  readonly children?: ReactNode;
  /**
   * `hop` (X-M11) is the card shown while a demo session crosses from one
   * area to another: the status line, a route-progress bar and the persona
   * strip, with no illustration and nothing that takes focus.
   */
  readonly variant?: 'default' | 'hop';
  /** `hop` only: who the person continues as. */
  readonly session?: StatusScreenSession;
  /** `main` (default) when the screen is the whole page; `div` inside a page that has its own. */
  readonly as?: 'main' | 'div';
  /** Marks the root with `data-itsm-error-boundary`, for `global-error.tsx`. */
  readonly errorBoundary?: boolean;
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

/**
 * The product's name over every area lockup. The same string as
 * `PRODUCT_NAME` in `@itsm/contracts/areas`; spelt out here so this
 * server-safe module, which `/offline` renders from the service worker's
 * cache, depends on nothing outside the design system.
 */
export const STATUS_SCREEN_PRODUCT = 'IT Service Management';

/** Each area's name, as `AREAS[…].name` in `@itsm/contracts/areas` (D1). */
export const productNames: Readonly<Record<AppName, string>> = {
  admin: 'Administration',
  workbench: 'Service Desk',
  portal: 'Help Portal',
};

/**
 * A centred, branded full-page state: offline, signed out, a global error, a
 * suspended workspace — and, as `variant="hop"`, "Opening the Help Portal as
 * Emma Clarke…" while a demo session changes area (X-M11). Server-safe,
 * because most of those pages render before any provider exists, and
 * `/offline` must render from the service worker's cache with no JavaScript
 * at all.
 *
 * One card on the canvas: the area lockup (the mark, "IT Service Management"
 * and the area's name), the line illustration, the title as the page's `h1`,
 * a sentence or the page's own content, and full-width actions. On a narrow
 * screen the card gives up its frame and the content sits on the canvas, which
 * is what a phone's own system screens do.
 *
 * The `hop` card is the same card, quieter and narrower in what it says: the
 * status line in a `role="status"`, a 2 px progress bar that only decorates
 * (the words already say it), and the persona strip in the demo bar's navy.
 * It traps nothing — no `aria-modal`, no `inert` — so a keyboard reaches the
 * "Taking a while? Open the demo" button the page puts in `children`, and
 * anything after it, exactly as on any page.
 *
 * Actions are plain links — no client-side router, no prefetch — which is
 * what "Sign in again" needs (a full navigation through the identity
 * provider) and all a status page has anyway.
 */
export function StatusScreen({
  illustration,
  title,
  body,
  actions = [],
  brand,
  brandName,
  children,
  variant = 'default',
  session,
  as: Root = 'main',
  errorBoundary = false,
  className,
  ref,
  ...rest
}: StatusScreenProps): ReactNode {
  const hop = variant === 'hop';
  // A link cannot be disabled, and a spec without `href` has nothing to do here.
  const links = actions.filter((action) => typeof action.href === 'string' && action.href !== '' && !action.disabled);
  const hasBody = body !== undefined && body !== null && body !== false && body !== '';
  const hasActions = links.length > 0 || (children !== undefined && children !== null && children !== false);

  return (
    <Root
      {...rest}
      // `main` and `div` are both plain HTMLElements; the tag union only confuses the ref's type.
      ref={ref as Ref<HTMLDivElement>}
      className={cx('itsm-StatusScreen', className)}
      data-brand={brand}
      data-variant={variant}
      {...(errorBoundary ? { 'data-itsm-error-boundary': '' } : {})}
    >
      <div className="itsm-StatusScreen__card">
        {brand ? (
          <div className="itsm-StatusScreen__brand">
            <BrandMark app={brand} size={32} />
            <span className="itsm-StatusScreen__lockup">
              <span className="itsm-StatusScreen__productName">{STATUS_SCREEN_PRODUCT}</span>
              <span className="itsm-StatusScreen__product">{brandName ?? productNames[brand]}</span>
            </span>
          </div>
        ) : null}
        {illustration && !hop ? <StateIllustration name={illustration} size="lg" className="itsm-StatusScreen__illustration" /> : null}
        <h1 className="itsm-StatusScreen__title">{hop ? <span role="status">{title}</span> : title}</h1>
        {hop ? (
          <span className="itsm-StatusScreen__progress" aria-hidden="true">
            <span className="itsm-StatusScreen__progressBar" />
          </span>
        ) : null}
        {hop && session ? (
          <div className="itsm-StatusScreen__session" data-surface="hero">
            {session.badge ? (
              // The demo bar's badge, by its classes: this module rides in every app's error boundary,
              // so it stays clear of the shell (and of `.itsm-SystemBar`, which would publish a frame offset).
              <span className="itsm-SystemBar__badge">
                <span className="itsm-SystemBar__dot" aria-hidden="true" />
                {session.badge}
              </span>
            ) : null}
            <span className="itsm-StatusScreen__persona">{session.persona}</span>
          </div>
        ) : null}
        {hasBody ? (
          typeof body === 'string' ? (
            <p className="itsm-StatusScreen__body">{body}</p>
          ) : (
            <div className="itsm-StatusScreen__body">{body}</div>
          )
        ) : null}
        {hasActions ? (
          <div className="itsm-StatusScreen__actions">
            {links.map((action, index) => {
              const linkVariant = action.variant ?? (action.tone === 'danger' ? 'danger' : index === 0 ? 'primary' : 'secondary');
              return (
                <a
                  key={action.id}
                  href={action.href}
                  className={`itsm-Button itsm-Button--${linkVariant} itsm-Button--lg`}
                  data-action={action.id}
                  {...(action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {action.icon ? <Icon name={action.icon} size="md" className="itsm-Button__icon" /> : null}
                  <span className="itsm-Button__label">{action.label}</span>
                  {action.external ? (
                    <>
                      <Icon name="external" size="md" className="itsm-Button__icon" directional />
                      <span className="itsm-visually-hidden"> (opens in a new tab)</span>
                    </>
                  ) : null}
                </a>
              );
            })}
            {children}
          </div>
        ) : null}
      </div>
    </Root>
  );
}
