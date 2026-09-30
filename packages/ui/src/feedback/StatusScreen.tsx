import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { BrandMark } from '../icons/BrandMark.js';
import { Icon } from '../icons/Icon.js';
import type { AppName } from '../theme/prefs.js';
import type { ActionSpec, Illustration } from '../types.js';
import { cx } from '../web/cx.js';
import { StateIllustration } from './Illustration.js';

export interface StatusScreenProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
  readonly illustration?: Illustration;
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
  /** Which application's mark and name head the card. */
  readonly brand?: AppName;
  /** The product name beside the mark; each application's own by default. */
  readonly brandName?: string;
  /** Controls that are not links, after the actions: a sign-out form. */
  readonly children?: ReactNode;
  /** `main` (default) when the screen is the whole page; `div` inside a page that has its own. */
  readonly as?: 'main' | 'div';
  /** Marks the root with `data-itsm-error-boundary`, for `global-error.tsx`. */
  readonly errorBoundary?: boolean;
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

const productNames: Readonly<Record<AppName, string>> = {
  admin: 'Administration',
  workbench: 'Workbench',
  portal: 'Help',
};

/**
 * A centred, branded full-page state: sign-in, signed out, offline, a global
 * error, a suspended workspace, "Opening Workbench…" during a cross-app
 * sign-in (X-83). Server-safe, because most of those pages render before any
 * provider exists — and `/offline` must render from the service worker's
 * cache with no JavaScript at all.
 *
 * One card on the canvas: the application's mark and name, the line
 * illustration, the title as the page's `h1`, a sentence or the page's own
 * content, and full-width actions. On a narrow screen the card gives up its
 * frame and the content sits on the canvas, which is what a phone's own
 * system screens do.
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
  as: Root = 'main',
  errorBoundary = false,
  className,
  ref,
  ...rest
}: StatusScreenProps): ReactNode {
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
      {...(errorBoundary ? { 'data-itsm-error-boundary': '' } : {})}
    >
      <div className="itsm-StatusScreen__card">
        {brand ? (
          <div className="itsm-StatusScreen__brand">
            <BrandMark app={brand} size={28} />
            <span className="itsm-StatusScreen__product">{brandName ?? productNames[brand]}</span>
          </div>
        ) : null}
        {illustration ? <StateIllustration name={illustration} size="lg" className="itsm-StatusScreen__illustration" /> : null}
        <h1 className="itsm-StatusScreen__title">{title}</h1>
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
              const variant = action.variant ?? (action.tone === 'danger' ? 'danger' : index === 0 ? 'primary' : 'secondary');
              return (
                <a
                  key={action.id}
                  href={action.href}
                  className={`itsm-Button itsm-Button--${variant} itsm-Button--lg`}
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
