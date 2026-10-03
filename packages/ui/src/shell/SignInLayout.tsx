import type { ReactNode } from 'react';
import { PRODUCT_NAME } from '@itsm/contracts/areas';
import { SIGN_IN_PANEL, type SignInPanelCopy } from '@itsm/contracts/marketing';
import { IconTile } from '../display/IconTile.js';
import { BrandMark } from '../icons/BrandMark.js';
import { Icon } from '../icons/Icon.js';
import { isIconName } from '../icons/registry.js';

export interface SignInLayoutProps {
  /** The light column's content. Its first heading must be the page's only `<h1>`. */
  readonly children: ReactNode;
  /** The navy panel's copy. Defaults to `SIGN_IN_PANEL` from `@itsm/contracts/marketing`. */
  readonly panel?: SignInPanelCopy;
  /**
   * Makes the lockup a link: the site passes `'/'`, the apps pass the site's
   * origin (D18). Absent, the lockup is plain text.
   */
  readonly productHref?: string;
  /** The "back" link at the top of the column: "IT Service Management home". */
  readonly back?: { readonly href: string; readonly label: string };
  /** Above the grid: the public `DemoBar` (a `SystemBar`), which also sets the offset the grid subtracts. */
  readonly systemBar?: ReactNode;
  /** Under the column: the legal links line ("Privacy · Cookies · Terms"). */
  readonly footer?: ReactNode;
  /**
   * `form` (default) keeps the column's content to 420 px — status pages and
   * single actions, the width the Keycloak theme matches; `chooser` widens it
   * to 560 px for persona cards and area rows.
   */
  readonly width?: 'form' | 'chooser';
}

/**
 * The page every sign-in surface is drawn on (SPEC v3 §6.3; A5 §6.2): a navy
 * panel that says what the product is, beside a light column where the person
 * chooses what to do. The site's `/sign-in` and `/try`, and each app's
 * `/demo`, `/sign-in` and `/signed-out`, all use it, so a prospect who goes
 * from the landing page to a role page to an app's demo screen stays on one
 * page design throughout.
 *
 * **Server-only in practice, and 0 B of JavaScript.** No hooks, no handlers,
 * no `'use client'`: these pages render before any provider exists, and the
 * Help Portal's must cost its first load nothing. The column takes whatever
 * islands its page needs as children.
 *
 * **One `main`, one `h1`.** The column is `main#main` (the skip link's
 * target, focusable by script only); the panel is an `aside` named "About IT
 * Service Management" whose headline is a paragraph, so the page's outline
 * starts at the column's `h1`. The panel's grid lines and glow are its
 * background, never content.
 *
 * **Below 1024 px** the panel shrinks to a band with the lockup alone — the
 * pitch would push the form below the fold on a phone — and the column becomes
 * a card that overlaps the band. The pitch is `display: none` there, not merely
 * hidden from sight, so a screen reader does not hear it on a page it cannot
 * see it on.
 */
export function SignInLayout({
  children,
  panel = SIGN_IN_PANEL,
  productHref,
  back,
  systemBar,
  footer,
  width = 'form',
}: SignInLayoutProps): ReactNode {
  const lockup = (
    <>
      <BrandMark size={44} className="itsm-SignInLayout__mark" />
      <span className="itsm-SignInLayout__lockupText">
        <span className="itsm-SignInLayout__product">{PRODUCT_NAME}</span>
        {/* A space for the link's accessible name; the grid lays the two lines out without it. */}{' '}
        <span className="itsm-SignInLayout__suffix">{panel.suffix}</span>
      </span>
    </>
  );

  return (
    <div className="itsm-SignInLayout" data-width={width}>
      {systemBar}
      <div className="itsm-SignInLayout__grid">
        <aside className="itsm-SignInLayout__panel" data-surface="hero" aria-label={`About ${PRODUCT_NAME}`}>
          {productHref ? (
            <a className="itsm-SignInLayout__lockup" href={productHref}>
              {lockup}
            </a>
          ) : (
            <div className="itsm-SignInLayout__lockup">{lockup}</div>
          )}
          <div className="itsm-SignInLayout__pitch">
            <p className="itsm-SignInLayout__headline">{panel.headline}</p>
            <ul className="itsm-SignInLayout__points">
              {panel.points.map((point) => (
                <li key={point.text} className="itsm-SignInLayout__point">
                  {/* The copy names its glyph as a string (contracts cannot import the registry); an unknown name keeps the tile. */}
                  <IconTile icon={isIconName(point.icon) ? point.icon : 'check'} size={36} />
                  <span>{point.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="itsm-SignInLayout__poweredBy">{panel.poweredBy}</p>
        </aside>
        <div className="itsm-SignInLayout__column">
          <main id="main" tabIndex={-1} className="itsm-SignInLayout__main">
            {back ? (
              <a className="itsm-SignInLayout__back" href={back.href}>
                <Icon name="arrow-left" size={16} directional />
                <span>{back.label}</span>
              </a>
            ) : null}
            <div className="itsm-SignInLayout__content">{children}</div>
          </main>
          {footer !== undefined && footer !== null && footer !== false ? (
            <footer className="itsm-SignInLayout__footer">{footer}</footer>
          ) : null}
        </div>
      </div>
    </div>
  );
}
